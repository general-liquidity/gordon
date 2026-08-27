/**
 * PEAD gap-up composite grader.
 *
 * Post-Earnings-Announcement-Drift (PEAD) is the tendency for a stock
 * that gaps in the direction of an earnings surprise to keep drifting
 * that way. This primitive grades the PRICE SETUP of a post-earnings
 * gap-up, distinct from Gordon's earnings-transcript signal (which
 * scores guidance / sentiment, not the tape).
 *
 * The grade is a weighted composite of four structural components:
 *   1. gap-size            — how far the open gapped up vs prior close.
 *   2. pre-earnings-trend  — trailing return into the print (momentum
 *                            confirmation vs a fade from a downtrend).
 *   3. volume-ratio        — current volume vs its average (conviction).
 *   4. MA-relative-position — price vs a moving average (trend context).
 *
 * Each component is mapped to a 0..1 sub-score by a configurable linear
 * ramp, then combined with configurable weights into a 0..1 composite
 * and bucketed into an A / B / C / D grade.
 *
 * STRUCTURE ONLY. Every weight, ramp bound and grade band is a
 * configurable option. The defaults are neutral STRUCTURAL placeholders
 * (equal weights, evenly-spaced grade bands, generic ramp bounds) — NOT
 * a fitted calibration. Recalibrate the weights and ramps on your own
 * data before trusting the letter grade; the source author's 517-trade
 * fit is deliberately NOT imported.
 *
 * Pure function. Caller supplies the already-computed component values;
 * no fetching, no indicator computation, no fitted parameters.
 */

export type PeadGrade = "A" | "B" | "C" | "D";

export interface PeadGapInput {
  /** Overnight gap: (open - priorClose) / priorClose, as a percent. */
  gapPercent: number;
  /**
   * Trailing return into the earnings print, as a percent. Positive =
   * uptrend into the report (momentum confirmation); negative = the gap
   * fights a prior downtrend.
   */
  preEarningsTrendPercent: number;
  /**
   * Current volume divided by its average (e.g. 20-session mean). 1 =
   * average, > 1 = above-average conviction.
   */
  volumeRatio: number;
  /**
   * Price relative to a moving average, as a percent above (+) or below
   * (-) the MA. Positive = trading above the MA (constructive).
   */
  maPositionPercent: number;
}

/**
 * Linear-ramp config for one component. `sub-score` = clamp01((value -
 * zeroAt) / (fullAt - zeroAt)). `fullAt` may be less than `zeroAt` to
 * invert the ramp (higher value = lower score).
 */
export interface ComponentRamp {
  /** Relative weight in the composite. Weights are normalized to sum 1. */
  weight: number;
  /** Value at/below which the sub-score is 0 (or 1 if inverted). */
  zeroAt: number;
  /** Value at/above which the sub-score is 1 (or 0 if inverted). */
  fullAt: number;
}

export interface PeadGapGraderOptions {
  gap?: Partial<ComponentRamp>;
  trend?: Partial<ComponentRamp>;
  volume?: Partial<ComponentRamp>;
  maPosition?: Partial<ComponentRamp>;
  /**
   * Composite thresholds (descending) for A / B / C. A composite at/above
   * `a` grades A, at/above `b` grades B, at/above `c` grades C, else D.
   * Default is the evenly-spaced structural band {a:0.75, b:0.5, c:0.25}.
   */
  gradeBands?: { a?: number; b?: number; c?: number };
}

export interface ComponentScore {
  name: "gap" | "trend" | "volume" | "maPosition";
  /** Raw component value the caller supplied. */
  rawValue: number;
  /** 0..1 sub-score after the ramp. */
  subScore: number;
  /** Normalized weight applied in the composite. */
  weight: number;
  /** subScore * weight — this component's contribution to the composite. */
  contribution: number;
}

export interface PeadGapGradeResult {
  grade: PeadGrade;
  /** Weighted 0..1 composite. */
  composite: number;
  components: ComponentScore[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Structural defaults. NEUTRAL placeholders, NOT a fitted calibration.
// Equal weights; ramp bounds chosen only to give a sane monotone response
// on the natural scale of each input. Override for your own data.
// ---------------------------------------------------------------------------

const DEFAULT_GAP: ComponentRamp = { weight: 1, zeroAt: 0, fullAt: 10 };
const DEFAULT_TREND: ComponentRamp = { weight: 1, zeroAt: 0, fullAt: 20 };
const DEFAULT_VOLUME: ComponentRamp = { weight: 1, zeroAt: 1, fullAt: 3 };
const DEFAULT_MA_POSITION: ComponentRamp = { weight: 1, zeroAt: 0, fullAt: 10 };

const DEFAULT_GRADE_BANDS = { a: 0.75, b: 0.5, c: 0.25 };

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function resolveRamp(defaults: ComponentRamp, override?: Partial<ComponentRamp>): ComponentRamp {
  return {
    weight: override?.weight ?? defaults.weight,
    zeroAt: override?.zeroAt ?? defaults.zeroAt,
    fullAt: override?.fullAt ?? defaults.fullAt,
  };
}

function rampScore(value: number, ramp: ComponentRamp): number {
  if (!Number.isFinite(value)) return 0;
  const span = ramp.fullAt - ramp.zeroAt;
  if (span === 0) return value >= ramp.zeroAt ? 1 : 0;
  return clamp01((value - ramp.zeroAt) / span);
}

/**
 * Grade a post-earnings gap-up setup into A / B / C / D from the four
 * structural components. All weights, ramps and bands are configurable.
 */
export function gradePeadGapUp(
  input: PeadGapInput,
  options: PeadGapGraderOptions = {},
): PeadGapGradeResult {
  const ramps = {
    gap: resolveRamp(DEFAULT_GAP, options.gap),
    trend: resolveRamp(DEFAULT_TREND, options.trend),
    volume: resolveRamp(DEFAULT_VOLUME, options.volume),
    maPosition: resolveRamp(DEFAULT_MA_POSITION, options.maPosition),
  };

  const raw: Record<ComponentScore["name"], number> = {
    gap: input.gapPercent,
    trend: input.preEarningsTrendPercent,
    volume: input.volumeRatio,
    maPosition: input.maPositionPercent,
  };

  // Normalize weights so callers can pass any positive magnitudes. A
  // non-positive total collapses to equal weighting.
  const weightTotal =
    ramps.gap.weight + ramps.trend.weight + ramps.volume.weight + ramps.maPosition.weight;
  const norm = weightTotal > 0 ? weightTotal : 4;

  const names: ComponentScore["name"][] = ["gap", "trend", "volume", "maPosition"];
  const components: ComponentScore[] = names.map((name) => {
    const ramp = ramps[name];
    const subScore = rampScore(raw[name], ramp);
    const weight = (weightTotal > 0 ? ramp.weight : 1) / norm;
    return {
      name,
      rawValue: parseFloat(raw[name].toFixed(4)),
      subScore: parseFloat(subScore.toFixed(4)),
      weight: parseFloat(weight.toFixed(4)),
      contribution: parseFloat((subScore * weight).toFixed(4)),
    };
  });

  const composite = clamp01(components.reduce((sum, c) => sum + c.subScore * c.weight, 0));

  const bands = {
    a: options.gradeBands?.a ?? DEFAULT_GRADE_BANDS.a,
    b: options.gradeBands?.b ?? DEFAULT_GRADE_BANDS.b,
    c: options.gradeBands?.c ?? DEFAULT_GRADE_BANDS.c,
  };

  let grade: PeadGrade;
  if (composite >= bands.a) grade = "A";
  else if (composite >= bands.b) grade = "B";
  else if (composite >= bands.c) grade = "C";
  else grade = "D";

  const strongest = [...components].sort((x, y) => y.contribution - x.contribution)[0]!;
  const weakest = [...components].sort((x, y) => x.subScore - y.subScore)[0]!;
  const summary =
    `PEAD gap-up grade ${grade} (composite ${(composite * 100).toFixed(0)}%). ` +
    `Strongest: ${strongest.name} (${(strongest.subScore * 100).toFixed(0)}%); ` +
    `weakest: ${weakest.name} (${(weakest.subScore * 100).toFixed(0)}%).`;

  return {
    grade,
    composite: parseFloat(composite.toFixed(4)),
    components,
    summary,
  };
}

export function formatPeadGapGrade(result: PeadGapGradeResult): string {
  const lines = [
    `PEAD Gap-Up Grade — ${result.grade} (${(result.composite * 100).toFixed(0)}%)`,
    "",
  ];
  for (const c of result.components) {
    lines.push(
      `  ${c.name.padEnd(11)} raw ${String(c.rawValue).padStart(8)}  ` +
        `sub ${(c.subScore * 100).toFixed(0).padStart(3)}%  ` +
        `w ${(c.weight * 100).toFixed(0).padStart(3)}%  ` +
        `contrib ${(c.contribution * 100).toFixed(0).padStart(3)}%`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
