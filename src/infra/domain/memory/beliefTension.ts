/**
 * Belief-Tension Counter.
 *
 * Port of AITrader's belief-revision primitive. A stored belief is held
 * until evidence overturns it. When a new observation CONTRADICTS a held
 * belief, we do not flip immediately (noise would thrash the belief) and
 * we do not ignore it (staleness would ossify the belief). Instead we
 * open a TENSION: a running for/against tally seeded by the contradicting
 * observation. Subsequent observations accrue to the tally. Only when the
 * NET evidence crosses an adjustable bar does the tension resolve, either
 * FLIPPING the belief (contradiction won) or RECONFIRMING it (the belief
 * held and the contradiction was noise).
 *
 * This is a standalone reasoning primitive. It deliberately does NOT
 * touch the Hermes hot-tier (`memoryFactory` working memory) — beliefs
 * and their tensions are cold, model-decided state, never ambient-injected.
 * The module is PURE: every function returns a new state; nothing is
 * mutated and nothing is persisted here.
 *
 * The bar is adjustable so a caller can move it per belief or per
 * temperament (a skeptical stance raises the bar to flip; a decisive
 * stance lowers it). It is passed in, never read from global state.
 */

export interface Belief {
  id: string;
  /** The proposition currently held, e.g. "BTC uptrend intact". */
  statement: string;
  /** Epoch ms the belief was first established. Informational. */
  heldSince?: number;
}

export interface Observation {
  /** True if the observation supports the belief; false if it contradicts. */
  supports: boolean;
  /** Evidence weight. Default 1. Must be > 0. */
  weight?: number;
  /** Optional human note for the audit log. */
  note?: string;
  /** Epoch ms the observation was made. */
  at?: number;
}

export type TensionVerdict = "open" | "flipped" | "reconfirmed";

export interface TensionState {
  beliefId: string;
  /** Count of contradicting observations. */
  againstCount: number;
  /** Count of supporting observations. */
  forCount: number;
  /** Summed weight of contradicting evidence. */
  againstWeight: number;
  /** Summed weight of supporting evidence. */
  forWeight: number;
  /** Epoch ms the tension was opened (from the opening observation). */
  openedAt?: number;
  /** Terminal once "flipped" or "reconfirmed". */
  verdict: TensionVerdict;
  /** Ordered log of every observation recorded against the tension. */
  observations: Observation[];
}

export interface TensionOptions {
  /**
   * Net-evidence magnitude required to resolve. `|forWeight - againstWeight|`
   * must reach this to flip or reconfirm. Default 3.
   */
  bar?: number;
}

const DEFAULT_BAR = 3;

function weightOf(obs: Observation): number {
  const w = obs.weight ?? 1;
  return w > 0 ? w : 1;
}

/** Net evidence: positive favors the belief, negative favors the contradiction. */
export function netEvidence(state: TensionState): number {
  return state.forWeight - state.againstWeight;
}

function resolveVerdict(state: TensionState, bar: number): TensionVerdict {
  const net = netEvidence(state);
  if (net <= -bar) return "flipped";
  if (net >= bar) return "reconfirmed";
  return "open";
}

/**
 * Open a tension from the first CONTRADICTING observation. The opening
 * observation must contradict the belief — that is what raises the
 * tension in the first place. Callers should pass `supports: false`.
 */
export function openTension(
  belief: Belief,
  contradiction: Observation,
  options: TensionOptions = {},
): TensionState {
  const bar = options.bar ?? DEFAULT_BAR;
  const w = weightOf(contradiction);
  const supports = contradiction.supports;
  const state: TensionState = {
    beliefId: belief.id,
    againstCount: supports ? 0 : 1,
    forCount: supports ? 1 : 0,
    againstWeight: supports ? 0 : w,
    forWeight: supports ? w : 0,
    openedAt: contradiction.at,
    verdict: "open",
    observations: [contradiction],
  };
  state.verdict = resolveVerdict(state, bar);
  return state;
}

/**
 * Record another observation against an open tension. Returns a new
 * state with the tally updated and the verdict re-evaluated. Once a
 * tension has resolved (flipped/reconfirmed) it is terminal: further
 * observations are ignored and the same state is returned.
 */
export function recordObservation(
  state: TensionState,
  obs: Observation,
  options: TensionOptions = {},
): TensionState {
  if (state.verdict !== "open") return state;
  const bar = options.bar ?? DEFAULT_BAR;
  const w = weightOf(obs);
  const next: TensionState = {
    ...state,
    againstCount: state.againstCount + (obs.supports ? 0 : 1),
    forCount: state.forCount + (obs.supports ? 1 : 0),
    againstWeight: state.againstWeight + (obs.supports ? 0 : w),
    forWeight: state.forWeight + (obs.supports ? w : 0),
    observations: [...state.observations, obs],
  };
  next.verdict = resolveVerdict(next, bar);
  return next;
}

export interface TensionResolution {
  verdict: TensionVerdict;
  /** True once the tension has crossed the bar (flipped or reconfirmed). */
  resolved: boolean;
  net: number;
  /**
   * The belief AFTER resolution: unchanged if reconfirmed or still open;
   * flipped statement is left to the caller (it owns the negation), so we
   * only signal `shouldFlip`.
   */
  shouldFlip: boolean;
  shouldReconfirm: boolean;
}

/** Summarize the current standing of a tension without mutating it. */
export function resolution(state: TensionState): TensionResolution {
  const resolved = state.verdict !== "open";
  return {
    verdict: state.verdict,
    resolved,
    net: netEvidence(state),
    shouldFlip: state.verdict === "flipped",
    shouldReconfirm: state.verdict === "reconfirmed",
  };
}

export function formatTension(state: TensionState): string {
  const net = netEvidence(state);
  const dir = net > 0 ? "+" : "";
  return (
    `Belief ${state.beliefId} [${state.verdict}] — ` +
    `for ${state.forCount} (w${state.forWeight}) vs against ${state.againstCount} (w${state.againstWeight}), ` +
    `net ${dir}${net}`
  );
}

export function tensionToPayload(state: TensionState): Record<string, unknown> {
  return {
    kind: "belief_tension.recorded",
    beliefId: state.beliefId,
    verdict: state.verdict,
    forCount: state.forCount,
    againstCount: state.againstCount,
    forWeight: state.forWeight,
    againstWeight: state.againstWeight,
    net: netEvidence(state),
    observationCount: state.observations.length,
  };
}
