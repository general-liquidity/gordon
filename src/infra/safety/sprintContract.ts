/**
 * Sprint Contract (GORDON_SPRINT_CONTRACT).
 *
 * Ports L11 from learn-harness-engineering — before an autonomous-loop
 * session starts, the agent writes a short contract describing scope,
 * verification standards, and exclusions. Persisted to the action log
 * with `entryType: "custom"`, `payload.kind: "sprint.contract_recorded"`.
 *
 * At session end, `compareWithActuals` produces a diff: which scoped
 * symbols/strategies were touched, which verification standards were
 * met, which exclusions were violated. The diff is the artifact that
 * makes "did this session do what it set out to do?" answerable
 * without hindsight reasoning.
 *
 * Front-loads the planner/evaluator alignment that L11 calls out as
 * the cheapest path to fewer "the generator built something the
 * evaluator immediately rejects for foreseeable reasons" loops.
 */

export interface SprintContract {
  /** Stable identifier so the contract can be referenced from later entries. */
  contractId: string;
  threadId?: string;
  /** Symbols or venues the session is allowed to operate on. Empty = no constraint. */
  scope: {
    symbols: string[];
    venues: string[];
    strategies: string[];
  };
  /** What counts as a successful outcome for this session. Each is a free-text predicate. */
  verificationStandards: string[];
  /** What the session is explicitly NOT permitted to do. Free-text. */
  exclusions: string[];
  /** Optional plain-language summary. */
  intent?: string;
  createdAt: string;
}

export interface SprintContractDraft {
  scope?: Partial<SprintContract["scope"]>;
  verificationStandards?: string[];
  exclusions?: string[];
  intent?: string;
  threadId?: string;
}

export interface SprintActuals {
  symbolsTouched: string[];
  venuesUsed: string[];
  strategiesInvoked: string[];
  verificationOutcomes: Array<{ standard: string; met: boolean; evidence?: string }>;
  detectedViolations: string[];
}

export interface ContractDiff {
  contractId: string;
  outOfScopeSymbols: string[];
  outOfScopeVenues: string[];
  outOfScopeStrategies: string[];
  unmetStandards: string[];
  metStandards: string[];
  violatedExclusions: string[];
  honoredExclusions: string[];
  verdict: "clean" | "drift" | "violation";
}

export function isSprintContractEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.GORDON_SPRINT_CONTRACT === "1" || env.GORDON_SPRINT_CONTRACT === "true";
}

function newContractId(): string {
  return `sprint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a contract from a draft. Normalizes inputs and stamps the
 * creation time. The returned contract is ready for persistence; the
 * caller is responsible for writing it to the action log.
 */
export function createSprintContract(draft: SprintContractDraft): SprintContract {
  const scope = {
    symbols: dedupe((draft.scope?.symbols ?? []).map((s) => s.trim()).filter(Boolean)),
    venues: dedupe((draft.scope?.venues ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)),
    strategies: dedupe((draft.scope?.strategies ?? []).map((s) => s.trim()).filter(Boolean)),
  };
  const verificationStandards = dedupe(
    (draft.verificationStandards ?? []).map((s) => s.trim()).filter(Boolean),
  );
  const exclusions = dedupe((draft.exclusions ?? []).map((s) => s.trim()).filter(Boolean));
  return {
    contractId: newContractId(),
    threadId: draft.threadId,
    scope,
    verificationStandards,
    exclusions,
    intent: draft.intent?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Compare actuals against the contract. Returns a structured diff and
 * a verdict:
 *   - clean: nothing out of scope, all standards met, no exclusions violated
 *   - drift: scope drift OR unmet standards but no explicit exclusion violation
 *   - violation: at least one exclusion was violated
 *
 * Scope checks are case-sensitive for symbols/strategies and
 * case-insensitive for venues, matching how the rest of Gordon
 * normalizes venue IDs.
 */
export function compareWithActuals(
  contract: SprintContract,
  actuals: SprintActuals,
): ContractDiff {
  const symbolsConstrained = contract.scope.symbols.length > 0;
  const venuesConstrained = contract.scope.venues.length > 0;
  const strategiesConstrained = contract.scope.strategies.length > 0;

  const outOfScopeSymbols = symbolsConstrained
    ? actuals.symbolsTouched.filter((s) => !contract.scope.symbols.includes(s))
    : [];
  const outOfScopeVenues = venuesConstrained
    ? actuals.venuesUsed.filter((v) => !contract.scope.venues.includes(v.toLowerCase()))
    : [];
  const outOfScopeStrategies = strategiesConstrained
    ? actuals.strategiesInvoked.filter((s) => !contract.scope.strategies.includes(s))
    : [];

  const unmetStandards: string[] = [];
  const metStandards: string[] = [];
  // Each contract standard must have at least one outcome marking it met.
  // Free-text comparison: an outcome's `standard` must include the
  // contract standard as a substring (case-insensitive) to count.
  for (const standard of contract.verificationStandards) {
    const lower = standard.toLowerCase();
    const matched = actuals.verificationOutcomes.find(
      (o) => o.met && o.standard.toLowerCase().includes(lower),
    );
    if (matched) metStandards.push(standard);
    else unmetStandards.push(standard);
  }

  const violatedExclusions = contract.exclusions.filter((excl) => {
    const lower = excl.toLowerCase();
    return actuals.detectedViolations.some((v) => v.toLowerCase().includes(lower));
  });
  const honoredExclusions = contract.exclusions.filter((e) => !violatedExclusions.includes(e));

  let verdict: ContractDiff["verdict"];
  if (violatedExclusions.length > 0) {
    verdict = "violation";
  } else if (
    outOfScopeSymbols.length > 0 ||
    outOfScopeVenues.length > 0 ||
    outOfScopeStrategies.length > 0 ||
    unmetStandards.length > 0
  ) {
    verdict = "drift";
  } else {
    verdict = "clean";
  }

  return {
    contractId: contract.contractId,
    outOfScopeSymbols,
    outOfScopeVenues,
    outOfScopeStrategies,
    unmetStandards,
    metStandards,
    violatedExclusions,
    honoredExclusions,
    verdict,
  };
}

/**
 * Serialize a contract for inclusion in an action-log entry payload.
 * Stable shape so consumers (TUI rendering, post-hoc analysis) can
 * read it back without parsing free text.
 */
export function contractToPayload(contract: SprintContract): Record<string, unknown> {
  return {
    kind: "sprint.contract_recorded",
    contractId: contract.contractId,
    threadId: contract.threadId,
    scope: contract.scope,
    verificationStandards: contract.verificationStandards,
    exclusions: contract.exclusions,
    intent: contract.intent,
    createdAt: contract.createdAt,
  };
}

/**
 * Serialize a diff for inclusion in a session-end action-log entry.
 */
export function diffToPayload(diff: ContractDiff): Record<string, unknown> {
  return {
    kind: "sprint.contract_diff_recorded",
    contractId: diff.contractId,
    verdict: diff.verdict,
    outOfScope: {
      symbols: diff.outOfScopeSymbols,
      venues: diff.outOfScopeVenues,
      strategies: diff.outOfScopeStrategies,
    },
    standards: {
      met: diff.metStandards,
      unmet: diff.unmetStandards,
    },
    exclusions: {
      honored: diff.honoredExclusions,
      violated: diff.violatedExclusions,
    },
  };
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
