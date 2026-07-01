/**
 * Approval implementation-lifecycle ledger (C4, [AITrader]).
 *
 * An approval is not the same as a change actually being applied. A user
 * can approve a change ("tighten the max-position limit to 5%") and then
 * the run ends before anything consumes it — the approval is silently
 * forgotten. This ledger closes that gap: an approved item stays on the
 * `pendingImplementation()` surface every run until `markImplemented(id)`
 * is called, so approvals can't be consumed-and-forgotten.
 *
 * This is ADDITIVE and orthogonal to the trust/deny-list machinery. It
 * does NOT gate any tool call, does NOT auto-approve, and never touches
 * the safety-critical deny-list. It only tracks the two-state lifecycle
 * of an already-granted approval:
 *
 *     Approved --markImplemented(id)--> Implemented
 *
 * Pure in-memory, deterministic, time injected. No I/O.
 */

export type ApprovalState = "approved" | "implemented";

export interface ApprovalRecord {
  /** Stable identifier for the approved change. */
  id: string;
  /** Human-readable description of what was approved. */
  subject: string;
  /** Current lifecycle state. */
  state: ApprovalState;
  /** When the approval was recorded (ms epoch). */
  approvedAt: number;
  /** When the change was marked implemented (ms epoch); set only once implemented. */
  implementedAt?: number;
  /** Optional actor who granted the approval. */
  approvedBy?: string;
  /** Optional free-form context carried through the lifecycle. */
  metadata?: Record<string, unknown>;
}

export interface RecordApprovalInput {
  id: string;
  subject: string;
  approvedAt: number;
  approvedBy?: string;
  metadata?: Record<string, unknown>;
}

/**
 * In-memory ledger of approved-but-maybe-not-yet-implemented changes.
 * Construct one per runtime; callers thread it through or keep a
 * process singleton. Deterministic: all time comes from caller inputs.
 */
export class ApprovalLifecycleLedger {
  private readonly records = new Map<string, ApprovalRecord>();

  /**
   * Record a granted approval. Re-recording an existing id is a no-op on
   * state (an already-implemented item is not reopened) but refreshes the
   * subject/metadata of a still-pending one — an approval can be restated
   * before it is implemented without losing its place in the queue.
   */
  recordApproval(input: RecordApprovalInput): ApprovalRecord {
    const existing = this.records.get(input.id);
    if (existing && existing.state === "implemented") {
      return existing;
    }
    const record: ApprovalRecord = existing
      ? {
          ...existing,
          subject: input.subject,
          approvedAt: input.approvedAt,
          approvedBy: input.approvedBy ?? existing.approvedBy,
          metadata: input.metadata ?? existing.metadata,
        }
      : {
          id: input.id,
          subject: input.subject,
          state: "approved",
          approvedAt: input.approvedAt,
          approvedBy: input.approvedBy,
          metadata: input.metadata,
        };
    this.records.set(input.id, record);
    return record;
  }

  /**
   * Transition an approved item to implemented. Returns the updated
   * record, or undefined if the id was never approved. Marking an already
   * implemented item is idempotent (keeps the original implementedAt).
   */
  markImplemented(id: string, implementedAt: number): ApprovalRecord | undefined {
    const existing = this.records.get(id);
    if (!existing) return undefined;
    if (existing.state === "implemented") return existing;
    const updated: ApprovalRecord = {
      ...existing,
      state: "implemented",
      implementedAt,
    };
    this.records.set(id, updated);
    return updated;
  }

  /**
   * Every approved change not yet implemented. This is the re-surfacing
   * queue — call it at the start of each run to remind the operator of
   * approvals still owed an implementation. Sorted oldest-approval-first
   * so the longest-outstanding item leads.
   */
  pendingImplementation(): ApprovalRecord[] {
    return [...this.records.values()]
      .filter((r) => r.state === "approved")
      .sort((a, b) => a.approvedAt - b.approvedAt);
  }

  /** Look up a single record by id. */
  get(id: string): ApprovalRecord | undefined {
    return this.records.get(id);
  }

  /** Snapshot every record regardless of state — for tests and audit views. */
  list(): ApprovalRecord[] {
    return [...this.records.values()];
  }

  /** For tests. */
  reset(): void {
    this.records.clear();
  }
}
