/**
 * Strategy Code Validator (GORDON_STRATEGY_CODE_VALIDATOR).
 *
 * Lexical anti-pattern scanner for LLM-generated strategy code.
 *
 * Catches the five leakage families from López de Prado before the code
 * ever reaches the sandbox. Cheap pattern-matching is intentional — full
 * AST validation is heavyweight, and the failure modes we're guarding
 * against are syntactically obvious:
 *
 *   1. Centered moving windows  (`center=True`, `align: 'center'`)
 *   2. Forgotten shift before PnL  (`signal * returns` without `.shift(1)`)
 *   3. Full-sample standardization before split  (`fit_transform(X)` on whole)
 *   4. Survivorship bias markers  (today's index used for historical universe)
 *   5. Use of restated fundamentals  (latest-as-of usage where PIT required)
 *
 * Plus a sixth category specific to LLM-generated code:
 *   6. Future-data references  (`future`, `lookahead`, slice with positive
 *      offset from current index)
 *
 * Default ruleset covers both Python (numpy/pandas/sklearn) and TS/JS
 * (manual time-series). Callers can add language-specific rules.
 *
 * This is a `warn` / `block` scanner, NOT a full sandbox replacement. It
 * runs BEFORE the sandbox so blatant anti-patterns never execute.
 */

export type RuleSeverity = "block" | "warn" | "info";
export type LeakageFamily =
  | "centered_window"
  | "missing_shift"
  | "full_sample_normalization"
  | "survivorship_bias"
  | "restated_fundamentals"
  | "future_reference"
  | "other";

export interface ValidatorRule {
  /** Stable rule id (for suppression / reporting). */
  id: string;
  family: LeakageFamily;
  severity: RuleSeverity;
  /** Regex pattern. Use case-insensitive flag in the regex itself if needed. */
  pattern: RegExp;
  /** Human-friendly explanation. */
  description: string;
  /** Concrete fix instruction (mirrors L10 red-pen pattern). */
  fixInstruction: string;
}

export interface ValidatorViolation {
  rule: ValidatorRule;
  /** 1-indexed line where the match starts. */
  line: number;
  /** The matched substring. */
  match: string;
  /** Line content (trimmed) for display. */
  lineContent: string;
}

export interface ValidatorResult {
  /** True if no `block`-severity violations. `warn` does not fail the gate. */
  passes: boolean;
  violations: ValidatorViolation[];
  /** Counts by severity for quick triage. */
  countsBySeverity: Record<RuleSeverity, number>;
  /** Aggregated fix instruction for blocked rules. */
  blockingFixInstruction: string | null;
}

// ============================================================================
// Default ruleset — covers Python + TS/JS strategy-code anti-patterns
// ============================================================================

export const DEFAULT_RULES: readonly ValidatorRule[] = [
  // --- 1. Centered windows ---
  {
    id: "centered_window_pandas",
    family: "centered_window",
    severity: "block",
    pattern: /\.rolling\([^)]*center\s*=\s*True/i,
    description: "Pandas rolling window with center=True peeks at future bars.",
    fixInstruction:
      "Set center=False (default) and shift the output by lookback//2 if you need symmetry, but expect the symmetric smoother to leak.",
  },
  {
    id: "centered_window_align",
    family: "centered_window",
    severity: "block",
    pattern: /align\s*[:=]\s*["']?center["']?/i,
    description: "Window with align: 'center' includes future bars.",
    fixInstruction:
      "Use align: 'right' (or trailing-only) for any feature used as input to a trading signal.",
  },

  // --- 2. Missing shift before PnL ---
  {
    id: "pnl_without_shift_python",
    family: "missing_shift",
    severity: "warn",
    pattern: /signal\s*\*\s*returns(?!\s*\.\s*shift)/,
    description:
      "Pattern 'signal * returns' without an adjacent .shift(1) likely uses the current bar's signal for the current bar's PnL — look-ahead.",
    fixInstruction:
      "Shift signal by one bar before computing PnL: (signal.shift(1) * returns) or equivalent.",
  },
  {
    id: "pnl_without_shift_ts",
    family: "missing_shift",
    severity: "warn",
    pattern: /(?:position|signal)\s*\[\s*i\s*\]\s*\*\s*(?:returns?|ret)\s*\[\s*i\s*\]/,
    description: "Same-index multiplication of signal[i] * returns[i] is look-ahead.",
    fixInstruction:
      "Use signal[i-1] * returns[i] — the signal decided at bar i-1 applies to the bar i return.",
  },

  // --- 3. Full-sample normalization ---
  {
    id: "fit_transform_full",
    family: "full_sample_normalization",
    severity: "block",
    pattern: /\.fit_transform\s*\(\s*[A-Za-z_]\w*\s*\)/,
    description:
      "fit_transform on the full dataset before train/test split causes test-set leakage into normalization parameters.",
    fixInstruction:
      "Fit the scaler on train only, then .transform() test. Use a per-fold scaler inside walk-forward.",
  },
  {
    id: "zscore_full_sample",
    family: "full_sample_normalization",
    severity: "warn",
    pattern:
      /\(\s*[A-Za-z_]\w*\s*-\s*[A-Za-z_]\w*\.mean\(\s*\)\s*\)\s*\/\s*[A-Za-z_]\w*\.std\(\s*\)/,
    description: "Z-score using full-series mean/std leaks test-set statistics into the feature.",
    fixInstruction: "Compute z-score in a rolling window (see FeaturePipeline) or refit per fold.",
  },

  // --- 4. Survivorship bias ---
  {
    id: "current_index_as_universe",
    family: "survivorship_bias",
    severity: "warn",
    pattern: /(?:sp500|spy|nasdaq|russell|index)_(?:current|today|now|members)/i,
    description:
      "Using today's index membership as the historical universe introduces survivorship bias.",
    fixInstruction:
      "Use point-in-time index constituents for each date. Most vendors offer 'as-of' membership tables.",
  },

  // --- 5. Restated fundamentals ---
  {
    id: "latest_fundamentals",
    family: "restated_fundamentals",
    severity: "warn",
    pattern: /\b(?:latest_|current_|as_of_now_)(?:earnings|revenue|eps|fundamentals)\b/i,
    description:
      "Using latest/restated fundamentals for historical backtests is look-ahead; companies restate.",
    fixInstruction:
      "Use point-in-time fundamentals (the value AS IT WAS REPORTED on the historical date, not the latest restatement).",
  },

  // --- 6. Future references ---
  {
    id: "future_named_variable",
    family: "future_reference",
    severity: "block",
    pattern: /\b(?:future|next_bar|lookahead|peek)_(?:price|close|return|signal)\b/i,
    description: "Variable name suggests reading future data.",
    fixInstruction:
      "Forward-looking variable names are usually look-ahead. If you need a future-aware label (e.g. triple-barrier), do it in a separate labeling step that the trading signal never sees.",
  },
  {
    id: "negative_shift_or_lead",
    family: "future_reference",
    severity: "block",
    pattern: /\.shift\(\s*-\d+\s*\)|\.lead\(/,
    description: "Negative shift or .lead() pulls future data into the current bar.",
    fixInstruction:
      "Negative shift is leakage. Use only positive shifts (or labels computed in a separate label-only pipeline).",
  },
  {
    id: "positive_offset_slice",
    family: "future_reference",
    severity: "warn",
    pattern: /\.iloc\[\s*i\s*\+\s*\d+\s*\]|\.slice\(\s*i\s*,\s*i\s*\+\s*\d+\s*\)/,
    description: "Indexing forward from the current bar (i+k) accesses the future.",
    fixInstruction:
      "Replace with i-k indexing (past) or move forward-looking logic to a separate label-generation step.",
  },
];

// ============================================================================
// Scanner
// ============================================================================

export interface ValidateOptions {
  /** Override or extend the default ruleset. */
  rules?: readonly ValidatorRule[];
  /** Suppress specific rule ids (e.g. acknowledged false positives). */
  suppressRuleIds?: readonly string[];
}

export function validateStrategyCode(code: string, opts: ValidateOptions = {}): ValidatorResult {
  const rules = (opts.rules ?? DEFAULT_RULES).filter(
    (r) => !(opts.suppressRuleIds ?? []).includes(r.id),
  );
  const lines = code.split(/\r?\n/);
  const violations: ValidatorViolation[] = [];

  for (const rule of rules) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip pure-comment lines (// or # at start of trimmed line).
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
      const m = line.match(rule.pattern);
      if (m) {
        violations.push({
          rule,
          line: i + 1,
          match: m[0],
          lineContent: trimmed,
        });
      }
    }
  }

  const countsBySeverity: Record<RuleSeverity, number> = { block: 0, warn: 0, info: 0 };
  for (const v of violations) countsBySeverity[v.rule.severity]++;

  const passes = countsBySeverity.block === 0;
  const blockingFixInstruction = passes
    ? null
    : violations
        .filter((v) => v.rule.severity === "block")
        .map((v) => `[L${v.line}] ${v.rule.fixInstruction}`)
        .join(" ");

  return { passes, violations, countsBySeverity, blockingFixInstruction };
}

export function formatValidatorResult(result: ValidatorResult): string {
  const lines: string[] = [];
  lines.push(
    `Strategy-code validator: ${result.passes ? "PASS" : "BLOCK"} ` +
      `(${result.countsBySeverity.block} block, ${result.countsBySeverity.warn} warn, ` +
      `${result.countsBySeverity.info} info)`,
  );
  for (const v of result.violations) {
    lines.push(`  [${v.rule.severity.toUpperCase()}] L${v.line} ${v.rule.id}`);
    lines.push(`    ${v.lineContent}`);
    lines.push(`    ↳ ${v.rule.fixInstruction}`);
  }
  return lines.join("\n");
}

export function validatorResultToPayload(result: ValidatorResult): Record<string, unknown> {
  return {
    kind: "strategy_code.validator_recorded",
    passes: result.passes,
    blockCount: result.countsBySeverity.block,
    warnCount: result.countsBySeverity.warn,
    infoCount: result.countsBySeverity.info,
    blockingFixInstruction: result.blockingFixInstruction,
    violations: result.violations.map((v) => ({
      ruleId: v.rule.id,
      family: v.rule.family,
      severity: v.rule.severity,
      line: v.line,
      match: v.match,
    })),
  };
}
