/**
 * Signal pool — ensemble voting across N boolean indicator outputs.
 *
 * Pattern from Build Alpha (Bergstrom) + ML ensembling literature.
 * The premise: most individual indicators barely carry edge alone in
 * a high-noise environment (trading). But a vote across N weak
 * signals can be informative — "67% of selected signals true right
 * now" vs "8% true" tells you something one signal can't.
 *
 * Two main use cases:
 *
 *   1. Parameter-risk reduction — pool the SAME indicator across
 *      multiple parameter sets. Don't bet on RSI(14); pool RSI at 7,
 *      14, 21, 28 thresholds.
 *
 *   2. Context aggregation — pool different KINDS of signals
 *      (price + positioning + volume + sentiment). Each looks at a
 *      different dimension; the vote captures their agreement.
 *
 * Pure function over boolean arrays. Per-bar output is the fraction
 * of signals true at that bar; the `fired` flag is set when fraction
 * meets or exceeds the threshold.
 */

export interface SignalPoolInput {
  /** Array of per-bar boolean signal arrays. All must be the same
   *  length. Either an array of `boolean[]` or an array of `number[]`
   *  where 0 = false, non-zero = true. */
  signals: Array<boolean[]> | Array<number[]>;
  /** Fraction of signals required to fire (0..1). Default 0.5
   *  (majority vote). */
  threshold?: number;
}

export interface SignalPoolResult {
  /** Per-bar fraction of signals true (0..1). Length matches inputs. */
  fractions: number[];
  /** Per-bar fired flag — true when fraction >= threshold. */
  fired: boolean[];
  /** Total bars in the series. */
  barCount: number;
  /** Number of input signals pooled. */
  signalCount: number;
  /** Number of bars where the pool fired. */
  firedCount: number;
  /** Average fraction-true across the whole series (0..1). High
   *  values mean the pool is mostly agreeing; low means rarely. */
  meanFraction: number;
  /** Threshold actually used (after default substitution). */
  threshold: number;
}

function asBool(v: boolean | number): boolean {
  if (typeof v === "boolean") return v;
  return Number.isFinite(v) && v !== 0;
}

export function computeSignalPool(input: SignalPoolInput): SignalPoolResult {
  const threshold = input.threshold ?? 0.5;
  if (!(threshold >= 0 && threshold <= 1)) {
    throw new Error("computeSignalPool: threshold must be in [0, 1]");
  }
  const signals = input.signals;
  if (!Array.isArray(signals) || signals.length === 0) {
    return {
      fractions: [],
      fired: [],
      barCount: 0,
      signalCount: 0,
      firedCount: 0,
      meanFraction: 0,
      threshold,
    };
  }

  // Establish the canonical length from the FIRST signal; require all
  // others to match. Refuse to silently truncate or pad — that hides
  // alignment bugs in the caller.
  const barCount = signals[0]!.length;
  for (let i = 1; i < signals.length; i++) {
    if (signals[i]!.length !== barCount) {
      throw new Error(
        `computeSignalPool: signal ${i} length ${signals[i]!.length} does not match signal 0 length ${barCount}`,
      );
    }
  }

  const signalCount = signals.length;
  const fractions = new Array<number>(barCount);
  const fired = new Array<boolean>(barCount);
  let firedCount = 0;
  let sumFractions = 0;

  for (let bar = 0; bar < barCount; bar++) {
    let trueCount = 0;
    for (let s = 0; s < signalCount; s++) {
      if (asBool((signals[s] as Array<boolean | number>)[bar]!)) trueCount++;
    }
    const frac = trueCount / signalCount;
    fractions[bar] = frac;
    sumFractions += frac;
    const f = frac >= threshold;
    fired[bar] = f;
    if (f) firedCount++;
  }

  return {
    fractions,
    fired,
    barCount,
    signalCount,
    firedCount,
    meanFraction: barCount > 0 ? sumFractions / barCount : 0,
    threshold,
  };
}
