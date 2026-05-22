/**
 * "Too Good to Be True" epistemic alert — Gordon's port of Jane
 * Street's `fill-too-good` pattern (Mark, production engineering
 * talk).
 *
 * The principle: alert on outputs that are too suspicious to be true,
 * without knowing the specific cause. A backtest Sharpe of 8 is more
 * likely a bug than a discovery. The same checks that catch fraud
 * also catch bugs in your own calculation pipeline — data leaks,
 * look-ahead bias, survivorship bias, off-by-one slippage models,
 * accidentally-future returns.
 *
 * This is **symptom-based alerting at the epistemic level**: when
 * the diagnostic output looks suspicious, something is broken
 * upstream. The check doesn't tell you what's broken; it tells you
 * to investigate before treating the result as actionable.
 *
 * Composes with:
 *   - `ic-tracker` (IC value)
 *   - `ir-diagnostic` (IR value)
 *   - backtest engine (Sharpe, win rate, max DD)
 *   - `walk-forward-ic` (per-window IC values)
 *   - `event-replay` verdict metrics
 *
 * All thresholds are operator-tunable. Defaults are calibrated to
 * single-operator retail Gordon use; institutional Pro pilot may
 * need stricter thresholds.
 */

export type TooGoodSeverity = "suspicious" | "catastrophic";
export type TooGoodVerdict = "plausible" | "suspicious" | "too_good_to_be_true";

export interface TooGoodCheckInput {
  /** Sharpe ratio (annualized typically). */
  sharpe?: number;
  /** Information Coefficient (Pearson correlation between signal and forward return). */
  ic?: number;
  /** Information Ratio. */
  ir?: number;
  /** Win rate as a fraction (0..1). */
  winRate?: number;
  /** Maximum drawdown as positive fraction (0.05 = 5%). */
  maxDrawdown?: number;
  /** Number of trades / observations the above stats were computed on. */
  sampleSize?: number;
  /** Number of historical periods covered. Used to gate maxDD checks. */
  observationPeriods?: number;
  /** Annualized return as fraction (0.5 = 50%). */
  annualizedReturn?: number;
}

export interface TooGoodCheckOptions {
  /** Sharpe ≥ this → suspicious. Default 3.0. */
  suspiciousSharpe?: number;
  /** Sharpe ≥ this → too_good_to_be_true. Default 5.0. */
  catastrophicSharpe?: number;
  /** |IC| ≥ this → suspicious. Default 0.20. */
  suspiciousIc?: number;
  /** |IC| ≥ this → too_good_to_be_true. Default 0.30. */
  catastrophicIc?: number;
  /** IR ≥ this → suspicious. Default 2.0. */
  suspiciousIr?: number;
  /** IR ≥ this → too_good_to_be_true. Default 3.0. */
  catastrophicIr?: number;
  /** Win rate ≥ this → suspicious. Default 0.85. */
  suspiciousWinRate?: number;
  /** Win rate ≥ this → too_good_to_be_true. Default 0.95. */
  catastrophicWinRate?: number;
  /** Max DD ≤ this (with sufficient periods) → suspicious. Default 0.02 (2%). */
  suspiciousMaxDD?: number;
  /** Max DD ≤ this (with sufficient periods) → too_good_to_be_true. Default 0.005 (0.5%). */
  catastrophicMaxDD?: number;
  /** Annualized return ≥ this → suspicious. Default 1.0 (100%). */
  suspiciousAnnualReturn?: number;
  /** Annualized return ≥ this → too_good_to_be_true. Default 3.0 (300%). */
  catastrophicAnnualReturn?: number;
  /** Minimum observations to trust low-DD checks. Default 100. */
  minObservationsForDdCheck?: number;
}

export interface TrippedCheck {
  check: string;
  severity: TooGoodSeverity;
  value: number;
  threshold: number;
  reason: string;
}

export interface TooGoodCheckResult {
  verdict: TooGoodVerdict;
  trippedChecks: TrippedCheck[];
  /** Operator-readable summary. */
  summary: string;
}

const DEFAULTS: Required<TooGoodCheckOptions> = {
  suspiciousSharpe: 3.0,
  catastrophicSharpe: 5.0,
  suspiciousIc: 0.20,
  catastrophicIc: 0.30,
  suspiciousIr: 2.0,
  catastrophicIr: 3.0,
  suspiciousWinRate: 0.85,
  catastrophicWinRate: 0.95,
  suspiciousMaxDD: 0.02,
  catastrophicMaxDD: 0.005,
  suspiciousAnnualReturn: 1.0,
  catastrophicAnnualReturn: 3.0,
  minObservationsForDdCheck: 100,
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Run the "too good to be true" check across all supplied diagnostic
 * fields. Each tripped check is accumulated with its severity; the
 * verdict reflects the worst-severity check observed.
 *
 * Missing fields are skipped silently — callers only need to supply
 * what they have. An empty input returns `plausible` with no checks.
 */
export function checkTooGoodToBeTrue(
  input: TooGoodCheckInput,
  options: TooGoodCheckOptions = {},
): TooGoodCheckResult {
  const opts = { ...DEFAULTS, ...options };
  const tripped: TrippedCheck[] = [];

  // Sharpe
  if (isFiniteNumber(input.sharpe)) {
    if (input.sharpe >= opts.catastrophicSharpe) {
      tripped.push({
        check: "sharpe",
        severity: "catastrophic",
        value: input.sharpe,
        threshold: opts.catastrophicSharpe,
        reason: `Sharpe ${input.sharpe.toFixed(2)} ≥ ${opts.catastrophicSharpe} — almost certainly a data leak or look-ahead bias`,
      });
    } else if (input.sharpe >= opts.suspiciousSharpe) {
      tripped.push({
        check: "sharpe",
        severity: "suspicious",
        value: input.sharpe,
        threshold: opts.suspiciousSharpe,
        reason: `Sharpe ${input.sharpe.toFixed(2)} ≥ ${opts.suspiciousSharpe} — verify cost model + sample period`,
      });
    }
  }

  // IC (uses absolute value)
  if (isFiniteNumber(input.ic)) {
    const absIc = Math.abs(input.ic);
    if (absIc >= opts.catastrophicIc) {
      tripped.push({
        check: "ic",
        severity: "catastrophic",
        value: input.ic,
        threshold: opts.catastrophicIc,
        reason: `|IC| ${absIc.toFixed(3)} ≥ ${opts.catastrophicIc} — institutional signals sit in 0.05-0.15; this is likely a calc bug or leak`,
      });
    } else if (absIc >= opts.suspiciousIc) {
      tripped.push({
        check: "ic",
        severity: "suspicious",
        value: input.ic,
        threshold: opts.suspiciousIc,
        reason: `|IC| ${absIc.toFixed(3)} ≥ ${opts.suspiciousIc} — verify alignment + walk-forward stability`,
      });
    }
  }

  // IR
  if (isFiniteNumber(input.ir)) {
    if (input.ir >= opts.catastrophicIr) {
      tripped.push({
        check: "ir",
        severity: "catastrophic",
        value: input.ir,
        threshold: opts.catastrophicIr,
        reason: `IR ${input.ir.toFixed(2)} ≥ ${opts.catastrophicIr} — exceeds institutional "exceptional" tier; verify effective-N + cost adjustment`,
      });
    } else if (input.ir >= opts.suspiciousIr) {
      tripped.push({
        check: "ir",
        severity: "suspicious",
        value: input.ir,
        threshold: opts.suspiciousIr,
        reason: `IR ${input.ir.toFixed(2)} ≥ ${opts.suspiciousIr} — strong-tier; verify it survives out-of-sample`,
      });
    }
  }

  // Win rate
  if (isFiniteNumber(input.winRate)) {
    if (input.winRate >= opts.catastrophicWinRate) {
      tripped.push({
        check: "winRate",
        severity: "catastrophic",
        value: input.winRate,
        threshold: opts.catastrophicWinRate,
        reason: `Win rate ${(input.winRate * 100).toFixed(1)}% ≥ ${(opts.catastrophicWinRate * 100).toFixed(0)}% — verify there's no survivorship bias or cherry-picking`,
      });
    } else if (input.winRate >= opts.suspiciousWinRate) {
      tripped.push({
        check: "winRate",
        severity: "suspicious",
        value: input.winRate,
        threshold: opts.suspiciousWinRate,
        reason: `Win rate ${(input.winRate * 100).toFixed(1)}% ≥ ${(opts.suspiciousWinRate * 100).toFixed(0)}% — verify the sample period covers diverse regimes`,
      });
    }
  }

  // Max drawdown (only meaningful with sufficient observation periods)
  if (
    isFiniteNumber(input.maxDrawdown) &&
    (input.observationPeriods === undefined ||
      input.observationPeriods >= opts.minObservationsForDdCheck)
  ) {
    if (input.maxDrawdown <= opts.catastrophicMaxDD) {
      tripped.push({
        check: "maxDrawdown",
        severity: "catastrophic",
        value: input.maxDrawdown,
        threshold: opts.catastrophicMaxDD,
        reason: `Max DD ${(input.maxDrawdown * 100).toFixed(2)}% ≤ ${(opts.catastrophicMaxDD * 100).toFixed(2)}% — strategy isn't taking real risk OR look-ahead bias is hiding losses`,
      });
    } else if (input.maxDrawdown <= opts.suspiciousMaxDD) {
      tripped.push({
        check: "maxDrawdown",
        severity: "suspicious",
        value: input.maxDrawdown,
        threshold: opts.suspiciousMaxDD,
        reason: `Max DD ${(input.maxDrawdown * 100).toFixed(2)}% ≤ ${(opts.suspiciousMaxDD * 100).toFixed(2)}% — verify the sample period includes drawdown regimes`,
      });
    }
  }

  // Annualized return
  if (isFiniteNumber(input.annualizedReturn)) {
    if (input.annualizedReturn >= opts.catastrophicAnnualReturn) {
      tripped.push({
        check: "annualizedReturn",
        severity: "catastrophic",
        value: input.annualizedReturn,
        threshold: opts.catastrophicAnnualReturn,
        reason: `Annualized return ${(input.annualizedReturn * 100).toFixed(0)}% ≥ ${(opts.catastrophicAnnualReturn * 100).toFixed(0)}% — likely compounding bug, leverage error, or cost omission`,
      });
    } else if (input.annualizedReturn >= opts.suspiciousAnnualReturn) {
      tripped.push({
        check: "annualizedReturn",
        severity: "suspicious",
        value: input.annualizedReturn,
        threshold: opts.suspiciousAnnualReturn,
        reason: `Annualized return ${(input.annualizedReturn * 100).toFixed(0)}% ≥ ${(opts.suspiciousAnnualReturn * 100).toFixed(0)}% — verify net of all costs + slippage`,
      });
    }
  }

  // Verdict: worst severity wins
  const hasCatastrophic = tripped.some((t) => t.severity === "catastrophic");
  const hasSuspicious = tripped.some((t) => t.severity === "suspicious");
  const verdict: TooGoodVerdict = hasCatastrophic
    ? "too_good_to_be_true"
    : hasSuspicious
      ? "suspicious"
      : "plausible";

  const summary =
    tripped.length === 0
      ? "✓ all diagnostic checks pass — output is within plausible bounds"
      : `${verdict.toUpperCase()}: ${tripped.length} check(s) tripped — ${tripped
          .map((t) => t.check)
          .join(", ")}. Investigate before treating result as actionable.`;

  return { verdict, trippedChecks: tripped, summary };
}

/**
 * Format a check result as operator-readable text. Used by audit /
 * report surfaces; the structured result is the source of truth.
 */
export function formatTooGoodCheck(result: TooGoodCheckResult): string {
  const status =
    result.verdict === "plausible"
      ? "PLAUSIBLE"
      : result.verdict === "suspicious"
        ? "SUSPICIOUS"
        : "TOO GOOD TO BE TRUE";
  const lines = [`Diagnostic plausibility: ${status}`, ""];
  if (result.trippedChecks.length === 0) {
    lines.push("  All checks within plausible bounds.");
    return lines.join("\n");
  }
  for (const t of result.trippedChecks) {
    lines.push(`  [${t.severity.toUpperCase()}] ${t.check}: ${t.reason}`);
  }
  return lines.join("\n");
}
