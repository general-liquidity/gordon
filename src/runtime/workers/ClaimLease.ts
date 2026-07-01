/**
 * Claim fencing / lease-expiry primitive (C7, [CommonGround]).
 *
 * A per-work-unit lease with a monotonic fencing token. Whoever holds a
 * valid, unexpired lease owns the work unit; when a lease expires another
 * caller may claim it, which mints a strictly-higher fencing token. Any
 * operation carrying a superseded (lower) token is rejected — the classic
 * Kleppmann fencing-token defense against a stalled holder resuming after
 * its lease was reassigned.
 *
 * This is finer-grained than Gordon's session-level
 * `trust_must_reestablish`: it fences a single unit of work, not the whole
 * session. All time is injected by the caller, so it is fully
 * deterministic and pure (in-memory, no I/O, no clock).
 *
 * UNWIRED (parked until concurrency). Gordon's runtime is single-flighted
 * today; this primitive has no live caller and is intentionally not wired
 * into the gateway, workers, or scheduler. Revive it when the
 * dynamic-subagent / headless-gateway path introduces real concurrency
 * over shared work units (see specs/new-builds-candidates.md C7).
 */

export interface ClaimToken {
  /** Monotonic fencing token for this work unit. Higher = newer. */
  token: number;
  /** The unit of work this lease covers. */
  workUnit: string;
  /** Lease expiry (ms epoch). At/after this instant the lease is stale. */
  expiresAt: number;
  /** Optional holder identifier, carried for audit only. */
  holder?: string;
}

export type ClaimResult =
  | { ok: true; token: ClaimToken }
  | { ok: false; reason: string; current?: ClaimToken };

/**
 * In-memory lease table. Keeps the latest token per work unit even after
 * expiry so the fencing counter stays monotonic across re-claims.
 */
export class ClaimLeaseManager {
  private readonly leases = new Map<string, ClaimToken>();

  /**
   * Acquire a work unit. Succeeds when the unit is free or its current
   * lease has expired, minting a fencing token one higher than any token
   * ever issued for that unit. Rejected while a valid lease is held.
   */
  claim(workUnit: string, now: number, leaseMs: number, holder?: string): ClaimResult {
    const current = this.leases.get(workUnit);
    if (current && now < current.expiresAt) {
      return {
        ok: false,
        reason: `work unit "${workUnit}" is held by fencing token ${current.token} until ${current.expiresAt}`,
        current,
      };
    }
    const token: ClaimToken = {
      token: current ? current.token + 1 : 1,
      workUnit,
      expiresAt: now + leaseMs,
      holder,
    };
    this.leases.set(workUnit, token);
    return { ok: true, token };
  }

  /**
   * Extend an existing lease. Rejected if the token was superseded (a
   * newer token exists), unknown, or already expired — an expired holder
   * must re-`claim`, which fences off any stale worker.
   */
  renew(token: ClaimToken, now: number, leaseMs: number): ClaimResult {
    const current = this.leases.get(token.workUnit);
    if (!current) {
      return { ok: false, reason: `no lease exists for work unit "${token.workUnit}"` };
    }
    if (token.token !== current.token) {
      return {
        ok: false,
        reason: `fencing token ${token.token} superseded by ${current.token}`,
        current,
      };
    }
    if (now >= current.expiresAt) {
      return { ok: false, reason: `lease for "${token.workUnit}" expired at ${current.expiresAt}`, current };
    }
    const renewed: ClaimToken = { ...current, expiresAt: now + leaseMs };
    this.leases.set(token.workUnit, renewed);
    return { ok: true, token: renewed };
  }

  /**
   * True only for the current, unexpired fencing token of its work unit.
   * A superseded or expired token is invalid.
   */
  isValid(token: ClaimToken, now: number): boolean {
    const current = this.leases.get(token.workUnit);
    return !!current && current.token === token.token && now < current.expiresAt;
  }

  /**
   * Report every work unit whose current lease has expired at `now`. The
   * fencing record is retained (not deleted) so the next claim keeps
   * incrementing the token. Callers use this to release resources held by
   * a lapsed holder before the unit is re-claimed.
   */
  reconcileExpired(now: number): ClaimToken[] {
    const expired: ClaimToken[] = [];
    for (const lease of this.leases.values()) {
      if (now >= lease.expiresAt) expired.push(lease);
    }
    return expired;
  }

  /** Current fencing token for a work unit, valid or not. */
  currentToken(workUnit: string): ClaimToken | undefined {
    return this.leases.get(workUnit);
  }

  /** For tests. */
  reset(): void {
    this.leases.clear();
  }
}
