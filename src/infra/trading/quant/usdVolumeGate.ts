/**
 * USD-Denominated Rolling Liquidity Gate — LV1.
 *
 * Filters tradeable symbols by rolling USD volume rather than raw
 * contract count. Raw volume is misleading because it shows contracts,
 * not dollars — a coin at $0.50 with 1M contracts and a coin at $50
 * with 10K contracts are identical in liquidity but visually opposite
 * in raw volume.
 *
 * Pattern:
 *   per-candle USD volume = close × volume
 *   rolling average over `maPeriod` candles (default 60)
 *   tradeable iff rollingAvg ≥ thresholdUSD (default $100K)
 *
 * The $100K threshold @ 60-period 1-minute MA is the ZCT convention
 * for Binance crypto perps; defaults are operator-tunable per venue
 * and timeframe. Lower-frequency strategies should scale the threshold
 * proportionally (e.g., $10M at 1-hour candles).
 *
 * Pedigree: prop-trading discipline (ZCT 2025 volume masterclass), the
 * same family as the TM-tier and D-tier primitives. Direct operator-
 * shadow value: filtering illiquid symbols protects every downstream
 * statistical edge from slippage drag.
 *
 * Pure compute. No I/O.
 */

export interface VolumeGateCandle {
  /** Closing price for the candle (any currency). */
  close: number;
  /** Volume in contract / base-asset units (not USD). */
  volume: number;
}

export interface UsdVolumeGateInput {
  /** Recent candle history (ordered oldest → newest is fine; order doesn't matter for the MA). */
  candles: ReadonlyArray<VolumeGateCandle>;
  /** MA window. Default 60 (matches ZCT convention for 1m candles). */
  maPeriod?: number;
  /** USD liquidity threshold. Default 100_000 ($100K). */
  thresholdUSD?: number;
}

export interface UsdVolumeGateResult {
  candleCount: number;
  effectiveMaPeriod: number;
  latestVolUSD: number;
  rollingAvgVolUSD: number;
  thresholdUSD: number;
  tradeable: boolean;
  /** "tradeable" | "skip" verdict. */
  verdict: "tradeable" | "skip";
  reasoning: string;
}

const DEFAULT_MA_PERIOD = 60;
const DEFAULT_THRESHOLD_USD = 100_000;

export function evaluateUsdVolumeGate(input: UsdVolumeGateInput): UsdVolumeGateResult {
  if (input.candles.length === 0) {
    throw new Error("candles must not be empty");
  }
  const maPeriod = input.maPeriod ?? DEFAULT_MA_PERIOD;
  const thresholdUSD = input.thresholdUSD ?? DEFAULT_THRESHOLD_USD;
  if (maPeriod < 1) {
    throw new Error("maPeriod must be ≥ 1");
  }
  if (thresholdUSD <= 0) {
    throw new Error("thresholdUSD must be > 0");
  }

  for (let i = 0; i < input.candles.length; i++) {
    const c = input.candles[i]!;
    if (!Number.isFinite(c.close) || c.close <= 0) {
      throw new Error(`candles[${i}].close must be > 0 (got ${c.close})`);
    }
    if (!Number.isFinite(c.volume) || c.volume < 0) {
      throw new Error(`candles[${i}].volume must be ≥ 0 (got ${c.volume})`);
    }
  }

  // Use last `maPeriod` candles (or all available if fewer).
  const effectiveMaPeriod = Math.min(maPeriod, input.candles.length);
  const tail = input.candles.slice(input.candles.length - effectiveMaPeriod);

  let sumVolUSD = 0;
  for (const c of tail) {
    sumVolUSD += c.close * c.volume;
  }
  const rollingAvgVolUSD = sumVolUSD / effectiveMaPeriod;

  const latestCandle = input.candles[input.candles.length - 1]!;
  const latestVolUSD = latestCandle.close * latestCandle.volume;

  const tradeable = rollingAvgVolUSD >= thresholdUSD;
  const verdict: "tradeable" | "skip" = tradeable ? "tradeable" : "skip";

  const reasoning =
    `${effectiveMaPeriod}-period rolling avg USD volume = $${rollingAvgVolUSD.toFixed(0)} ` +
    `(latest candle $${latestVolUSD.toFixed(0)}), threshold $${thresholdUSD.toFixed(0)} → ${verdict}` +
    `${tradeable ? "" : " (insufficient liquidity, slippage will drain edge)"}.`;

  return {
    candleCount: input.candles.length,
    effectiveMaPeriod,
    latestVolUSD,
    rollingAvgVolUSD,
    thresholdUSD,
    tradeable,
    verdict,
    reasoning,
  };
}

export function usdVolumeGateToPayload(result: UsdVolumeGateResult): Record<string, unknown> {
  return {
    kind: "usd_volume_gate.evaluated",
    rollingAvgVolUSD: Number(result.rollingAvgVolUSD.toFixed(2)),
    latestVolUSD: Number(result.latestVolUSD.toFixed(2)),
    thresholdUSD: result.thresholdUSD,
    tradeable: result.tradeable,
    verdict: result.verdict,
    effectiveMaPeriod: result.effectiveMaPeriod,
  };
}
