/**
 * Thesis-Lifecycle FSM
 *
 * A thesis is one trade IDEA tracked through its life:
 *
 *   IDEA -> ENTRY_READY -> ACTIVE -> PARTIALLY_CLOSED -> CLOSED
 *                    \         \            \______________/
 *                     \_________\_________________________-> TERMINATED
 *
 * Gordon's `TradeJournal` is flat/event-based — it records a trade AFTER the
 * fact but has no thesis object, no state transitions, and no review queue.
 * This module adds the FSM as PURE functions over a typed `Thesis`:
 *   - transition validation (illegal jumps throw)
 *   - per-thesis scheduled review dates (`reviewsDue(asOf)`)
 *   - cumulative realized PnL from trims / partial closes
 *   - MAE / MFE excursion tracking for the postmortem
 *
 * It is NOT a parallel store (memory note: journal_is_substrate). Snapshots are
 * persisted through `TradeJournal.recordThesis`, which rides the existing memory
 * store — this file only owns the state machine and its arithmetic.
 */

export type ThesisState =
  | "IDEA"
  | "ENTRY_READY"
  | "ACTIVE"
  | "PARTIALLY_CLOSED"
  | "CLOSED"
  | "TERMINATED";

export interface PartialClose {
  quantity: number;
  exitPrice: number;
  realizedPnl: number;
  at: string;
}

export interface ThesisTransition {
  from: ThesisState;
  to: ThesisState;
  at: string;
  reason?: string;
}

export interface Thesis {
  id: string;
  symbol: string;
  side: "long" | "short";
  state: ThesisState;
  rationale: string;
  createdAt: string;
  updatedAt: string;

  entryPrice?: number;
  initialQuantity?: number;
  /** Quantity still open (initial minus everything closed). */
  openQuantity: number;

  /** Review cadence and the next scheduled review, if any. */
  reviewEveryMs?: number;
  nextReviewAt?: string;

  /** Cumulative realized PnL from all trims / closes. */
  realizedPnl: number;
  closes: PartialClose[];

  /**
   * Excursions in directional per-unit price terms:
   *   excursion = (price - entry) * (side === "long" ? 1 : -1)
   * mfe = best (max) excursion seen, mae = worst (min) excursion seen.
   */
  mfe: number;
  mae: number;

  /** Provenance: report ids / sources that fed the thesis. */
  reports: string[];
  transitions: ThesisTransition[];
}

// ----------------------------------------------------------------------------
// Transition table
// ----------------------------------------------------------------------------

const ALLOWED: Record<ThesisState, ReadonlySet<ThesisState>> = {
  IDEA: new Set(["ENTRY_READY", "TERMINATED"]),
  ENTRY_READY: new Set(["ACTIVE", "TERMINATED"]),
  ACTIVE: new Set(["PARTIALLY_CLOSED", "CLOSED", "TERMINATED"]),
  PARTIALLY_CLOSED: new Set(["PARTIALLY_CLOSED", "CLOSED", "TERMINATED"]),
  CLOSED: new Set(),
  TERMINATED: new Set(),
};

export function canTransition(from: ThesisState, to: ThesisState): boolean {
  return ALLOWED[from].has(to);
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number, got ${value}`);
  }
}

function directionalExcursion(thesis: Thesis, price: number): number {
  const entry = thesis.entryPrice ?? price;
  return (price - entry) * (thesis.side === "long" ? 1 : -1);
}

function stamp<T extends Thesis>(thesis: T, at: string): T {
  return { ...thesis, updatedAt: at };
}

/**
 * Apply a raw state transition with validation. Prefer the specific operations
 * below (enterPosition / recordPartialClose / …) which also carry the side
 * effects; use this directly only for pure state moves like terminate.
 */
export function transition(
  thesis: Thesis,
  to: ThesisState,
  at: string,
  reason?: string,
): Thesis {
  if (!canTransition(thesis.state, to)) {
    throw new Error(`illegal thesis transition ${thesis.state} -> ${to}`);
  }
  return stamp(
    {
      ...thesis,
      state: to,
      transitions: [...thesis.transitions, { from: thesis.state, to, at, reason }],
    },
    at,
  );
}

// ----------------------------------------------------------------------------
// Lifecycle operations
// ----------------------------------------------------------------------------

export interface CreateThesisParams {
  symbol: string;
  side: "long" | "short";
  rationale: string;
  reports?: string[];
  reviewEveryMs?: number;
  id?: string;
}

export function createThesis(params: CreateThesisParams, at: string): Thesis {
  return {
    id: params.id ?? crypto.randomUUID(),
    symbol: params.symbol,
    side: params.side,
    state: "IDEA",
    rationale: params.rationale,
    createdAt: at,
    updatedAt: at,
    openQuantity: 0,
    reviewEveryMs: params.reviewEveryMs,
    realizedPnl: 0,
    closes: [],
    mfe: 0,
    mae: 0,
    reports: params.reports ? [...params.reports] : [],
    transitions: [],
  };
}

export function markEntryReady(thesis: Thesis, at: string): Thesis {
  return transition(thesis, "ENTRY_READY", at);
}

export interface EnterPositionParams {
  entryPrice: number;
  quantity: number;
  /** Overrides the thesis-level cadence for scheduling the first review. */
  reviewEveryMs?: number;
}

export function enterPosition(
  thesis: Thesis,
  params: EnterPositionParams,
  at: string,
): Thesis {
  assertPositive(params.entryPrice, "entryPrice");
  assertPositive(params.quantity, "quantity");
  const moved = transition(thesis, "ACTIVE", at);
  const cadence = params.reviewEveryMs ?? thesis.reviewEveryMs;
  return {
    ...moved,
    entryPrice: params.entryPrice,
    initialQuantity: params.quantity,
    openQuantity: params.quantity,
    reviewEveryMs: cadence,
    nextReviewAt: cadence ? new Date(new Date(at).getTime() + cadence).toISOString() : undefined,
  };
}

export interface CloseParams {
  quantity: number;
  exitPrice: number;
}

/**
 * Trim a portion of the open position. Realizes PnL on the closed quantity and
 * moves to PARTIALLY_CLOSED, or CLOSED when the trim empties the position.
 */
export function recordPartialClose(
  thesis: Thesis,
  params: CloseParams,
  at: string,
): Thesis {
  assertPositive(params.quantity, "close quantity");
  assertPositive(params.exitPrice, "exitPrice");
  if (thesis.entryPrice === undefined) {
    throw new Error("cannot close a thesis with no entry price");
  }
  if (params.quantity > thesis.openQuantity + 1e-9) {
    throw new RangeError(
      `close quantity ${params.quantity} exceeds open quantity ${thesis.openQuantity}`,
    );
  }
  const perUnit =
    (params.exitPrice - thesis.entryPrice) * (thesis.side === "long" ? 1 : -1);
  const realized = perUnit * params.quantity;
  const remaining = thesis.openQuantity - params.quantity;
  const target: ThesisState = remaining <= 1e-9 ? "CLOSED" : "PARTIALLY_CLOSED";
  const moved = transition(thesis, target, at);
  return {
    ...moved,
    openQuantity: Math.max(0, remaining),
    realizedPnl: thesis.realizedPnl + realized,
    closes: [
      ...thesis.closes,
      { quantity: params.quantity, exitPrice: params.exitPrice, realizedPnl: realized, at },
    ],
    nextReviewAt: target === "CLOSED" ? undefined : moved.nextReviewAt,
  };
}

/** Close the entire remaining position at `exitPrice`. */
export function closePosition(thesis: Thesis, exitPrice: number, at: string): Thesis {
  return recordPartialClose(thesis, { quantity: thesis.openQuantity, exitPrice }, at);
}

/** Abandon / invalidate the thesis (broken, not exited on plan). */
export function terminate(thesis: Thesis, reason: string, at: string): Thesis {
  const moved = transition(thesis, "TERMINATED", at, reason);
  return { ...moved, nextReviewAt: undefined };
}

/** Update MAE / MFE from an observed mark. Safe in any post-entry state. */
export function updateExcursion(thesis: Thesis, price: number, at: string): Thesis {
  if (thesis.entryPrice === undefined) return thesis;
  const excursion = directionalExcursion(thesis, price);
  return stamp(
    {
      ...thesis,
      mfe: Math.max(thesis.mfe, excursion),
      mae: Math.min(thesis.mae, excursion),
    },
    at,
  );
}

/** Mark a scheduled review complete and reschedule the next one. */
export function completeReview(thesis: Thesis, at: string): Thesis {
  const cadence = thesis.reviewEveryMs;
  return stamp(
    {
      ...thesis,
      nextReviewAt: cadence
        ? new Date(new Date(at).getTime() + cadence).toISOString()
        : undefined,
    },
    at,
  );
}

// ----------------------------------------------------------------------------
// Review scheduler
// ----------------------------------------------------------------------------

/** True when a thesis is open and its next review is due at/before `asOf`. */
export function isReviewDue(thesis: Thesis, asOf: Date): boolean {
  if (thesis.state !== "ACTIVE" && thesis.state !== "PARTIALLY_CLOSED") return false;
  if (!thesis.nextReviewAt) return false;
  return new Date(thesis.nextReviewAt).getTime() <= asOf.getTime();
}

/** Filter a set of theses to those whose review is due at/before `asOf`. */
export function reviewsDue(theses: Thesis[], asOf: Date): Thesis[] {
  return theses.filter((t) => isReviewDue(t, asOf));
}

/** True once the thesis has reached a terminal state. */
export function isTerminal(thesis: Thesis): boolean {
  return thesis.state === "CLOSED" || thesis.state === "TERMINATED";
}
