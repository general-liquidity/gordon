import { deflatedSharpeRatio } from "../../trading/ops/backtestCredibility.ts";

/**
 * A pure, dependency-injected "generate → backtest → deflated-gate → learn"
 * research loop.
 *
 * The "loop engineering for quant research" pattern (mine factors until enough
 * pass) is right in SHAPE but the naive implementation gates on IN-SAMPLE ICIR
 * and mines hundreds of candidates per day WITHOUT correcting for the number of
 * trials. That manufactures false alpha: with enough draws, pure noise will
 * eventually produce an impressive in-sample Sharpe. This is the multiple-
 * testing trap.
 *
 * The differentiator here is the stop-hook: a candidate is approved ONLY if its
 * DEFLATED-Sharpe is significant given the CUMULATIVE number of trials run so
 * far — not against an in-sample metric. Every backtested candidate increments
 * the trial counter (trials NEVER reset across candidates), so the significance
 * bar rises as you search harder. That is the correction the naive loop omits.
 *
 * This module performs NO I/O and spawns NO live agents. `generate`, `backtest`,
 * and `score` are injected, so the orchestration is fully testable with
 * synthetic callbacks.
 */

export interface Hypothesis {
  id: string;
  description: string;
}

export interface Candidate {
  hypothesis: Hypothesis;
  /** Out-of-sample period returns produced by the backtest. */
  oosReturns: number[];
}

export interface LoopConfig {
  /** Stop once this many candidates have been approved. */
  targetApproved: number;
  /** Hard cap on generate→backtest iterations. */
  maxIterations: number;
  /**
   * If set, reject a candidate whose pairwise return correlation with ANY
   * already-approved candidate is >= this value (de-duplication of edges).
   */
  maxCorrelation?: number;
  /** If set, reject candidates with fewer than this many OOS observations. */
  minTrades?: number;
}

export type RejectReason =
  | "deflation"
  | "non_positive_sharpe"
  | "correlated"
  | "insufficient_trades"
  /** The injected `backtest` threw. The trial still counts. */
  | "backtest_failed";

export interface RejectedCandidate {
  /** Null when the backtest itself threw, so no candidate was produced. */
  candidate: Candidate | null;
  reason: RejectReason;
  /** Sharpe reported by `score` for this candidate (may be in-sample-looking). */
  sharpe: number;
  /** Cumulative trial count AT the moment this candidate was scored. */
  trialsAtScore: number;
}

export interface ScoreResult {
  sharpe: number;
  deflatedSignificant: boolean;
}

/**
 * The failure-pattern memory handed back to `generate` so the next hypothesis
 * can steer away from what has already failed. Pure data — no behavior.
 */
export interface ResearchMemory {
  approved: Candidate[];
  rejected: RejectedCandidate[];
  /** Count of rejections bucketed by reason. */
  rejectionCounts: Record<RejectReason, number>;
  /** Cumulative trials run so far (every backtested candidate counts). */
  trials: number;
  iterations: number;
}

export type StopReason = "target_reached" | "max_iterations";

export interface LoopResult {
  approved: Candidate[];
  rejected: RejectedCandidate[];
  /**
   * Total trials run. This is the multiple-testing trial count that the
   * deflated-Sharpe gate was corrected against — it accumulates across ALL
   * backtested candidates and is never reset.
   */
  trials: number;
  iterations: number;
  stopReason: StopReason;
}

export interface ResearchLoopDeps {
  generate: (memory: ResearchMemory) => Promise<Hypothesis> | Hypothesis;
  backtest: (hypothesis: Hypothesis) => Promise<Candidate> | Candidate;
  /**
   * Scores OOS returns against the CUMULATIVE trial count. The loop injects the
   * trial count so the deflation bar reflects how hard the search has worked.
   */
  score: (oosReturns: number[], totalTrials: number) => ScoreResult;
}

/**
 * Pearson correlation of two return series over their overlapping prefix.
 * Returns 0 when there is not enough overlap or a series has no variance —
 * "no measurable correlation" is the safe default for the de-dup filter.
 */
export function pairwiseCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]!;
    sumB += b[i]!;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 0 || varB <= 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Default `score` helper wrapping `deflatedSharpeRatio`. Callers may inject
 * their own `score`, but this gives a sensible deflation-aware default that
 * already corrects for the cumulative trial count.
 */
export function defaultDeflatedScore(periodsPerYear: number = 365) {
  return (oosReturns: number[], totalTrials: number): ScoreResult => {
    const result = deflatedSharpeRatio(oosReturns, Math.max(1, totalTrials), periodsPerYear);
    return {
      sharpe: result.observedSharpe,
      deflatedSignificant: result.significant,
    };
  };
}

function emptyRejectionCounts(): Record<RejectReason, number> {
  return {
    deflation: 0,
    non_positive_sharpe: 0,
    correlated: 0,
    insufficient_trades: 0,
    backtest_failed: 0,
  };
}

export async function runDeflatedResearchLoop(
  deps: ResearchLoopDeps,
  config: LoopConfig,
): Promise<LoopResult> {
  const approved: Candidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const rejectionCounts = emptyRejectionCounts();

  let trials = 0;
  let iterations = 0;
  let stopReason: StopReason = "max_iterations";

  while (iterations < config.maxIterations) {
    iterations++;

    const memory: ResearchMemory = {
      approved,
      rejected,
      rejectionCounts,
      trials,
      iterations,
    };

    const hypothesis = await deps.generate(memory);

    // KEY INVARIANT: every EMITTED candidate is a trial. The counter only ever
    // increments (it is never reset per candidate or per iteration), so the
    // deflated-Sharpe bar rises the harder we search. This is the honest
    // multiple-testing correction the naive in-sample loop omits.
    //
    // It increments BEFORE the backtest: a candidate whose backtest throws
    // still consumed a null draw. Counting only the ones that survived to be
    // scored understates the search burden and lowers the bar.
    trials++;

    let candidate: Candidate;
    try {
      candidate = await deps.backtest(hypothesis);
    } catch {
      rejectionCounts.backtest_failed++;
      rejected.push({
        candidate: null,
        reason: "backtest_failed",
        sharpe: 0,
        trialsAtScore: trials,
      });
      continue;
    }

    const { sharpe, deflatedSignificant } = deps.score(candidate.oosReturns, trials);

    const reject = (reason: RejectReason): void => {
      rejectionCounts[reason]++;
      rejected.push({ candidate, reason, sharpe, trialsAtScore: trials });
    };

    if (config.minTrades !== undefined && candidate.oosReturns.length < config.minTrades) {
      reject("insufficient_trades");
      continue;
    }

    if (!deflatedSignificant) {
      reject("deflation");
      continue;
    }

    if (!(sharpe > 0)) {
      reject("non_positive_sharpe");
      continue;
    }

    if (config.maxCorrelation !== undefined) {
      const tooCorrelated = approved.some(
        (a) =>
          Math.abs(pairwiseCorrelation(candidate.oosReturns, a.oosReturns)) >=
          config.maxCorrelation!,
      );
      if (tooCorrelated) {
        reject("correlated");
        continue;
      }
    }

    approved.push(candidate);

    if (approved.length >= config.targetApproved) {
      stopReason = "target_reached";
      break;
    }
  }

  return { approved, rejected, trials, iterations, stopReason };
}
