/**
 * Volume Zone Oscillator (Waxman).
 *
 *   VZO = 100 × EMA(signed_volume, period) / EMA(volume, period)
 *   signed_volume[i] = volume[i] × sign(close[i] − close[i−1])
 *
 * A *volume*-momentum oscillator: it measures whether volume is accumulating on
 * up-closes or down-closes, bounded roughly to ±60. Distinct from MFI (money
 * flow, price×volume) and CMF. The classic use is RSI-vs-VZO divergence — price
 * momentum (RSI) vs volume momentum (VZO): a "scam pump" spikes RSI while VZO
 * stays flat (no real volume conviction behind the move).
 *
 * Pure; never throws. Neutral when there isn't enough data.
 */

export interface VZOInput {
  closes: number[];
  volumes: number[];
  /** EMA period. Default 14. */
  period?: number;
}

export type VZOZone = "overbought" | "bullish" | "neutral" | "bearish" | "oversold" | "insufficient";

export interface VZOResult {
  values: (number | null)[];
  current: number | null;
  zone: VZOZone;
  interpretation: string;
}

const DEFAULT_PERIOD = 14;
const OVERBOUGHT = 40;
const OVERSOLD = -40;
const NEUTRAL_BAND = 5;

function emaInto(values: number[], period: number): number[] {
  const out: number[] = [];
  const alpha = 2 / (period + 1);
  let prev = values.length > 0 ? values[0]! : 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0]! : alpha * values[i]! + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

export function computeVZO(input: VZOInput): VZOResult {
  const period = Math.max(2, Math.floor(input.period ?? DEFAULT_PERIOD));
  const closes = input.closes;
  const volumes = input.volumes;
  const n = closes.length;

  const neutral: VZOResult = {
    values: closes.map(() => null),
    current: null,
    zone: "insufficient",
    interpretation: "insufficient data for VZO",
  };
  if (n < 2 || volumes.length !== n) return neutral;

  // Signed and raw volume over indices 1..n-1.
  const signed: number[] = [];
  const total: number[] = [];
  for (let i = 1; i < n; i++) {
    const dir = closes[i]! > closes[i - 1]! ? 1 : closes[i]! < closes[i - 1]! ? -1 : 0;
    signed.push(volumes[i]! * dir);
    total.push(volumes[i]!);
  }
  if (signed.length < period) return neutral;

  const emaSigned = emaInto(signed, period);
  const emaTotal = emaInto(total, period);

  const values: (number | null)[] = [null]; // index 0 has no prior close
  for (let k = 0; k < emaSigned.length; k++) {
    const denom = emaTotal[k]!;
    values.push(denom !== 0 ? parseFloat(((100 * emaSigned[k]!) / denom).toFixed(4)) : 0);
  }

  const current = values[values.length - 1] ?? null;
  let zone: VZOZone = "neutral";
  if (current === null) zone = "insufficient";
  else if (current >= OVERBOUGHT) zone = "overbought";
  else if (current <= OVERSOLD) zone = "oversold";
  else if (current > NEUTRAL_BAND) zone = "bullish";
  else if (current < -NEUTRAL_BAND) zone = "bearish";
  else zone = "neutral";

  const interpretation =
    current === null
      ? "insufficient data for VZO"
      : `VZO ${current} — ${zone} (volume ${current >= 0 ? "accumulating on up-closes" : "accumulating on down-closes"}; ` +
        `≥${OVERBOUGHT} overbought / ≤${OVERSOLD} oversold)`;

  return { values, current, zone, interpretation };
}
