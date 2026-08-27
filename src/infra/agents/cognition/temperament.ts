/**
 * Temperament Dials -> deterministic decision params (B5, AITrader port).
 *
 * Six persona sliders in [0,1] that compute the REAL thresholds the agent
 * consumes when it decides whether/how to act:
 *
 *   - conviction         — minimum conviction score required to act
 *   - sizeAggression     — position-size multiplier on the base size
 *   - targetR            — target reward multiple (R) sought on a trade
 *   - confirmations      — number of independent confirmations before entry
 *   - discoveryBreadth   — how many candidates a scan expands to
 *   - pruneAfterIdle     — cycles an idea may sit idle before it is pruned
 *
 * Distinct from `traderArchetype.ts`, which classifies the OPERATOR's flaws.
 * This derives the AGENT's own thresholds from its temperament.
 *
 * BOUNDED SAFETY INVARIANT: the guard-side params (conviction floor,
 * confirmations floor, sizeAggression ceiling) are hard-capped. No dial
 * setting — not even every dial at its most-aggressive extreme — can loosen
 * a guard past its hard cap. The dials modulate WITHIN the safe band only.
 *
 * Pure + total: never throws, deterministic in its inputs.
 */

// ============================================================================
// Types
// ============================================================================

/** The six temperament sliders. Each is clamped to [0,1] on read. */
export interface TemperamentDials {
  /** Appetite to act on thinner evidence + size up. Higher = bolder. */
  boldness: number;
  /** Demand for corroboration before acting. Higher = more skeptical. */
  skepticism: number;
  /** Willingness to wait for setups + hold. Higher = more patient. */
  patience: number;
  /** Reward-seeking vs loss-avoiding bias. Higher = greedier. */
  greed_fear: number;
  /** Breadth of exploration during discovery. Higher = more curious. */
  curiosity: number;
  /** Directness of communicated verdicts. Higher = blunter. */
  bluntness: number;
}

export interface TemperamentParams {
  /** Minimum conviction [0,1] required before the agent acts. GUARD (floored). */
  conviction: number;
  /** Position-size multiplier on the base size. GUARD (ceilinged). */
  sizeAggression: number;
  /** Target reward multiple (R). Preference, not a guard. */
  targetR: number;
  /** Independent confirmations required before entry. GUARD (floored). */
  confirmations: number;
  /** Candidate count a discovery scan expands to. Preference, not a guard. */
  discoveryBreadth: number;
  /** Cycles an idea may sit idle before pruning. Preference, not a guard. */
  pruneAfterIdle: number;
}

// ============================================================================
// Hard caps — the safety band the dials may NEVER cross
// ============================================================================

/**
 * Guard bounds. `conviction` and `confirmations` are floored (a dial can
 * lower them toward, but never below, the floor); `sizeAggression` is
 * ceilinged (a dial can raise it toward, but never above, the ceiling).
 * The non-guard params only carry sane display bounds.
 */
export const TEMPERAMENT_CAPS = {
  /** Conviction can never be relaxed below this, however bold. */
  convictionFloor: 0.5,
  convictionCeil: 0.95,
  /** Size multiplier can never exceed this, however greedy/bold. */
  sizeAggressionFloor: 0.25,
  sizeAggressionCeil: 1.5,
  /** At least this many confirmations, however bold. */
  confirmationsFloor: 1,
  confirmationsCeil: 4,
  targetRFloor: 1,
  targetRCeil: 5,
  discoveryBreadthFloor: 3,
  discoveryBreadthCeil: 40,
  pruneAfterIdleFloor: 2,
  pruneAfterIdleCeil: 30,
} as const;

// ============================================================================
// Dial normalization
// ============================================================================

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampRange(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/** Neutral 0.5-on-every-dial temperament. */
export function neutralTemperament(): TemperamentDials {
  return {
    boldness: 0.5,
    skepticism: 0.5,
    patience: 0.5,
    greed_fear: 0.5,
    curiosity: 0.5,
    bluntness: 0.5,
  };
}

/** Clamp every dial into [0,1]; missing dials default to neutral 0.5. */
export function normalizeDials(dials: Partial<TemperamentDials>): TemperamentDials {
  return {
    boldness: clamp01(dials.boldness ?? 0.5),
    skepticism: clamp01(dials.skepticism ?? 0.5),
    patience: clamp01(dials.patience ?? 0.5),
    greed_fear: clamp01(dials.greed_fear ?? 0.5),
    curiosity: clamp01(dials.curiosity ?? 0.5),
    bluntness: clamp01(dials.bluntness ?? 0.5),
  };
}

// ============================================================================
// Params derivation
// ============================================================================

/** Linear interpolation between lo and hi by t in [0,1]. */
function lerp(lo: number, hi: number, t: number): number {
  return lo + (hi - lo) * t;
}

/**
 * Derive the consumed decision params from the dials. Deterministic and
 * bounded: every guard param is clamped into its hard band as the last step
 * so no combination of dials can escape the safety cap.
 */
export function params(input: Partial<TemperamentDials>): TemperamentParams {
  const d = normalizeDials(input);
  const c = TEMPERAMENT_CAPS;

  // Conviction: skepticism raises the bar, boldness lowers it. Net drive
  // toward "act on less" = boldness minus skepticism, mapped onto [floor,ceil]
  // inverted (more aggression -> nearer the floor).
  const aggression = clamp01(0.5 + (d.boldness - d.skepticism) / 2);
  const convictionRaw = lerp(c.convictionCeil, c.convictionFloor, aggression);

  // Size: boldness + greed push up, skepticism pulls down.
  const sizeDrive = clamp01(
    0.5 + (d.boldness + d.greed_fear - 2 * d.skepticism) / 4 + (d.greed_fear - 0.5) / 4,
  );
  const sizeRaw = lerp(c.sizeAggressionFloor, c.sizeAggressionCeil, sizeDrive);

  // Confirmations: skepticism adds, boldness removes. Round to an integer.
  const confDrive = clamp01(0.5 + (d.skepticism - d.boldness) / 2);
  const confRaw = Math.round(lerp(c.confirmationsFloor, c.confirmationsCeil, confDrive));

  // Target R: patience + greed seek larger multiples.
  const rDrive = clamp01((d.patience + d.greed_fear) / 2);
  const targetRRaw = lerp(c.targetRFloor, c.targetRCeil, rDrive);

  // Discovery breadth: curiosity widens the scan.
  const breadthRaw = Math.round(lerp(c.discoveryBreadthFloor, c.discoveryBreadthCeil, d.curiosity));

  // Prune-after-idle: patience keeps ideas alive longer.
  const pruneRaw = Math.round(lerp(c.pruneAfterIdleFloor, c.pruneAfterIdleCeil, d.patience));

  return {
    // GUARD: floored — never relax below the conviction floor.
    conviction: clampRange(convictionRaw, c.convictionFloor, c.convictionCeil),
    // GUARD: ceilinged — never size above the aggression ceiling.
    sizeAggression: clampRange(sizeRaw, c.sizeAggressionFloor, c.sizeAggressionCeil),
    targetR: clampRange(targetRRaw, c.targetRFloor, c.targetRCeil),
    // GUARD: floored — always at least the minimum confirmations.
    confirmations: clampRange(confRaw, c.confirmationsFloor, c.confirmationsCeil),
    discoveryBreadth: clampRange(breadthRaw, c.discoveryBreadthFloor, c.discoveryBreadthCeil),
    pruneAfterIdle: clampRange(pruneRaw, c.pruneAfterIdleFloor, c.pruneAfterIdleCeil),
  };
}

/**
 * The most-aggressive temperament the dials can express: maximally bold,
 * greedy, curious; minimally skeptical/patient. Exposed so callers (and the
 * cap test) can assert the guard bounds hold at the extreme.
 */
export function maxAggressionDials(): TemperamentDials {
  return {
    boldness: 1,
    skepticism: 0,
    patience: 0,
    greed_fear: 1,
    curiosity: 1,
    bluntness: 1,
  };
}

export function paramsToPayload(p: TemperamentParams): Record<string, unknown> {
  return {
    kind: "temperament.params_recorded",
    conviction: p.conviction,
    sizeAggression: p.sizeAggression,
    targetR: p.targetR,
    confirmations: p.confirmations,
    discoveryBreadth: p.discoveryBreadth,
    pruneAfterIdle: p.pruneAfterIdle,
  };
}
