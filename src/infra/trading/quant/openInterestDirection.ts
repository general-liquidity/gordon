/**
 * Open Interest Directional Signal + Perp-Spot Basis (GORDON_OI_DIRECTION).
 *
 * Two crypto-specific composites:
 *
 *   1. OI-direction classification — how price moves with respect to
 *      changes in open interest carry different meanings:
 *
 *        price ↑ + OI ↑ → new longs entering, strong trend
 *        price ↑ + OI ↓ → short covering, weak rally
 *        price ↓ + OI ↑ → new shorts entering, strong downtrend
 *        price ↓ + OI ↓ → long liquidation, exhaustion
 *
 *   2. Perp-spot basis / cash-and-carry annualized return — when the
 *      perpetual futures price prints persistently above (or below)
 *      spot, the funding-rate-implied carry is harvestable. The
 *      annualized version of:
 *
 *        basis = (perpPrice − spotPrice) / spotPrice
 *        annualizedCarry ≈ fundingRatePer8h × 3 × 365
 *
 *      lets the agent flag cash-and-carry opportunities versus just
 *      "funding is positive."
 *
 * Composes with Gordon's existing `fundingAlertProducer` and the
 * `arb-funding` skill — those flag the raw funding rate; this primitive
 * gives the cash-and-carry yield interpretation.
 *
 * Pure compute. No I/O.
 */

export const OI_DIRECTION_FLAG_ENV = "GORDON_OI_DIRECTION";

export function isOiDirectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OI_DIRECTION_FLAG_ENV] === "1" || env[OI_DIRECTION_FLAG_ENV] === "true";
}

export interface OiDirectionInput {
  /** Price series, oldest-first. */
  prices: ReadonlyArray<number>;
  /** Open interest series aligned 1:1 with prices. */
  openInterest: ReadonlyArray<number>;
  /** Lookback window (bars) for change computation. Default 20. */
  lookback?: number;
  /** Minimum |change| to consider non-flat, as fraction. Default 0.005 (0.5%). */
  flatThreshold?: number;
  /** Optional: live perp + spot prices for cash-and-carry. */
  perpPrice?: number;
  spotPrice?: number;
  /** Funding rate per 8h interval (Binance convention) as decimal. e.g., 0.0001 = 1 bp/8h. */
  fundingRatePer8h?: number;
  /** Minimum annualized carry to flag a cash-and-carry opportunity, decimal. Default 0.05 (5% APY). */
  minCarryApy?: number;
}

export type OiRegime =
  | "longs_building"       // price ↑, OI ↑
  | "short_covering"       // price ↑, OI ↓
  | "shorts_building"      // price ↓, OI ↑
  | "long_liquidation"     // price ↓, OI ↓
  | "flat";                // not enough movement either direction

export type OiTrendStrength = "weak" | "moderate" | "strong";

export interface CashAndCarryResult {
  basis: number;
  basisPct: number;
  fundingApy: number;
  /** Total expected annualized carry combining funding + basis convergence. */
  totalCarryApy: number;
  direction: "long_basis" | "short_basis" | "none";
  attractive: boolean;
  reasoning: string;
}

export interface OiDirectionResult {
  priceChange: number;
  priceChangePct: number;
  oiChange: number;
  oiChangePct: number;
  regime: OiRegime;
  trendStrength: OiTrendStrength;
  cashAndCarry: CashAndCarryResult | null;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_LOOKBACK = 20;
const DEFAULT_FLAT_THRESHOLD = 0.005;
const DEFAULT_MIN_CARRY_APY = 0.05;

function pctChange(a: number, b: number): number {
  if (!Number.isFinite(a) || a === 0 || !Number.isFinite(b)) return 0;
  return (b - a) / Math.abs(a);
}

function classifyRegime(
  priceDeltaPct: number,
  oiDeltaPct: number,
  flatThreshold: number,
): OiRegime {
  if (Math.abs(priceDeltaPct) < flatThreshold) return "flat";
  if (Math.abs(oiDeltaPct) < flatThreshold) return "flat";
  if (priceDeltaPct > 0 && oiDeltaPct > 0) return "longs_building";
  if (priceDeltaPct > 0 && oiDeltaPct < 0) return "short_covering";
  if (priceDeltaPct < 0 && oiDeltaPct > 0) return "shorts_building";
  if (priceDeltaPct < 0 && oiDeltaPct < 0) return "long_liquidation";
  return "flat";
}

function strengthFor(regime: OiRegime, priceDeltaPct: number, oiDeltaPct: number): OiTrendStrength {
  // Conviction trends (new positions in the direction of price) are
  // structurally stronger than counter-side regimes (covering, liquidation).
  const conviction = regime === "longs_building" || regime === "shorts_building";
  const magnitude = Math.max(Math.abs(priceDeltaPct), Math.abs(oiDeltaPct));
  if (conviction && magnitude > 0.03) return "strong";
  if (conviction || magnitude > 0.03) return "moderate";
  return "weak";
}

function computeCashAndCarry(
  perpPrice: number,
  spotPrice: number,
  fundingRatePer8h: number | undefined,
  minCarryApy: number,
): CashAndCarryResult {
  if (!(spotPrice > 0)) {
    return {
      basis: 0,
      basisPct: 0,
      fundingApy: 0,
      totalCarryApy: 0,
      direction: "none",
      attractive: false,
      reasoning: "invalid spot price",
    };
  }
  const basis = perpPrice - spotPrice;
  const basisPct = basis / spotPrice;
  // Funding APY: 3 funding intervals per day × 365 days, sign-preserving.
  const fundingApy = fundingRatePer8h !== undefined && Number.isFinite(fundingRatePer8h)
    ? fundingRatePer8h * 3 * 365
    : 0;
  // Cash-and-carry: long spot, short perp, collect positive funding.
  //   If basis > 0 (perp expensive) and funding positive, short perp + long spot
  //   collects funding. Total carry ≈ funding APY (basis converges to zero at delivery).
  //   For perp swaps there's no delivery, so basis convergence is captured
  //   probabilistically — we conservatively report funding only.
  const direction: CashAndCarryResult["direction"] =
    basisPct > 0 && fundingApy > 0 ? "short_basis"
    : basisPct < 0 && fundingApy < 0 ? "long_basis"
    : "none";
  const totalCarryApy = direction === "none" ? 0 : Math.abs(fundingApy);
  const attractive = totalCarryApy >= minCarryApy;
  const reasoning =
    `basis ${(basisPct * 100).toFixed(3)}%, funding APY ${(fundingApy * 100).toFixed(2)}% → ` +
    `${direction === "none" ? "no carry trade" : `${direction} carry ${(totalCarryApy * 100).toFixed(2)}% APY`}` +
    (attractive ? " [attractive]" : "");
  return {
    basis,
    basisPct,
    fundingApy,
    totalCarryApy,
    direction,
    attractive,
    reasoning,
  };
}

export function computeOiDirection(input: OiDirectionInput): OiDirectionResult {
  const prices = input.prices;
  const oi = input.openInterest;
  const lookback = input.lookback ?? DEFAULT_LOOKBACK;
  const flatThreshold = input.flatThreshold ?? DEFAULT_FLAT_THRESHOLD;
  const minCarryApy = input.minCarryApy ?? DEFAULT_MIN_CARRY_APY;

  if (prices.length !== oi.length) {
    throw new Error("prices and openInterest must have the same length");
  }
  const n = prices.length;
  if (n < lookback + 1) {
    return {
      priceChange: 0,
      priceChangePct: 0,
      oiChange: 0,
      oiChangePct: 0,
      regime: "flat",
      trendStrength: "weak",
      cashAndCarry: null,
      sampleSize: n,
      reasoning: `need at least ${lookback + 1} bars, got ${n}`,
    };
  }

  const priceNow = prices[n - 1]!;
  const pricePrev = prices[n - 1 - lookback]!;
  const oiNow = oi[n - 1]!;
  const oiPrev = oi[n - 1 - lookback]!;
  const priceChange = priceNow - pricePrev;
  const oiChange = oiNow - oiPrev;
  const priceChangePct = pctChange(pricePrev, priceNow);
  const oiChangePct = pctChange(oiPrev, oiNow);

  const regime = classifyRegime(priceChangePct, oiChangePct, flatThreshold);
  const trendStrength = strengthFor(regime, priceChangePct, oiChangePct);

  let cashAndCarry: CashAndCarryResult | null = null;
  if (input.perpPrice !== undefined && input.spotPrice !== undefined) {
    cashAndCarry = computeCashAndCarry(
      input.perpPrice,
      input.spotPrice,
      input.fundingRatePer8h,
      minCarryApy,
    );
  }

  const reasoning =
    `price ${(priceChangePct * 100).toFixed(2)}%, OI ${(oiChangePct * 100).toFixed(2)}% over ${lookback} bars → ` +
    `${regime} (${trendStrength})` +
    (cashAndCarry ? `; ${cashAndCarry.reasoning}` : "");

  return {
    priceChange,
    priceChangePct,
    oiChange,
    oiChangePct,
    regime,
    trendStrength,
    cashAndCarry,
    sampleSize: n,
    reasoning,
  };
}

export function oiDirectionToPayload(result: OiDirectionResult): Record<string, unknown> {
  return {
    kind: "oi_direction.computed",
    regime: result.regime,
    trendStrength: result.trendStrength,
    priceChangePct: Number((result.priceChangePct * 100).toFixed(3)),
    oiChangePct: Number((result.oiChangePct * 100).toFixed(3)),
    cashAndCarry: result.cashAndCarry
      ? {
          direction: result.cashAndCarry.direction,
          totalCarryApyPct: Number((result.cashAndCarry.totalCarryApy * 100).toFixed(2)),
          attractive: result.cashAndCarry.attractive,
        }
      : null,
    sampleSize: result.sampleSize,
  };
}
