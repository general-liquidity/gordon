/**
 * Shewhart control chart with Western Electric run rules.
 *
 * Deming's distinction (Out of the Crisis, 1982, after Shewhart 1931):
 * a process metric varies for two reasons. COMMON-cause variation is
 * the in-control noise baked into the process — expected, no single
 * culprit, do not react to it point-by-point. SPECIAL-cause variation
 * is an assignable break — a specific defect that, left alone, erodes
 * trust. The whole job is to tell them apart so you react to the second
 * and leave the first alone (reacting to common-cause noise = Deming's
 * "tampering", which inflates variance).
 *
 * Applied to a trading metric stream — realized R-multiples per trade,
 * slippage per fill, daily PnL, or eval scores per session — this flags
 * which latest deviations are merely noise versus an assignable break
 * worth investigating. It is the quality-control complement to
 * edgeDecayMonitor (recent-vs-baseline expectancy ratio, no σ-zones)
 * and cusum-filter (cumulative-sum sequential shift sampler): the
 * Western Electric rules detect single spikes, zone violations, and
 * runs/trends that those two miss.
 *
 * Center line and σ are estimated from the in-control window (the
 * supplied baseline, or the whole series if none given). σ is estimated
 * from the average moving range (R̄/1.128, the standard individuals-chart
 * estimator) rather than the raw standard deviation, so an outlier in
 * the baseline does not inflate the limits and mask itself.
 *
 * Western Electric rules evaluated per point (sided):
 *   1. one point beyond 3σ.
 *   2. 2 of 3 consecutive beyond 2σ on the same side.
 *   3. 4 of 5 consecutive beyond 1σ on the same side.
 *   4. 8 consecutive on the same side of the center line.
 */

export type ControlRule = "beyond_3sigma" | "two_of_three_2sigma" | "four_of_five_1sigma" | "run_of_eight";

export interface ControlSignal {
  index: number;
  value: number;
  rules: ControlRule[];
  side: "above" | "below";
}

export interface ControlChartResult {
  centerLine: number;
  sigma: number;
  upperControlLimit: number;
  lowerControlLimit: number;
  sampleSize: number;
  baselineSize: number;
  signals: ControlSignal[];
  inControl: boolean;
  interpretation: string;
}

function round6(x: number): number {
  return Number(x.toFixed(6));
}

function mean(xs: ReadonlyArray<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function neutral(why: string): ControlChartResult {
  return {
    centerLine: 0,
    sigma: 0,
    upperControlLimit: 0,
    lowerControlLimit: 0,
    sampleSize: 0,
    baselineSize: 0,
    signals: [],
    inControl: true,
    interpretation: `Neutral — ${why}.`,
  };
}

/**
 * Estimate σ for an individuals chart from the average moving range:
 * σ̂ = R̄ / d2, with d2 = 1.128 for a moving range of n=2. More robust
 * to a lone outlier than the sample standard deviation.
 */
function sigmaFromMovingRange(xs: ReadonlyArray<number>): number {
  if (xs.length < 2) return 0;
  let sumRange = 0;
  for (let i = 1; i < xs.length; i++) sumRange += Math.abs(xs[i]! - xs[i - 1]!);
  const meanRange = sumRange / (xs.length - 1);
  return meanRange / 1.128;
}

export function computeControlChart(input: {
  values: ReadonlyArray<number>;
  /**
   * In-control reference window used to estimate the center line and σ.
   * Defaults to the full series. Supply the known-good early stretch to
   * avoid letting a later break contaminate the limits.
   */
  baseline?: ReadonlyArray<number>;
}): ControlChartResult {
  const values = (input.values ?? []).filter((v) => Number.isFinite(v));
  if (values.length < 2) {
    return neutral("need at least 2 finite values");
  }

  const baseline = (input.baseline ?? values).filter((v) => Number.isFinite(v));
  if (baseline.length < 2) {
    return neutral("need at least 2 finite baseline values");
  }

  const center = mean(baseline);
  const sigma = sigmaFromMovingRange(baseline);
  if (!(sigma > 0)) {
    return neutral("baseline has zero variation — control limits undefined");
  }

  // Standardized z-score and which σ-zone each point lives in.
  const z = values.map((v) => (v - center) / sigma);
  const side = (i: number): "above" | "below" => (z[i]! >= 0 ? "above" : "below");

  const signalsByIndex = new Map<number, Set<ControlRule>>();
  const add = (i: number, rule: ControlRule) => {
    let set = signalsByIndex.get(i);
    if (set == null) {
      set = new Set<ControlRule>();
      signalsByIndex.set(i, set);
    }
    set.add(rule);
  };

  for (let i = 0; i < values.length; i++) {
    // Rule 1: beyond 3σ.
    if (Math.abs(z[i]!) > 3) add(i, "beyond_3sigma");

    // Rule 2: 2 of 3 consecutive beyond 2σ on the same side (flag the
    // most recent point of the triggering window).
    if (i >= 2) {
      for (const sgn of [1, -1] as const) {
        let cnt = 0;
        for (let j = i - 2; j <= i; j++) if (sgn * z[j]! > 2) cnt++;
        if (cnt >= 2 && sgn * z[i]! > 2) add(i, "two_of_three_2sigma");
      }
    }

    // Rule 3: 4 of 5 consecutive beyond 1σ on the same side.
    if (i >= 4) {
      for (const sgn of [1, -1] as const) {
        let cnt = 0;
        for (let j = i - 4; j <= i; j++) if (sgn * z[j]! > 1) cnt++;
        if (cnt >= 4 && sgn * z[i]! > 1) add(i, "four_of_five_1sigma");
      }
    }

    // Rule 4: 8 consecutive on the same side of the center line.
    if (i >= 7) {
      for (const sgn of [1, -1] as const) {
        let all = true;
        for (let j = i - 7; j <= i; j++) if (sgn * z[j]! <= 0) all = false;
        if (all) add(i, "run_of_eight");
      }
    }
  }

  const signals: ControlSignal[] = [];
  for (const [index, ruleSet] of [...signalsByIndex.entries()].sort((a, b) => a[0] - b[0])) {
    signals.push({
      index,
      value: round6(values[index]!),
      rules: [...ruleSet],
      side: side(index),
    });
  }

  const inControl = signals.length === 0;
  const latestSignal = signals.length > 0 ? signals[signals.length - 1]! : null;
  const lastFlagged = latestSignal != null && latestSignal.index === values.length - 1;

  const interpretation = inControl
    ? `In control — ${values.length} points within Western Electric limits (center ${round6(center)}, σ ${round6(sigma)}). Variation is common-cause; do not tamper.`
    : `${signals.length} special-cause signal${signals.length === 1 ? "" : "s"} ` +
      `(center ${round6(center)}, σ ${round6(sigma)})` +
      (lastFlagged
        ? `; the LATEST point (${round6(latestSignal!.value)}, ${latestSignal!.side}) is assignable [${latestSignal!.rules.join(", ")}] — investigate, don't write off as noise.`
        : `; latest point is in control, prior breaks at indices [${signals.map((s) => s.index).join(", ")}].`);

  return {
    centerLine: round6(center),
    sigma: round6(sigma),
    upperControlLimit: round6(center + 3 * sigma),
    lowerControlLimit: round6(center - 3 * sigma),
    sampleSize: values.length,
    baselineSize: baseline.length,
    signals,
    inControl,
    interpretation,
  };
}
