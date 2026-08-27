/**
 * Strategy-Claim Verifier (Tom's allocator-deconstruction test)
 *
 * Given a return series + a strategy's claimed attributes, mechanically
 * verify that the actual statistical signature is consistent with the
 * claims. Tom's framing: "allocators can deconstruct your portfolio
 * from results alone." If you claim market-neutral but your return
 * distribution has short-gamma skew, either you don't know what you're
 * doing or you're being dishonest.
 *
 * Distinct from:
 *   - `composite-attribution.ts`     (forward attribution: verdict →
 *                                      input dimensions)
 *   - `decisionObservabilityDiagnostic` (per-decision self-declared
 *                                         prediction tracking)
 *   - `brierScoreDiagnostic`         (probability-emitter calibration)
 *   - `expectancy-by-tag`            (return decomposition by tag,
 *                                      forward direction)
 *
 * Use cases:
 *   1. Operator self-audit: "I think I'm market-neutral — am I?"
 *   2. External strategy evaluation: claims-vs-signature check before
 *      trusting a strategy's described risk profile
 *   3. Hidden-beta detection (Tom's basis-trader-hedging-at-2:59pm
 *      story): the strategy LOOKS market-neutral end-of-day but the
 *      return distribution betrays carried beta
 *
 * Tests supported:
 *   - claimedBeta vs realized beta (OLS regression on benchmark)
 *   - claimedGammaPosture (long / short / flat) vs realized skew +
 *     kurtosis + worst-day/best-day asymmetry
 *   - claimedSharpe vs realized Sharpe (with CI from sample size)
 *   - claimedMaxDrawdown vs realized max drawdown
 *   - claimedHoldingPeriod vs implied holding period from lag-1
 *     autocorrelation
 *
 * Pure function. Caller supplies the return + benchmark series.
 */
import { mean, sampleStd, pearsonCorrelation } from "./helpers.ts";
import { skewness as ssSkewness, kurtosis as ssKurtosis } from "../stats/index.ts";

export interface StrategyClaim {
  /** Optional claim: beta to benchmark. e.g. 0 = market-neutral. */
  beta?: number;
  /**
   * Optional claim: gamma posture.
   *   "long"  = positive convexity (long options-like, positive skew expected)
   *   "short" = negative convexity (short options-like, negative skew + fat left tail)
   *   "flat"  = approximately Gaussian (no significant skew/excess kurtosis)
   */
  gammaPosture?: "long" | "short" | "flat";
  /** Optional claim: annualized Sharpe ratio. */
  sharpe?: number;
  /** Optional claim: max drawdown as a positive magnitude in [0, 1]. */
  maxDrawdown?: number;
  /** Optional claim: average holding period in periods (days/bars). */
  holdingPeriodPeriods?: number;
}

export interface StrategyClaimVerifierInput {
  /**
   * Strategy return series, ordered oldest → newest. Returns expressed
   * as fractional (e.g. 0.01 = 1%) per period (typically daily).
   */
  strategyReturns: ReadonlyArray<number>;
  /**
   * Benchmark return series aligned 1:1 with `strategyReturns`. Required
   * iff the claim includes `beta`.
   */
  benchmarkReturns?: ReadonlyArray<number>;
  /** The strategy's claimed attributes. At least one claim must be set. */
  claims: StrategyClaim;
  /**
   * Annualization factor for Sharpe. Default 252 (US equity trading
   * days). Use 365 for crypto, 252 for equities, 12 for monthly data.
   */
  annualizationFactor?: number;
  /**
   * Tolerance for beta consistency, in absolute units. Default 0.10
   * (claimed beta within ±0.10 of realized = consistent).
   */
  betaTolerance?: number;
  /**
   * Tolerance for Sharpe consistency as a fraction. Default 0.25
   * (within 25% of claim = consistent).
   */
  sharpeTolerance?: number;
  /**
   * Tolerance for max drawdown consistency as a fraction. Default 0.25.
   */
  drawdownTolerance?: number;
  /**
   * Skew threshold above which gamma posture is "long" (positive skew).
   * Default 0.5.
   */
  skewLongThreshold?: number;
  /** Skew threshold below which gamma posture is "short". Default -0.5. */
  skewShortThreshold?: number;
  /** Excess kurtosis above which fat-tail risk is flagged. Default 1.0. */
  excessKurtosisThreshold?: number;
  /** Minimum periods required for a confident verdict. Default 60. */
  minPeriods?: number;
}

export type ClaimVerdict =
  | "consistent"
  | "inconsistent"
  | "insufficient_data"
  | "not_claimed"
  | "missing_input";

export interface ClaimCheckResult {
  /** Identifier for the specific claim being tested. */
  claim: string;
  /** What the strategy claimed (formatted as string for readability). */
  claimedValue: string;
  /** What the data actually shows. */
  realizedValue: string;
  verdict: ClaimVerdict;
  reason: string;
}

export type OverallVerdict =
  | "all_consistent"
  | "minor_inconsistencies"
  | "major_inconsistencies"
  | "insufficient_data";

export interface StrategyClaimVerifierResult {
  sampleSize: number;
  realized: {
    meanReturn: number;
    stdReturn: number;
    annualizedReturn: number;
    annualizedSharpe: number;
    maxDrawdown: number;
    skewness: number;
    excessKurtosis: number;
    beta: number | null;
    autocorrelation: number;
    impliedHoldingPeriod: number;
    worstDay: number;
    bestDay: number;
    worstBestRatio: number;
  };
  checks: ClaimCheckResult[];
  consistentCount: number;
  inconsistentCount: number;
  verdict: OverallVerdict;
  summary: string;
}

const DEFAULT_ANNUALIZATION = 252;
const DEFAULT_BETA_TOL = 0.1;
const DEFAULT_SHARPE_TOL = 0.25;
const DEFAULT_DD_TOL = 0.25;
const DEFAULT_SKEW_LONG = 0.5;
const DEFAULT_SKEW_SHORT = -0.5;
const DEFAULT_EXCESS_KURT = 1.0;
const DEFAULT_MIN_PERIODS = 60;

function maxDrawdown(returns: ReadonlyArray<number>): number {
  if (returns.length === 0) return 0;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function skewness(values: ReadonlyArray<number>): number {
  if (values.length < 3) return 0;
  if (sampleStd([...values]) === 0) return 0;
  return ssSkewness([...values]);
}

function excessKurtosis(values: ReadonlyArray<number>): number {
  if (values.length < 4) return 0;
  if (sampleStd([...values]) === 0) return 0;
  return ssKurtosis([...values]);
}

function olsBeta(y: ReadonlyArray<number>, x: ReadonlyArray<number>): number {
  if (y.length !== x.length || y.length < 2) return 0;
  const my = mean([...y]);
  const mx = mean([...x]);
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < y.length; i++) {
    const dy = y[i]! - my;
    const dx = x[i]! - mx;
    cov += dx * dy;
    varX += dx * dx;
  }
  if (varX === 0) return 0;
  return cov / varX;
}

function lag1Autocorr(values: ReadonlyArray<number>): number {
  if (values.length < 3) return 0;
  const lead = values.slice(1) as number[];
  const lag = values.slice(0, -1) as number[];
  return pearsonCorrelation(lag, lead) ?? 0;
}

/**
 * Holding period implied from lag-1 autocorrelation: stronger
 * positive autocorrelation → returns persist → longer holding
 * period implied. Crude proxy. Returns infinity when autocorr ≈ 1
 * (perfect persistence) and 1 when autocorr ≈ 0 (independent).
 */
function impliedHoldingPeriod(autocorr: number): number {
  if (autocorr <= 0) return 1;
  if (autocorr >= 1) return Infinity;
  // 1 / (1 - rho) — the AR(1) decorrelation timescale heuristic
  return 1 / (1 - autocorr);
}

function gammaPostureFromSignature(
  skew: number,
  exKurt: number,
  skewLong: number,
  skewShort: number,
  exKurtThresh: number,
): "long" | "short" | "flat" {
  // Short-gamma signature: negative skew (extreme losses worse than gains)
  //   AND fat tails (excess kurtosis above threshold)
  if (skew <= skewShort && exKurt >= exKurtThresh) return "short";
  // Long-gamma signature: positive skew (extreme gains better than losses)
  if (skew >= skewLong) return "long";
  // Negative skew without fat tails → mild left-skew, still inconsistent
  // with "flat" but not strongly enough for "short" verdict
  if (skew <= skewShort) return "short";
  return "flat";
}

export function verifyStrategyClaims(
  input: StrategyClaimVerifierInput,
): StrategyClaimVerifierResult {
  const returns = input.strategyReturns;
  const annual = input.annualizationFactor ?? DEFAULT_ANNUALIZATION;
  const betaTol = input.betaTolerance ?? DEFAULT_BETA_TOL;
  const sharpeTol = input.sharpeTolerance ?? DEFAULT_SHARPE_TOL;
  const ddTol = input.drawdownTolerance ?? DEFAULT_DD_TOL;
  const skewLong = input.skewLongThreshold ?? DEFAULT_SKEW_LONG;
  const skewShort = input.skewShortThreshold ?? DEFAULT_SKEW_SHORT;
  const exKurtT = input.excessKurtosisThreshold ?? DEFAULT_EXCESS_KURT;
  const minPeriods = input.minPeriods ?? DEFAULT_MIN_PERIODS;

  if (returns.length < minPeriods) {
    return {
      sampleSize: returns.length,
      realized: {
        meanReturn: 0,
        stdReturn: 0,
        annualizedReturn: 0,
        annualizedSharpe: 0,
        maxDrawdown: 0,
        skewness: 0,
        excessKurtosis: 0,
        beta: null,
        autocorrelation: 0,
        impliedHoldingPeriod: 0,
        worstDay: 0,
        bestDay: 0,
        worstBestRatio: 0,
      },
      checks: [],
      consistentCount: 0,
      inconsistentCount: 0,
      verdict: "insufficient_data",
      summary: `Insufficient periods (${returns.length} < ${minPeriods}).`,
    };
  }

  // Compute realized statistics
  const meanR = mean([...returns]);
  const stdR = sampleStd([...returns]);
  const annualizedR = meanR * annual;
  const annualizedS = stdR === 0 ? 0 : (meanR / stdR) * Math.sqrt(annual);
  const mdd = maxDrawdown(returns);
  const skew = skewness(returns);
  const exKurt = excessKurtosis(returns);
  const autocorr = lag1Autocorr(returns);
  const holdImplied = impliedHoldingPeriod(autocorr);
  let worst = Infinity;
  let best = -Infinity;
  for (const r of returns) {
    if (r < worst) worst = r;
    if (r > best) best = r;
  }
  const worstBestRatio = best > 0 ? worst / best : 0;

  let beta: number | null = null;
  if (input.benchmarkReturns && input.benchmarkReturns.length === returns.length) {
    beta = olsBeta(returns, input.benchmarkReturns);
  }

  const checks: ClaimCheckResult[] = [];

  // Beta claim
  if (input.claims.beta !== undefined) {
    if (beta === null) {
      checks.push({
        claim: "beta",
        claimedValue: input.claims.beta.toFixed(3),
        realizedValue: "n/a",
        verdict: "missing_input",
        reason: "Benchmark returns not supplied or length mismatch.",
      });
    } else {
      const diff = Math.abs(beta - input.claims.beta);
      const consistent = diff <= betaTol;
      checks.push({
        claim: "beta",
        claimedValue: input.claims.beta.toFixed(3),
        realizedValue: beta.toFixed(3),
        verdict: consistent ? "consistent" : "inconsistent",
        reason: consistent
          ? `Realized beta ${beta.toFixed(3)} within tolerance ±${betaTol} of claimed ${input.claims.beta.toFixed(3)}.`
          : `Realized beta ${beta.toFixed(3)} deviates ${diff.toFixed(3)} from claimed ${input.claims.beta.toFixed(3)} (tolerance ±${betaTol}). Hidden directional exposure?`,
      });
    }
  }

  // Gamma posture claim
  if (input.claims.gammaPosture !== undefined) {
    const realizedPosture = gammaPostureFromSignature(skew, exKurt, skewLong, skewShort, exKurtT);
    const consistent = realizedPosture === input.claims.gammaPosture;
    checks.push({
      claim: "gammaPosture",
      claimedValue: input.claims.gammaPosture,
      realizedValue: realizedPosture,
      verdict: consistent ? "consistent" : "inconsistent",
      reason: consistent
        ? `Skew ${skew.toFixed(2)} + excess kurtosis ${exKurt.toFixed(2)} consistent with claimed ${input.claims.gammaPosture}.`
        : `Skew ${skew.toFixed(2)} + excess kurtosis ${exKurt.toFixed(2)} suggests ${realizedPosture}, not claimed ${input.claims.gammaPosture}. ` +
          (realizedPosture === "short" && input.claims.gammaPosture !== "short"
            ? "Negative skew + fat tails = canonical short-gamma signature."
            : ""),
    });
  }

  // Sharpe claim
  if (input.claims.sharpe !== undefined) {
    const diff = Math.abs(annualizedS - input.claims.sharpe);
    const relDiff = Math.abs(input.claims.sharpe) > 0 ? diff / Math.abs(input.claims.sharpe) : diff;
    const consistent = relDiff <= sharpeTol;
    checks.push({
      claim: "sharpe",
      claimedValue: input.claims.sharpe.toFixed(2),
      realizedValue: annualizedS.toFixed(2),
      verdict: consistent ? "consistent" : "inconsistent",
      reason: consistent
        ? `Realized Sharpe ${annualizedS.toFixed(2)} within ${(sharpeTol * 100).toFixed(0)}% of claim.`
        : `Realized Sharpe ${annualizedS.toFixed(2)} deviates ${(relDiff * 100).toFixed(0)}% from claimed ${input.claims.sharpe.toFixed(2)}.`,
    });
  }

  // Max drawdown claim
  if (input.claims.maxDrawdown !== undefined) {
    const diff = Math.abs(mdd - input.claims.maxDrawdown);
    const relDiff = input.claims.maxDrawdown > 0 ? diff / input.claims.maxDrawdown : diff;
    const consistent = relDiff <= ddTol;
    checks.push({
      claim: "maxDrawdown",
      claimedValue: `${(input.claims.maxDrawdown * 100).toFixed(1)}%`,
      realizedValue: `${(mdd * 100).toFixed(1)}%`,
      verdict: consistent ? "consistent" : "inconsistent",
      reason: consistent
        ? `Realized max drawdown ${(mdd * 100).toFixed(1)}% within ${(ddTol * 100).toFixed(0)}% of claim.`
        : `Realized max drawdown ${(mdd * 100).toFixed(1)}% vs claimed ${(input.claims.maxDrawdown * 100).toFixed(1)}% — ${mdd > input.claims.maxDrawdown ? "WORSE than claimed" : "better than claimed"}.`,
    });
  }

  // Holding period claim
  if (input.claims.holdingPeriodPeriods !== undefined) {
    const realized = Number.isFinite(holdImplied) ? holdImplied : 9999;
    const diff = Math.abs(realized - input.claims.holdingPeriodPeriods);
    const relDiff =
      input.claims.holdingPeriodPeriods > 0 ? diff / input.claims.holdingPeriodPeriods : diff;
    const consistent = relDiff <= 1.0; // holding period is noisy; ±100%
    checks.push({
      claim: "holdingPeriodPeriods",
      claimedValue: input.claims.holdingPeriodPeriods.toFixed(1),
      realizedValue: Number.isFinite(holdImplied) ? holdImplied.toFixed(1) : "∞",
      verdict: consistent ? "consistent" : "inconsistent",
      reason: consistent
        ? `Implied holding ${realized.toFixed(1)} periods within tolerance of claim.`
        : `Implied holding ${realized.toFixed(1)} periods deviates ${(relDiff * 100).toFixed(0)}% from claimed ${input.claims.holdingPeriodPeriods.toFixed(1)}. Autocorr=${autocorr.toFixed(2)}.`,
    });
  }

  const consistentCount = checks.filter((c) => c.verdict === "consistent").length;
  const inconsistentCount = checks.filter((c) => c.verdict === "inconsistent").length;

  let verdict: OverallVerdict;
  if (checks.length === 0) {
    verdict = "insufficient_data";
  } else if (inconsistentCount === 0) {
    verdict = "all_consistent";
  } else if (inconsistentCount === 1 && consistentCount >= 1) {
    verdict = "minor_inconsistencies";
  } else {
    verdict = "major_inconsistencies";
  }

  const summary =
    `${returns.length} periods analyzed. ` +
    `${consistentCount} claims consistent, ${inconsistentCount} inconsistent. ` +
    `Realized: σ=${(stdR * 100).toFixed(2)}%/period, ` +
    `Sharpe=${annualizedS.toFixed(2)}, MDD=${(mdd * 100).toFixed(1)}%, ` +
    `skew=${skew.toFixed(2)}, excess kurt=${exKurt.toFixed(2)}` +
    (beta !== null ? `, β=${beta.toFixed(3)}` : "") +
    `. → ${verdict}`;

  return {
    sampleSize: returns.length,
    realized: {
      meanReturn: parseFloat(meanR.toFixed(8)),
      stdReturn: parseFloat(stdR.toFixed(8)),
      annualizedReturn: parseFloat(annualizedR.toFixed(6)),
      annualizedSharpe: parseFloat(annualizedS.toFixed(4)),
      maxDrawdown: parseFloat(mdd.toFixed(6)),
      skewness: parseFloat(skew.toFixed(4)),
      excessKurtosis: parseFloat(exKurt.toFixed(4)),
      beta: beta === null ? null : parseFloat(beta.toFixed(4)),
      autocorrelation: parseFloat(autocorr.toFixed(4)),
      impliedHoldingPeriod: Number.isFinite(holdImplied)
        ? parseFloat(holdImplied.toFixed(4))
        : Infinity,
      worstDay: parseFloat(worst.toFixed(6)),
      bestDay: parseFloat(best.toFixed(6)),
      worstBestRatio: parseFloat(worstBestRatio.toFixed(4)),
    },
    checks,
    consistentCount,
    inconsistentCount,
    verdict,
    summary,
  };
}

export function formatStrategyClaimVerification(result: StrategyClaimVerifierResult): string {
  const lines = [
    `Strategy-Claim Verifier — ${result.verdict.toUpperCase()}`,
    "",
    `  Sample size: ${result.sampleSize} periods`,
    `  Realized stats:`,
    `    Mean return:   ${(result.realized.meanReturn * 100).toFixed(4)}%/period`,
    `    Std deviation: ${(result.realized.stdReturn * 100).toFixed(2)}%/period`,
    `    Ann. return:   ${(result.realized.annualizedReturn * 100).toFixed(2)}%`,
    `    Ann. Sharpe:   ${result.realized.annualizedSharpe.toFixed(2)}`,
    `    Max drawdown:  ${(result.realized.maxDrawdown * 100).toFixed(2)}%`,
    `    Skewness:      ${result.realized.skewness.toFixed(2)}`,
    `    Excess kurt:   ${result.realized.excessKurtosis.toFixed(2)}`,
    `    Autocorr(1):   ${result.realized.autocorrelation.toFixed(3)}`,
  ];
  if (result.realized.beta !== null) {
    lines.push(`    Beta:          ${result.realized.beta.toFixed(3)}`);
  }
  lines.push("");
  if (result.checks.length > 0) {
    lines.push("Checks:");
    for (const c of result.checks) {
      const mark = c.verdict === "consistent" ? "✓" : c.verdict === "inconsistent" ? "✗" : "·";
      lines.push(
        `  ${mark} ${c.claim.padEnd(20)} claimed: ${c.claimedValue.padEnd(10)} realized: ${c.realizedValue.padEnd(10)} → ${c.verdict}`,
      );
      lines.push(`     ${c.reason}`);
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  if (result.verdict === "major_inconsistencies") {
    lines.push("");
    lines.push("⚠ Multiple claims contradict the data. Either the strategy is");
    lines.push("  poorly understood by its operator or being misrepresented.");
  }
  return lines.join("\n");
}
