/**
 * Risk-state undo-lineage governance (B6, AITrader port).
 *
 * Effective risk-LIMIT params evolve over a session (max position %, max
 * leverage, min stop distance, ...). This module governs HOW they may change:
 *
 *   - A proposed change that TIGHTENS every dimension (moves each toward the
 *     safer side, or leaves it) auto-applies.
 *   - A change that revisits a previously-HELD set (already in the seen set)
 *     auto-applies — we have stood there before, it is not new territory.
 *   - A change that LOOSENS any dimension into NEVER-HELD territory is staged
 *     `pending_approval`; it does not take effect until approved.
 *   - Undo restores the immediately-prior applied state from a versioned stack.
 *
 * This COMPLEMENTS `riskClassifier` / `trustTrajectory`, which gate TRADES.
 * This gates the evolving risk-LIMIT params themselves. It does not weaken
 * either: it is purely additive governance on top.
 *
 * ADDITIVE SAFETY INVARIANT: a hard `floor` state bounds the riskiest value
 * allowed on every dimension. No path — not auto-applied tightening, not a
 * seen-set revisit, not an approved staged change — may move a dimension past
 * the floor into riskier territory. Such a proposal is REJECTED outright, and
 * the current effective state is preserved unchanged.
 *
 * Pure state machine: no I/O, deterministic, never throws.
 */

// ============================================================================
// Types
// ============================================================================

/** For a dimension, which direction is SAFER (reduces risk). */
export type SaferDirection = "lower" | "higher";

export interface RiskDimension {
  /** Stable key, e.g. "maxPositionPct". */
  name: string;
  /** Which way is safer. `lower` for max-position/leverage; `higher` for min-stop. */
  saferDirection: SaferDirection;
}

/** A full risk-limit state: a value per configured dimension. */
export type RiskState = Readonly<Record<string, number>>;

export type ProposalVerdict = "applied" | "staged" | "rejected" | "noop";

export type ChangeClass = "tightening" | "loosening" | "unchanged" | "floor_breach";

export interface ProposalResult {
  verdict: ProposalVerdict;
  changeClass: ChangeClass;
  /** Effective state after this proposal (unchanged unless applied). */
  effective: RiskState;
  /** The staged state awaiting approval, if verdict === "staged". */
  staged: RiskState | null;
  /** Dimensions that moved into riskier territory (drove a loosening). */
  loosenedDims: string[];
  /** Dimensions that breached the safety floor (drove a rejection). */
  floorBreachDims: string[];
  reason: string;
}

// ============================================================================
// Comparison helpers
// ============================================================================

/** Is `value` safer-than-or-equal-to `ref` on this dimension? */
function isSaferOrEqual(dim: RiskDimension, value: number, ref: number): boolean {
  return dim.saferDirection === "lower" ? value <= ref : value >= ref;
}

/** Is `value` strictly riskier than `ref` on this dimension? */
function isRiskier(dim: RiskDimension, value: number, ref: number): boolean {
  return dim.saferDirection === "lower" ? value > ref : value < ref;
}

function serialize(dims: RiskDimension[], state: RiskState): string {
  return dims.map((d) => `${d.name}=${state[d.name] ?? "NaN"}`).join("|");
}

// ============================================================================
// Lineage
// ============================================================================

export class RiskStateLineage {
  private readonly dims: RiskDimension[];
  private readonly floor: RiskState;
  private current: RiskState;
  /** Applied-state history (undo stack); newest last. Excludes `current`. */
  private readonly history: RiskState[] = [];
  /** Every state ever held effective, serialized. Seeds with the initial. */
  private readonly seen = new Set<string>();
  private pending: RiskState | null = null;

  /**
   * @param dims   dimension config (name + safer direction)
   * @param initial the starting effective state (must respect the floor)
   * @param floor  the riskiest value allowed per dimension — the hard band
   */
  constructor(dims: RiskDimension[], initial: RiskState, floor: RiskState) {
    this.dims = dims;
    this.floor = { ...floor };
    if (this.breachesFloor(initial).length > 0) {
      throw new Error("RiskStateLineage: initial state breaches the safety floor");
    }
    this.current = { ...initial };
    this.seen.add(serialize(this.dims, this.current));
  }

  /** Current effective risk-limit state. */
  effective(): RiskState {
    return { ...this.current };
  }

  /** Any state currently staged pending approval. */
  pendingState(): RiskState | null {
    return this.pending ? { ...this.pending } : null;
  }

  /** Dimensions on which `state` is riskier than the floor. Empty = within. */
  breachesFloor(state: RiskState): string[] {
    const breached: string[] = [];
    for (const dim of this.dims) {
      const v = state[dim.name];
      const f = this.floor[dim.name];
      if (v === undefined || f === undefined) continue;
      if (isRiskier(dim, v, f)) breached.push(dim.name);
    }
    return breached;
  }

  private classify(next: RiskState): { changeClass: ChangeClass; loosenedDims: string[] } {
    const loosenedDims: string[] = [];
    let anyChange = false;
    for (const dim of this.dims) {
      const cur = this.current[dim.name];
      const nxt = next[dim.name];
      if (cur === undefined || nxt === undefined) continue;
      if (nxt !== cur) anyChange = true;
      if (isRiskier(dim, nxt, cur)) loosenedDims.push(dim.name);
    }
    if (!anyChange) return { changeClass: "unchanged", loosenedDims };
    if (loosenedDims.length > 0) return { changeClass: "loosening", loosenedDims };
    return { changeClass: "tightening", loosenedDims };
  }

  /**
   * Propose a new effective risk-limit state. Tightening or seen-set revisits
   * auto-apply; loosening into never-held territory stages pending approval;
   * anything past the floor is rejected outright.
   */
  propose(next: RiskState): ProposalResult {
    const floorBreachDims = this.breachesFloor(next);
    if (floorBreachDims.length > 0) {
      return {
        verdict: "rejected",
        changeClass: "floor_breach",
        effective: this.effective(),
        staged: this.pendingState(),
        loosenedDims: [],
        floorBreachDims,
        reason: `Rejected: dims [${floorBreachDims.join(", ")}] are riskier than the safety floor`,
      };
    }

    const { changeClass, loosenedDims } = this.classify(next);
    if (changeClass === "unchanged") {
      return {
        verdict: "noop",
        changeClass,
        effective: this.effective(),
        staged: this.pendingState(),
        loosenedDims,
        floorBreachDims: [],
        reason: "No change from the current effective state",
      };
    }

    const key = serialize(this.dims, next);
    const previouslyHeld = this.seen.has(key);

    if (changeClass === "tightening" || previouslyHeld) {
      this.apply(next);
      return {
        verdict: "applied",
        changeClass,
        effective: this.effective(),
        staged: null,
        loosenedDims,
        floorBreachDims: [],
        reason:
          changeClass === "tightening"
            ? "Applied: tightening on every dimension"
            : "Applied: revisits a previously-held state (seen set)",
      };
    }

    // Loosening into never-held territory.
    this.pending = { ...next };
    return {
      verdict: "staged",
      changeClass,
      effective: this.effective(),
      staged: this.pendingState(),
      loosenedDims,
      floorBreachDims: [],
      reason: `Staged pending_approval: loosens [${loosenedDims.join(", ")}] into never-held territory`,
    };
  }

  /**
   * Approve the staged state, if any. Re-checks the floor as belt-and-braces
   * so an approval can never move past the safety band. Clears the pending
   * slot on any terminal outcome.
   */
  approve(): ProposalResult {
    if (!this.pending) {
      return {
        verdict: "noop",
        changeClass: "unchanged",
        effective: this.effective(),
        staged: null,
        loosenedDims: [],
        floorBreachDims: [],
        reason: "No staged change to approve",
      };
    }
    const next = this.pending;
    const floorBreachDims = this.breachesFloor(next);
    if (floorBreachDims.length > 0) {
      this.pending = null;
      return {
        verdict: "rejected",
        changeClass: "floor_breach",
        effective: this.effective(),
        staged: null,
        loosenedDims: [],
        floorBreachDims,
        reason: `Rejected on approval: dims [${floorBreachDims.join(", ")}] breach the safety floor`,
      };
    }
    const { changeClass, loosenedDims } = this.classify(next);
    this.apply(next);
    this.pending = null;
    return {
      verdict: "applied",
      changeClass,
      effective: this.effective(),
      staged: null,
      loosenedDims,
      floorBreachDims: [],
      reason: "Applied: staged change approved",
    };
  }

  /** Discard the staged change without applying it. */
  rejectPending(): void {
    this.pending = null;
  }

  /**
   * Undo the most recent applied change, restoring the prior effective state.
   * Returns the restored state, or null if there is nothing to undo. The
   * restored state is already in the seen set, so it never re-stages.
   */
  undo(): RiskState | null {
    const prior = this.history.pop();
    if (prior === undefined) return null;
    this.current = prior;
    return this.effective();
  }

  /** Number of undoable applied changes. */
  depth(): number {
    return this.history.length;
  }

  /** Has this exact state ever been held effective? */
  hasSeen(state: RiskState): boolean {
    return this.seen.has(serialize(this.dims, state));
  }

  private apply(next: RiskState): void {
    this.history.push(this.current);
    this.current = { ...next };
    this.seen.add(serialize(this.dims, this.current));
  }
}
