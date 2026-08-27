/**
 * MAMA / FAMA — Ehlers' MESA Adaptive Moving Average.
 *
 * Faithful port of John Ehlers' "MESA Adaptive Moving Averages" (mesasoftware.com).
 * A Hilbert-transform homodyne discriminator measures the dominant cycle period;
 * the rate of phase change sets an adaptive smoothing alpha (between slowLimit and
 * fastLimit), so MAMA tracks tightly when the market moves and smooths when it
 * stalls. FAMA (Following Adaptive MA) is the slower companion; MAMA crossing
 * above/below FAMA is the canonical signal.
 *
 * Distinct from Gordon's other adaptive MAs: KAMA (efficiency-ratio alpha) and
 * VIDYA (CMO-volatility alpha) — MAMA's alpha is driven by measured cycle phase.
 * Recursive with a warmup; early values are unstable until the discriminator
 * settles (~20-30 bars). Pure; never throws or returns NaN.
 */

export interface MAMAInput {
  /** Price series — typically close or (high+low)/2. */
  values: number[];
  /** Upper alpha bound. Default 0.5. */
  fastLimit?: number;
  /** Lower alpha bound. Default 0.05. */
  slowLimit?: number;
}

export interface MAMAResult {
  mama: (number | null)[];
  fama: (number | null)[];
  current: { mama: number | null; fama: number | null };
  /** MAMA/FAMA crossover on the latest bar. */
  cross: "bullish" | "bearish" | "none";
  interpretation: string;
}

const WARMUP = 6;
const RAD2DEG = 180 / Math.PI;
const atanDeg = (x: number): number => Math.atan(x) * RAD2DEG;

export function computeMAMA(input: MAMAInput): MAMAResult {
  const price = input.values;
  const fastLimit = input.fastLimit ?? 0.5;
  const slowLimit = input.slowLimit ?? 0.05;
  const n = price.length;

  if (n < 10) {
    return {
      mama: price.map(() => null),
      fama: price.map(() => null),
      current: { mama: null, fama: null },
      cross: "none",
      interpretation: "insufficient data for MAMA (need ≥ 10 bars)",
    };
  }

  const z = (): number[] => new Array(n).fill(0);
  const Smooth = z();
  const Detrender = z();
  const I1 = z();
  const Q1 = z();
  const I2 = z();
  const Q2 = z();
  const Re = z();
  const Im = z();
  const Period = z();
  const SmoothPeriod = z();
  const Phase = z();
  const MAMA = z();
  const FAMA = z();
  const at = (arr: number[], i: number): number => (i >= 0 ? arr[i]! : 0);

  for (let i = 0; i < n; i++) {
    if (i < WARMUP) {
      Smooth[i] = price[i]!;
      MAMA[i] = price[i]!;
      FAMA[i] = price[i]!;
      continue;
    }
    Smooth[i] = (4 * price[i]! + 3 * price[i - 1]! + 2 * price[i - 2]! + price[i - 3]!) / 10;
    const adj = 0.075 * at(Period, i - 1) + 0.54;
    Detrender[i] =
      (0.0962 * Smooth[i]! +
        0.5769 * at(Smooth, i - 2) -
        0.5769 * at(Smooth, i - 4) -
        0.0962 * at(Smooth, i - 6)) *
      adj;

    // Quadrature (Q1) and in-phase (I1) components.
    Q1[i] =
      (0.0962 * Detrender[i]! +
        0.5769 * at(Detrender, i - 2) -
        0.5769 * at(Detrender, i - 4) -
        0.0962 * at(Detrender, i - 6)) *
      adj;
    I1[i] = at(Detrender, i - 3);

    // Advance phase of I1, Q1 by 90°.
    const jI =
      (0.0962 * I1[i]! + 0.5769 * at(I1, i - 2) - 0.5769 * at(I1, i - 4) - 0.0962 * at(I1, i - 6)) *
      adj;
    const jQ =
      (0.0962 * Q1[i]! + 0.5769 * at(Q1, i - 2) - 0.5769 * at(Q1, i - 4) - 0.0962 * at(Q1, i - 6)) *
      adj;

    // Phasor addition for 3-bar averaging, then smooth.
    I2[i] = 0.2 * (I1[i]! - jQ) + 0.8 * at(I2, i - 1);
    Q2[i] = 0.2 * (Q1[i]! + jI) + 0.8 * at(Q2, i - 1);

    // Homodyne discriminator.
    Re[i] = 0.2 * (I2[i]! * at(I2, i - 1) + Q2[i]! * at(Q2, i - 1)) + 0.8 * at(Re, i - 1);
    Im[i] = 0.2 * (I2[i]! * at(Q2, i - 1) - Q2[i]! * at(I2, i - 1)) + 0.8 * at(Im, i - 1);

    let per: number;
    if (Im[i] !== 0 && Re[i] !== 0) per = 360 / atanDeg(Im[i]! / Re[i]!);
    else per = at(Period, i - 1);
    const prevPer = at(Period, i - 1) || per;
    if (per > 1.5 * prevPer) per = 1.5 * prevPer;
    if (per < 0.67 * prevPer) per = 0.67 * prevPer;
    if (per < 6) per = 6;
    if (per > 50) per = 50;
    Period[i] = 0.2 * per + 0.8 * at(Period, i - 1);
    SmoothPeriod[i] = 0.33 * Period[i]! + 0.67 * at(SmoothPeriod, i - 1);

    Phase[i] = I1[i] !== 0 ? atanDeg(Q1[i]! / I1[i]!) : at(Phase, i - 1);
    let deltaPhase = at(Phase, i - 1) - Phase[i]!;
    if (deltaPhase < 1) deltaPhase = 1;
    let alpha = fastLimit / deltaPhase;
    if (alpha < slowLimit) alpha = slowLimit;

    MAMA[i] = alpha * price[i]! + (1 - alpha) * at(MAMA, i - 1);
    FAMA[i] = 0.5 * alpha * MAMA[i]! + (1 - 0.5 * alpha) * at(FAMA, i - 1);
  }

  const r4 = (x: number): number => parseFloat(x.toFixed(6));
  const mamaOut: (number | null)[] = MAMA.map((v, i) => (i < WARMUP ? null : r4(v)));
  const famaOut: (number | null)[] = FAMA.map((v, i) => (i < WARMUP ? null : r4(v)));

  const lastM = mamaOut[n - 1];
  const lastF = famaOut[n - 1];
  const prevM = mamaOut[n - 2];
  const prevF = famaOut[n - 2];
  let cross: MAMAResult["cross"] = "none";
  if (lastM != null && lastF != null && prevM != null && prevF != null) {
    if (prevM <= prevF && lastM > lastF) cross = "bullish";
    else if (prevM >= prevF && lastM < lastF) cross = "bearish";
  }

  const interpretation =
    lastM == null || lastF == null
      ? "insufficient data for MAMA"
      : `MAMA ${lastM} vs FAMA ${lastF} (${lastM >= lastF ? "MAMA above — bullish" : "MAMA below — bearish"})` +
        (cross !== "none" ? ` — ${cross} crossover this bar` : "");

  return {
    mama: mamaOut,
    fama: famaOut,
    current: { mama: lastM ?? null, fama: lastF ?? null },
    cross,
    interpretation,
  };
}
