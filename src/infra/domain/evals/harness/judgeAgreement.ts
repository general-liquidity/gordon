/**
 * Judge-vs-human agreement — Cohen's kappa (+ optional Spearman rho).
 *
 * `evaluatorCalibration.ts` anchors the judge's score SCALE against gold
 * examples (does a known input still score what it should?), but never asks the
 * separate reliability question: does the automated judge AGREE with the human
 * who triaged the gold / promotion set? Scale-anchoring and inter-rater
 * agreement are different failures — a judge can be perfectly on-scale and
 * still disagree with the human on which trajectories pass.
 *
 * This module computes the standard inter-rater metrics between the judge's
 * labels and the human's labels over a shared set:
 *   - Cohen's kappa — agreement corrected for chance. Raw agreement over-counts
 *     when one label dominates; kappa nets out the agreement expected at
 *     random. The book's reliability bar: kappa > 0.6 (substantial) and raw
 *     agreement > 80%.
 *   - Spearman rho — optional rank correlation between the underlying numeric
 *     scores (before they were thresholded into labels), so a judge that
 *     orders items like the human but draws the pass/fail line elsewhere still
 *     reads as correlated.
 *
 * Pure: no I/O, no clock, no randomness. The caller supplies the paired labels
 * (e.g. derived from the promotion queue's human triage vs the judge's score).
 */

export interface LabelPair {
  /** The automated judge's categorical label for this item. */
  judge: string;
  /** The human triager's categorical label for the same item. */
  human: string;
}

export interface JudgeAgreementInput {
  /** Paired categorical labels — one entry per item both rated. */
  pairs: ReadonlyArray<LabelPair>;
  /**
   * Optional aligned numeric scores (same order/length as `pairs`) for
   * Spearman rho. Absent => the report omits `spearman`.
   */
  judgeScores?: ReadonlyArray<number>;
  humanScores?: ReadonlyArray<number>;
  /** Kappa bar for `meetsBar`. Default 0.6 (substantial agreement). */
  kappaBar?: number;
  /** Raw-agreement bar for `meetsBar`. Default 0.8 (80%). */
  agreementBar?: number;
}

export interface JudgeAgreementReport {
  /** Number of paired items. */
  n: number;
  /** Cohen's kappa in [-1, 1]. */
  kappa: number;
  /** Raw exact-match fraction in [0, 1]. */
  agreement: number;
  /** Spearman rank correlation in [-1, 1], when numeric scores were supplied. */
  spearman?: number;
  /** Distinct labels observed across both raters. */
  categories: ReadonlyArray<string>;
  kappaBar: number;
  agreementBar: number;
  /** True iff kappa > kappaBar AND agreement > agreementBar. */
  meetsBar: boolean;
}

/**
 * Cohen's kappa between two raters over paired categorical labels.
 * Returns 1 for perfect agreement (including the degenerate single-category
 * case where chance agreement is 1), 0 when observed agreement equals chance.
 */
export function cohensKappa(pairs: ReadonlyArray<LabelPair>): number {
  const n = pairs.length;
  if (n === 0) return 0;

  let agree = 0;
  const judgeCount = new Map<string, number>();
  const humanCount = new Map<string, number>();
  for (const { judge, human } of pairs) {
    if (judge === human) agree++;
    judgeCount.set(judge, (judgeCount.get(judge) ?? 0) + 1);
    humanCount.set(human, (humanCount.get(human) ?? 0) + 1);
  }

  const po = agree / n;
  let pe = 0;
  for (const [label, jc] of judgeCount) {
    const hc = humanCount.get(label) ?? 0;
    pe += (jc / n) * (hc / n);
  }

  if (pe >= 1) return po >= 1 ? 1 : 0; // no label variety to disagree over
  return (po - pe) / (1 - pe);
}

/**
 * Spearman rank correlation between two aligned numeric series (ties get
 * average ranks). Returns 0 for degenerate input (length < 2 or zero variance).
 */
export function spearmanRho(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ra = averageRanks(a.slice(0, n));
  const rb = averageRanks(b.slice(0, n));
  return pearson(ra, rb);
}

/**
 * Threshold a numeric score series into "pass" / "fail" labels — the usual way
 * to turn a continuous judge score and a human gold score into the categorical
 * inputs kappa needs. `score >= threshold` => "pass".
 */
export function binarizeByThreshold(
  scores: ReadonlyArray<number>,
  threshold: number,
): string[] {
  return scores.map((s) => (s >= threshold ? "pass" : "fail"));
}

/** Compute the full judge-reliability report from paired labels. */
export function computeJudgeAgreement(input: JudgeAgreementInput): JudgeAgreementReport {
  const { pairs } = input;
  const kappaBar = input.kappaBar ?? 0.6;
  const agreementBar = input.agreementBar ?? 0.8;
  const n = pairs.length;

  const agree = pairs.reduce((c, p) => c + (p.judge === p.human ? 1 : 0), 0);
  const agreement = n === 0 ? 0 : agree / n;
  const kappa = cohensKappa(pairs);

  const categories = Array.from(
    new Set(pairs.flatMap((p) => [p.judge, p.human])),
  ).sort();

  let spearman: number | undefined;
  if (input.judgeScores && input.humanScores) {
    spearman = spearmanRho(input.judgeScores, input.humanScores);
  }

  return {
    n,
    kappa: Number(kappa.toFixed(4)),
    agreement: Number(agreement.toFixed(4)),
    ...(spearman !== undefined && { spearman: Number(spearman.toFixed(4)) }),
    categories,
    kappaBar,
    agreementBar,
    meetsBar: kappa > kappaBar && agreement > agreementBar,
  };
}

/**
 * Convenience: compute the reliability report directly from aligned numeric
 * judge and human scores. Both series are thresholded into pass/fail for kappa
 * + raw agreement, and the raw scores feed Spearman rho. This is the common
 * path — a judge emits a 0..1 score, the human gold set carries a 0..1 score,
 * and `threshold` (default 0.5) is the pass line.
 */
export function agreementFromScores(
  judgeScores: ReadonlyArray<number>,
  humanScores: ReadonlyArray<number>,
  opts: { threshold?: number; kappaBar?: number; agreementBar?: number } = {},
): JudgeAgreementReport {
  const threshold = opts.threshold ?? 0.5;
  const n = Math.min(judgeScores.length, humanScores.length);
  const jl = binarizeByThreshold(judgeScores.slice(0, n), threshold);
  const hl = binarizeByThreshold(humanScores.slice(0, n), threshold);
  const pairs: LabelPair[] = jl.map((judge, i) => ({ judge, human: hl[i]! }));
  return computeJudgeAgreement({
    pairs,
    judgeScores: judgeScores.slice(0, n),
    humanScores: humanScores.slice(0, n),
    kappaBar: opts.kappaBar,
    agreementBar: opts.agreementBar,
  });
}

/** Pretty-print the reliability report for CI logs. */
export function formatAgreementReport(report: JudgeAgreementReport): string {
  const verdict = report.meetsBar ? "RELIABLE" : "UNRELIABLE";
  const lines: string[] = [];
  lines.push(
    `[judge-agreement] ${verdict} — kappa ${report.kappa.toFixed(3)} (bar >${report.kappaBar}), agreement ${(report.agreement * 100).toFixed(1)}% (bar >${(report.agreementBar * 100).toFixed(0)}%), n=${report.n}`,
  );
  if (report.spearman !== undefined) {
    lines.push(`  spearman rho: ${report.spearman.toFixed(3)}`);
  }
  return lines.join("\n");
}

// ── internals ──

function averageRanks(xs: ReadonlyArray<number>): number[] {
  const n = xs.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((i, j) => xs[i]! - xs[j]!);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && xs[idx[j + 1]!]! === xs[idx[i]!]!) j++;
    // Ranks are 1-based; ties in [i, j] share the average rank.
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!] = avg;
    i = j + 1;
  }
  return ranks;
}

function pearson(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i]! - ma;
    const xb = b[i]! - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}
