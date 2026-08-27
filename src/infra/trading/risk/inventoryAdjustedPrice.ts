/**
 * Inventory-Adjusted Reference Price.
 *
 * Repurpose of the Avellaneda-Stoikov reservation-price formula:
 *
 *     r(s, q, t) = s - q * γ * σ² * (T - t)
 *
 * where:
 *   - s = current mid price
 *   - q = signed inventory (positive = long, negative = short)
 *   - γ = risk-aversion parameter (paper: 0.1 to 0.5)
 *   - σ = per-unit-time volatility of the underlying (decimal)
 *   - (T - t) = lookout horizon in the same time units as σ
 *
 * AS designed this for active market-makers who post both quotes
 * continuously and want to bias their reservation around current
 * inventory. Gordon's current trading is directional (entry → manage
 * → exit), not bid/ask quote-management — but the same adjustment is
 * meaningful as a **fair-value bias when Gordon already holds a large
 * position**.
 *
 * Reading the output:
 *   - r < s → "Gordon should value this asset BELOW mid for sizing
 *     decisions because Gordon is long and should be biased toward
 *     reducing exposure."
 *   - r > s → "Gordon should value this asset ABOVE mid because Gordon
 *     is short and should be biased toward covering."
 *   - r = s → "Inventory neutral; no adjustment."
 *
 * Where it plugs in:
 *   - Risk classifier — when sizing a new trade in the same direction
 *     as existing inventory, use r instead of mid as the "fair value"
 *     entry reference (effectively penalizes adding to a winner that's
 *     getting heavy).
 *   - Position tracking — surface r alongside mid in /portfolio output
 *     so the operator can see Gordon's inventory bias quantified.
 *   - Audit — record the adjustment per sizing decision so weekend
 *     review can show "this week's average inventory bias was +X%".
 *
 * Honest caveats:
 *   - The σ² · (T - t) term scales with horizon and volatility. Garbage
 *     in / garbage out — pass realistic numbers or the adjustment will
 *     be either zero (too short horizon) or absurdly large.
 *   - The formula assumes geometric Brownian motion mid. Crypto + perp
 *     are noisier and jump-prone; the adjustment is a directional
 *     bias, not a hard fair value.
 *   - γ is operator-tuned. Paper's range 0.1-0.5 is a starting point;
 *     real Gordon usage should calibrate against backtest.
 *
 * Pure compute, stateless. No I/O.
 */

export interface InventoryAdjustmentInput {
  /** Current mid price. */
  mid: number;
  /**
   * Signed inventory. Positive = long, negative = short. Units should
   * match what `riskAversion * variance` is calibrated against — for
   * Gordon's typical usage, fraction-of-portfolio (-1..+1 range) is
   * the cleanest choice, but raw notional or share count also work
   * with appropriately-scaled γ.
   */
  inventory: number;
  /** Per-unit-time volatility (decimal — 0.02 = 2%). */
  volatility: number;
  /**
   * Horizon (T − t), in the same time units as `volatility`. For a
   * 1d σ, this would be days-to-horizon; for a 1h σ, hours.
   */
  horizon: number;
  /**
   * Risk-aversion parameter γ. Default 0.1 (paper's lower bound, less
   * inventory-averse). Operators wanting tighter inventory control
   * can raise to 0.5; the paper shows γ=0.5 cuts inventory std by
   * ~3-4× at the cost of ~20% headline P&L.
   */
  riskAversion?: number;
}

export interface InventoryAdjustmentResult {
  /** Inventory-adjusted reference price r. */
  adjustedPrice: number;
  /** Adjustment magnitude: r − mid. Sign is opposite of `inventory`. */
  adjustment: number;
  /** Adjustment as a fraction of mid: (r − mid) / mid. */
  adjustmentPct: number;
  /**
   * "Bias direction" of the adjustment, plain-English label so audit
   * lines stay operator-readable.
   */
  bias: "long_inventory_sell_bias" | "short_inventory_buy_bias" | "neutral";
  /** Echo of inputs for audit trail. */
  inputs: {
    mid: number;
    inventory: number;
    volatility: number;
    horizon: number;
    riskAversion: number;
  };
}

export const DEFAULT_RISK_AVERSION = 0.1;
/**
 * Adjustments below this fraction of mid are treated as "neutral"
 * in the bias label. 1e-7 = 0.01 bp = roughly the floor of trading-
 * meaningful precision. The AS formula's σ²·(T-t) term can produce
 * very small adjustments at typical Gordon timescales (intraday σ
 * around 2%, horizons of hours/days) — anything below this is
 * indistinguishable from numerical noise.
 */
const NEUTRAL_FRACTION_THRESHOLD = 1e-7;

/**
 * Compute the inventory-adjusted reference price.
 *
 * Returns r along with a structured adjustment record. Pure function;
 * no side effects, no clamping — the caller decides if the adjustment
 * is too large to act on.
 */
export function computeInventoryAdjustedPrice(
  input: InventoryAdjustmentInput,
): InventoryAdjustmentResult {
  const riskAversion = input.riskAversion ?? DEFAULT_RISK_AVERSION;
  const adjustment =
    -input.inventory * riskAversion * input.volatility * input.volatility * input.horizon;
  const adjustedPrice = input.mid + adjustment;
  const adjustmentPct = input.mid === 0 ? 0 : adjustment / input.mid;
  let bias: InventoryAdjustmentResult["bias"];
  if (Math.abs(adjustmentPct) < NEUTRAL_FRACTION_THRESHOLD) {
    bias = "neutral";
  } else if (input.inventory > 0) {
    bias = "long_inventory_sell_bias";
  } else {
    bias = "short_inventory_buy_bias";
  }
  return {
    adjustedPrice,
    adjustment,
    adjustmentPct,
    bias,
    inputs: {
      mid: input.mid,
      inventory: input.inventory,
      volatility: input.volatility,
      horizon: input.horizon,
      riskAversion,
    },
  };
}

/** One-line operator summary suitable for audit / tool output. */
export function summarizeInventoryAdjustment(r: InventoryAdjustmentResult): string {
  const direction =
    r.bias === "long_inventory_sell_bias"
      ? "long inventory → bias toward selling (r below mid)"
      : r.bias === "short_inventory_buy_bias"
        ? "short inventory → bias toward covering (r above mid)"
        : "inventory-neutral (no meaningful bias)";
  const adjBp = (r.adjustmentPct * 10_000).toFixed(2);
  return `Inventory-adjusted ref price: r=${r.adjustedPrice.toFixed(4)} vs mid=${r.inputs.mid.toFixed(4)} (${r.adjustment >= 0 ? "+" : ""}${adjBp}bp); ${direction}.`;
}

/**
 * Convenience: derive a position-size MULTIPLIER from the adjustment
 * direction. Use during entry sizing to scale a base position down
 * when adding to existing inventory in the same direction.
 *
 * Returns a number in (0, 1]:
 *   - 1.0 when sizing a trade in the OPPOSITE direction of current
 *     inventory (reducing exposure — full size).
 *   - <1.0 when sizing a trade in the SAME direction (penalize adding
 *     to a winner that's already heavy).
 *   - Magnitude of the discount scales with the adjustment, capped at
 *     a 50% reduction (multiplier ≥ 0.5) so even very long positions
 *     don't refuse to size up entirely — that's the role of separate
 *     concentration caps, not this primitive.
 *
 * Sign convention: `intendedSide` > 0 = buy, < 0 = sell.
 */
export function inventoryAwareSizeMultiplier(
  inventory: number,
  intendedSide: number,
  adjustmentPct: number,
  cap = 0.5,
): number {
  const sameDirection = inventory * intendedSide > 0;
  if (!sameDirection) return 1.0;
  // Map |adjustmentPct| → reduction. Each basis point of adjustment
  // shaves ~1% off the size, clamped at `cap`.
  const reductionBp = Math.abs(adjustmentPct) * 10_000;
  const reductionFraction = Math.min(reductionBp / 100, 1 - cap);
  return Math.max(cap, 1 - reductionFraction);
}
