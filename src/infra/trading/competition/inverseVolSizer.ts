/**
 * Inverse-Volatility Position Sizer — cross-sectional risk-balancing layer for
 * the Best-Sharpe competition book.
 *
 * Premise: when trading a SET of instruments simultaneously (the market-neutral
 * / pairs Sharpe-core), equalize each instrument's RISK contribution so no single
 * violent name (BTC, silver) dominates the book's variance. Weight ∝ 1/σ (inverse
 * realized vol), normalized so Σ|w| = 1. This is the standard equal-risk-contribution
 * / inverse-vol construction: it maximizes Sharpe by minimizing the denominator
 * (equity-curve variance). Under independence, w_s ∝ 1/σ_s makes every name's risk
 * contribution (w_s·σ_s) equal — no name dominates the book's variance.
 *
 * COMPOSITION (two orthogonal layers — do NOT conflate):
 *   - THIS module sets the CROSS-SECTIONAL weights (how the book is split across
 *     names), normalized to Σ|w| = 1.
 *   - `src/core/alpha/vol-target-sizer.ts` (`sizeWithVolTarget`) scales the WHOLE
 *     book up/down to hit a portfolio vol target. The book-level vol scaler is NOT
 *     duplicated here — feed this module's weights into a single book notional, then
 *     let `sizeWithVolTarget` scale that notional.
 *   - `src/core/risk-management/competition-risk-preset.ts` is the FINAL cap
 *     (per-trade risk, leverage, exposure, daily-loss kill). This is a weighting
 *     layer, not a risk gate — the preset is the survival posture that binds last.
 *
 * Pure compute. Validate at boundaries only; never throws.
 */

export interface InverseVolWeights {
  /** Signed weights, normalized so Σ|w| = 1. Sign carries long(+1)/short(−1). */
  weights: Record<string, number>;
  /**
   * Per-name risk contribution w_s·σ_s (using |w|), normalized to sum 1. Under the
   * inverse-vol construction these are equal across all names (equal-risk-contribution).
   */
  perRiskContribution: Record<string, number>;
}

export interface InverseVolOptions {
  /**
   * Optional per-name cap on |weight| (fraction, 0 < maxWeight ≤ 1). Excess above
   * the cap is redistributed to uncapped names proportional to their inverse-vol.
   * Iterated to a fixed point so redistribution can't push another name over.
   */
  maxWeight?: number;
  /**
   * Optional long(+1)/short(−1) sign map for a dollar-neutral-capable book. Names
   * absent from the map default to +1 (long). Σw can be driven to ≈0 (dollar-neutral)
   * while Σ|w| stays 1.
   */
  longShort?: Record<string, 1 | -1>;
}

/** Vol floor — guards against div-by-zero / degenerate near-zero vol names. */
const VOL_FLOOR = 1e-8;

/** Bars per year for a 15-minute series: 4 bars/hr × 24 × 365. */
const BARS_PER_YEAR_15M = 35040;

/** Default realized-vol lookback (~64 bars of 15-min data ≈ 16 hours). */
const DEFAULT_LOOKBACK = 64;

/**
 * Annualized close-to-close realized volatility over a trailing window.
 *
 * Uses log returns (r_t = ln(c_t / c_{t-1})), sample standard deviation over the
 * last `lookback` returns, scaled by √(barsPerYear). Annualization assumes a
 * 15-minute bar by default (`BARS_PER_YEAR_15M`); pass `barsPerYear` to override
 * for other cadences. Returns 0 when there aren't enough finite returns to estimate.
 *
 * The √barsPerYear factor is a pure scale constant — it cancels in `inverseVolSize`
 * (weights are ratios of vols), so the per-bar vs annualized choice does not affect
 * the cross-sectional weights; it only matters when the vol feeds a book-level vol
 * target. We annualize for consistency with `vol-target-sizer.ts` (annualized) and
 * `competition-risk-preset.ts` (`instrumentVolAnnual`).
 */
export function realizedVol(
  closes: number[],
  lookback: number = DEFAULT_LOOKBACK,
  barsPerYear: number = BARS_PER_YEAR_15M,
): number {
  if (!Array.isArray(closes) || closes.length < 2 || lookback < 2) return 0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (
      prev !== undefined &&
      cur !== undefined &&
      prev > 0 &&
      cur > 0 &&
      Number.isFinite(prev) &&
      Number.isFinite(cur)
    ) {
      returns.push(Math.log(cur / prev));
    }
  }

  const window = returns.slice(-lookback);
  if (window.length < 2) return 0;

  const mean = window.reduce((s, r) => s + r, 0) / window.length;
  // Sample variance (n−1) — unbiased estimator over the window.
  const variance =
    window.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (window.length - 1);
  const perBarVol = Math.sqrt(Math.max(variance, 0));

  return perBarVol * Math.sqrt(barsPerYear);
}

/**
 * Inverse-vol cross-sectional weights. Given each symbol's vol, produce
 * w_s ∝ 1/σ_s, normalized so Σ|w| = 1. Optional sign map for dollar-neutrality and
 * optional per-name cap with proportional redistribution of the excess.
 *
 * Non-finite or ≤0 vols are skipped (a name we can't risk-balance is dropped, not
 * given infinite weight). Empty / all-invalid input returns empty maps.
 */
export function inverseVolSize(
  volBySymbol: Record<string, number>,
  opts: InverseVolOptions = {},
): InverseVolWeights {
  const { maxWeight, longShort } = opts;

  // Boundary filter: keep only finite, strictly-positive vols. A Map keeps the
  // inverse-vol and original vol per kept symbol so later passes never re-index
  // the loosely-typed input record.
  const invVol = new Map<string, number>();
  const vols = new Map<string, number>();
  for (const [sym, vol] of Object.entries(volBySymbol)) {
    if (Number.isFinite(vol) && vol > 0) {
      invVol.set(sym, 1 / Math.max(vol, VOL_FLOOR));
      vols.set(sym, vol);
    }
  }

  const symbols = [...invVol.keys()];
  if (symbols.length === 0) {
    return { weights: {}, perRiskContribution: {} };
  }

  const iv = (s: string): number => invVol.get(s) ?? 0;
  const totalInv = symbols.reduce((sum, s) => sum + iv(s), 0);

  // Base magnitudes ∝ 1/σ, normalized so Σ|w| = 1.
  const mag = new Map<string, number>();
  for (const s of symbols) mag.set(s, iv(s) / totalInv);

  // Optional per-name cap with proportional redistribution. Iterate to a fixed
  // point: capping a name frees mass that flows to uncapped names by their
  // inverse-vol share, which can itself push a name to the cap.
  if (typeof maxWeight === "number" && maxWeight > 0 && maxWeight < 1) {
    const capped = new Set<string>();
    // At most `symbols.length` names can hit the cap; bound the loop accordingly.
    for (let iter = 0; iter < symbols.length; iter++) {
      const overflowing = symbols.filter(
        (s) => !capped.has(s) && (mag.get(s) ?? 0) > maxWeight + 1e-12,
      );
      if (overflowing.length === 0) break;
      for (const s of overflowing) {
        mag.set(s, maxWeight);
        capped.add(s);
      }
      const remainingMass = 1 - capped.size * maxWeight;
      const uncapped = symbols.filter((s) => !capped.has(s));
      const uncappedInv = uncapped.reduce((sum, s) => sum + iv(s), 0);
      if (uncapped.length === 0 || uncappedInv <= 0 || remainingMass <= 0) break;
      for (const s of uncapped) mag.set(s, (iv(s) / uncappedInv) * remainingMass);
    }
  }

  // Apply sign map → signed weights. Σ|w| stays 1; Σw reflects net direction.
  const weights: Record<string, number> = {};
  for (const s of symbols) {
    const sign = longShort?.[s] ?? 1;
    weights[s] = sign * (mag.get(s) ?? 0);
  }

  // Risk contribution: |w_s|·σ_s, normalized to sum 1. Equal across names under
  // pure inverse-vol (pre-cap); the cap intentionally breaks the equality.
  const contribBySym = new Map<string, number>();
  let rcTotal = 0;
  for (const s of symbols) {
    const contrib = Math.abs(mag.get(s) ?? 0) * (vols.get(s) ?? 0);
    contribBySym.set(s, contrib);
    rcTotal += contrib;
  }
  const perRiskContribution: Record<string, number> = {};
  for (const s of symbols) {
    perRiskContribution[s] = rcTotal > 0 ? (contribBySym.get(s) ?? 0) / rcTotal : 0;
  }

  return { weights, perRiskContribution };
}

/**
 * Convert cross-sectional weights → per-symbol notional and unit targets given a
 * total book notional and prices. Sign of the weight carries through to the notional
 * (negative = short). Skips symbols with non-finite/≤0 price.
 */
export function targetNotionals(
  weights: Record<string, number>,
  bookNotional: number,
  priceBySymbol: Record<string, number>,
): Record<string, { notional: number; units: number }> {
  const out: Record<string, { notional: number; units: number }> = {};
  if (!(bookNotional > 0) || !Number.isFinite(bookNotional)) return out;

  for (const [sym, w] of Object.entries(weights)) {
    const price = priceBySymbol[sym];
    if (price === undefined || !Number.isFinite(w) || !(price > 0) || !Number.isFinite(price)) {
      continue;
    }
    const notional = w * bookNotional;
    out[sym] = { notional, units: notional / price };
  }
  return out;
}

const fmtPct = (x: number): string => `${(x * 100).toFixed(2)}%`;

/** Human-readable summary of an inverse-vol allocation. */
export function formatInverseVol(
  result: InverseVolWeights,
  volBySymbol?: Record<string, number>,
): string {
  const w = (sym: string): number => result.weights[sym] ?? 0;
  const rc = (sym: string): number => result.perRiskContribution[sym] ?? 0;
  const symbols = Object.keys(result.weights);
  if (symbols.length === 0) return "Inverse-Vol Sizer — no eligible instruments (all vols invalid).";

  const sumAbs = symbols.reduce((s, sym) => s + Math.abs(w(sym)), 0);
  const sumNet = symbols.reduce((s, sym) => s + w(sym), 0);
  const sorted = [...symbols].sort((a, b) => Math.abs(w(b)) - Math.abs(w(a)));

  const lines: string[] = [
    `Inverse-Vol Sizer — ${symbols.length} instruments (Σ|w| ${fmtPct(sumAbs)}, Σw ${fmtPct(sumNet)})`,
    "",
  ];
  for (const sym of sorted) {
    const wi = w(sym);
    const dir = wi >= 0 ? "L" : "S";
    const v = volBySymbol?.[sym];
    const volStr = v !== undefined && Number.isFinite(v) ? ` vol ${fmtPct(v)}` : "";
    lines.push(
      `  ${sym.padEnd(10)} ${dir} ${fmtPct(Math.abs(wi)).padStart(7)}` +
        `  risk ${fmtPct(rc(sym)).padStart(7)}${volStr}`,
    );
  }
  lines.push("");
  lines.push(
    Math.abs(sumNet) < 1e-6
      ? "Book is dollar-neutral (Σw ≈ 0); pass into vol-target-sizer to scale to a portfolio vol budget."
      : "Directional book (Σw ≠ 0); pass into vol-target-sizer to scale to a portfolio vol budget.",
  );
  return lines.join("\n");
}
