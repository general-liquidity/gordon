/**
 * Scenario-contingency plan + deterministic trigger resolver.
 *
 * Pattern: "LLM plans once, deterministic engine executes." An LLM (or an
 * operator) authors a small set of scenario branches ahead of time —
 * classically bull / base / bear / tail — each pre-committing a target
 * allocation AND the declared trigger levels (VIX / index / yield / any
 * named metric) that make that branch the live one. Thereafter a cheap,
 * fully deterministic engine resolves which branch is active from a market
 * reading. NO LLM in the resolution loop.
 *
 * Distinct from Gordon's `regime-policy` (a STATISTICAL state -> weights
 * map, HMM/Markov driven): here the branches and their trigger LEVELS are
 * declared up front, so resolution is an auditable rule evaluation, not a
 * model inference. Distinct from a `Playbook` (a single strategy's
 * entry/exit spec) — a ContingencyPlan is a portfolio-level branch set.
 *
 * Pure. Caller supplies the plan and the current reading; no fetching, no
 * clock, no persistence.
 */

export type BranchName = "bull" | "base" | "bear" | "tail";

/**
 * Comparison operators for a single trigger. `between` / `outside` take a
 * [low, high] pair (inclusive bounds); the rest take a scalar threshold.
 */
export type TriggerOperator = ">" | ">=" | "<" | "<=" | "==" | "between" | "outside";

/**
 * One declared trigger condition on a named market metric. `metric` keys
 * into the reading's `metrics` map (e.g. "vix", "spx", "us10y").
 */
export interface ContingencyTrigger {
  metric: string;
  operator: TriggerOperator;
  /** Scalar threshold, or [low, high] for `between` / `outside`. */
  threshold: number | [number, number];
  /** Optional human note for the audit trail. */
  note?: string;
}

/** A single leg of a branch's pre-committed target allocation. */
export interface AllocationLeg {
  /** Sleeve / asset / bucket name (e.g. "BTC", "cash", "long_equity"). */
  sleeve: string;
  /** Target weight as a percent (0..100). */
  targetPercent: number;
}

export interface ContingencyBranch {
  name: BranchName;
  /** Free-form thesis for the branch. */
  description?: string;
  /** Declared trigger conditions gating this branch. */
  triggers: ContingencyTrigger[];
  /**
   * How to combine the branch's triggers. "all" = every trigger must be
   * met (AND); "any" = at least one (OR). Default "all".
   */
  triggerLogic?: "all" | "any";
  /** Pre-committed target allocation when this branch is live. */
  targetAllocation: AllocationLeg[];
  /**
   * Tie-break priority when multiple branches match. Higher wins. When
   * omitted, a defensive-first default precedence is used (see
   * DEFAULT_PRECEDENCE) so a capital-safety agent favors the more
   * defensive branch under ambiguous readings.
   */
  priority?: number;
}

export interface ContingencyPlan {
  id: string;
  /** Optional scope label (portfolio, symbol, book). */
  scope?: string;
  branches: ContingencyBranch[];
  /**
   * Branch to fall through to when NO branch's triggers are satisfied.
   * Defaults to "base" when present, else the first branch.
   */
  defaultBranch?: BranchName;
}

/** Current market metric readings, keyed by the same names triggers use. */
export interface MarketReading {
  metrics: Record<string, number>;
  /** Optional ISO timestamp for the audit trail (not used in resolution). */
  asOf?: string;
}

export interface TriggerEvaluation {
  metric: string;
  operator: TriggerOperator;
  threshold: number | [number, number];
  /** Actual reading, or null when the metric was absent. */
  actual: number | null;
  met: boolean;
  /** True when the metric was missing from the reading. */
  missing: boolean;
}

export interface BranchEvaluation {
  name: BranchName;
  satisfied: boolean;
  triggerLogic: "all" | "any";
  priority: number;
  triggers: TriggerEvaluation[];
}

export interface ContingencyResolution {
  planId: string;
  /** The winning branch. */
  activeBranch: ContingencyBranch;
  activeBranchName: BranchName;
  /** True when NO branch matched and the default was used. */
  fellThrough: boolean;
  /** Names of every branch whose triggers were satisfied. */
  matched: BranchName[];
  /** Per-branch evaluation detail. */
  evaluations: BranchEvaluation[];
  /** Metric names referenced by any trigger but absent from the reading. */
  missingMetrics: string[];
  summary: string;
}

// Defensive-first default precedence — used only to break ties between
// branches that BOTH match, and only when a branch declares no explicit
// `priority`. Tail beats bear beats bull beats base.
const DEFAULT_PRECEDENCE: Record<BranchName, number> = {
  tail: 3,
  bear: 2,
  bull: 1,
  base: 0,
};

function evaluateTrigger(
  trigger: ContingencyTrigger,
  metrics: Record<string, number>,
): TriggerEvaluation {
  const has = Object.hasOwn(metrics, trigger.metric);
  const actual = has ? (metrics[trigger.metric] ?? null) : null;
  let met = false;
  if (actual !== null && Number.isFinite(actual)) {
    const t = trigger.threshold;
    switch (trigger.operator) {
      case ">":
        met = actual > (t as number);
        break;
      case ">=":
        met = actual >= (t as number);
        break;
      case "<":
        met = actual < (t as number);
        break;
      case "<=":
        met = actual <= (t as number);
        break;
      case "==":
        met = actual === (t as number);
        break;
      case "between": {
        const [lo, hi] = t as [number, number];
        met = actual >= lo && actual <= hi;
        break;
      }
      case "outside": {
        const [lo, hi] = t as [number, number];
        met = actual < lo || actual > hi;
        break;
      }
    }
  }
  return {
    metric: trigger.metric,
    operator: trigger.operator,
    threshold: trigger.threshold,
    actual,
    met,
    missing: !has,
  };
}

function priorityOf(branch: ContingencyBranch): number {
  return branch.priority ?? DEFAULT_PRECEDENCE[branch.name] ?? 0;
}

/**
 * Deterministically resolve which branch of a contingency plan is live
 * given the current market reading. When several branches match, the one
 * with the highest priority wins (defensive-first default). When none
 * match, the plan's default branch is used.
 */
export function resolveContingency(
  plan: ContingencyPlan,
  reading: MarketReading,
): ContingencyResolution {
  if (plan.branches.length === 0) {
    throw new Error(`ContingencyPlan ${plan.id} has no branches.`);
  }
  const metrics = reading.metrics ?? {};

  const evaluations: BranchEvaluation[] = plan.branches.map((branch) => {
    const logic = branch.triggerLogic ?? "all";
    const triggers = branch.triggers.map((t) => evaluateTrigger(t, metrics));
    // A branch with no triggers can never self-activate — it only serves
    // as a fall-through target. Treat it as unsatisfied here.
    const satisfied =
      triggers.length === 0
        ? false
        : logic === "all"
          ? triggers.every((t) => t.met)
          : triggers.some((t) => t.met);
    return {
      name: branch.name,
      satisfied,
      triggerLogic: logic,
      priority: priorityOf(branch),
      triggers,
    };
  });

  const matched = evaluations.filter((e) => e.satisfied);
  const matchedNames = matched.map((e) => e.name);

  let activeBranch: ContingencyBranch;
  let fellThrough: boolean;
  if (matched.length > 0) {
    // Highest priority wins; stable tie-break by declaration order.
    const winner = matched.reduce((best, cur) => (cur.priority > best.priority ? cur : best));
    activeBranch = plan.branches.find((b) => b.name === winner.name)!;
    fellThrough = false;
  } else {
    const fallbackName = plan.defaultBranch ?? "base";
    activeBranch = plan.branches.find((b) => b.name === fallbackName) ?? plan.branches[0]!;
    fellThrough = true;
  }

  const missingMetrics = Array.from(
    new Set(evaluations.flatMap((e) => e.triggers.filter((t) => t.missing).map((t) => t.metric))),
  );

  const allocSummary = activeBranch.targetAllocation
    .map((a) => `${a.sleeve} ${a.targetPercent}%`)
    .join(", ");
  const summary = fellThrough
    ? `No branch triggered; fell through to ${activeBranch.name} (${allocSummary}).` +
      (missingMetrics.length > 0 ? ` Missing metrics: ${missingMetrics.join(", ")}.` : "")
    : `Active branch ${activeBranch.name} (${allocSummary}).` +
      (matchedNames.length > 1
        ? ` Won priority over: ${matchedNames.filter((n) => n !== activeBranch.name).join(", ")}.`
        : "");

  return {
    planId: plan.id,
    activeBranch,
    activeBranchName: activeBranch.name,
    fellThrough,
    matched: matchedNames,
    evaluations,
    missingMetrics,
    summary,
  };
}

export interface ContingencyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Structural validation of a contingency plan. Deterministic, no I/O.
 * Errors are disqualifying; warnings are advisory (e.g. allocation legs
 * that do not sum to ~100%).
 */
export function validateContingencyPlan(plan: ContingencyPlan): ContingencyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan.id) errors.push("Plan is missing an id.");
  if (plan.branches.length === 0) errors.push("Plan has no branches.");

  const seen = new Set<BranchName>();
  for (const branch of plan.branches) {
    if (seen.has(branch.name)) errors.push(`Duplicate branch name: ${branch.name}.`);
    seen.add(branch.name);

    if (branch.targetAllocation.length === 0) {
      warnings.push(`Branch ${branch.name} declares no target allocation.`);
    }
    const total = branch.targetAllocation.reduce((s, a) => s + a.targetPercent, 0);
    if (branch.targetAllocation.length > 0 && Math.abs(total - 100) > 0.5) {
      warnings.push(`Branch ${branch.name} allocation sums to ${total.toFixed(1)}%, not 100%.`);
    }
    for (const t of branch.triggers) {
      const isPair = t.operator === "between" || t.operator === "outside";
      const pairShape = Array.isArray(t.threshold) && t.threshold.length === 2;
      if (isPair && !pairShape) {
        errors.push(
          `Branch ${branch.name} trigger on ${t.metric} uses '${t.operator}' but threshold is not a [low, high] pair.`,
        );
      }
      if (!isPair && Array.isArray(t.threshold)) {
        errors.push(
          `Branch ${branch.name} trigger on ${t.metric} uses scalar operator '${t.operator}' with a pair threshold.`,
        );
      }
      if (isPair && pairShape) {
        const [lo, hi] = t.threshold as [number, number];
        if (lo > hi) {
          errors.push(`Branch ${branch.name} trigger on ${t.metric} has low ${lo} > high ${hi}.`);
        }
      }
    }
  }

  const fallback = plan.defaultBranch ?? "base";
  if (!plan.branches.some((b) => b.name === fallback)) {
    warnings.push(
      `Default branch '${fallback}' is not present; the first branch will be used on fall-through.`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function formatContingencyResolution(res: ContingencyResolution): string {
  const lines = [
    `Contingency ${res.planId} — ACTIVE: ${res.activeBranchName.toUpperCase()}${res.fellThrough ? " (fall-through)" : ""}`,
    "",
  ];
  for (const e of res.evaluations) {
    const mark = e.satisfied ? "*" : " ";
    lines.push(`  [${mark}] ${e.name.padEnd(5)} (${e.triggerLogic}, prio ${e.priority})`);
    for (const t of e.triggers) {
      const thr = Array.isArray(t.threshold) ? `[${t.threshold.join(", ")}]` : t.threshold;
      const act = t.missing ? "MISSING" : String(t.actual);
      lines.push(
        `        ${t.metric} ${t.operator} ${thr}  actual=${act}  ${t.met ? "met" : "unmet"}`,
      );
    }
  }
  lines.push("");
  lines.push(`Summary: ${res.summary}`);
  return lines.join("\n");
}
