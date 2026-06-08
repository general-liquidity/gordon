/**
 * Cross-provider failover chain + degraded-mode signaling.
 *
 * `llm/client.ts` already retries transient errors on the SAME provider
 * (exponential backoff). This is the layer ABOVE that: when a provider is
 * exhausted/down/refusing, walk an ordered chain of candidates (primary →
 * fallback → …) until one succeeds, and flag `degraded: true` when a non-primary
 * answered so callers/UX can surface "running on fallback model X".
 *
 * Additive and composable — it wraps the caller's per-candidate `call` (which
 * keeps its own same-provider retry); it does NOT rewrite the central client.
 * `isFatal` lets the caller short-circuit failover for errors no provider would
 * recover (a user abort, a hard content-policy refusal). Pure control flow;
 * returns a structured result rather than throwing (except on a fatal error).
 */

export interface FailoverResult<R> {
  ok: boolean;
  result?: R;
  /** Index in the chain that answered; -1 if all failed. */
  usedIndex: number;
  usedId: string | null;
  /** True when a non-primary answered (or all failed). */
  degraded: boolean;
  /** Candidates attempted. */
  attempts: number;
  /** Per-failed-candidate errors, in order. */
  errors: Array<{ id: string; error: string }>;
}

export interface FailoverOptions<C, R> {
  /** Ordered candidates, primary first. */
  chain: C[];
  /** Stable label for a candidate (provider/model id). */
  idOf: (candidate: C) => string;
  /** Invoke a candidate; may run its own same-provider retries inside. */
  call: (candidate: C, index: number) => Promise<R>;
  /** Return true for errors that should NOT trigger failover (rethrown). */
  isFatal?: (error: unknown) => boolean;
}

export async function executeWithFailover<C, R>(opts: FailoverOptions<C, R>): Promise<FailoverResult<R>> {
  const errors: Array<{ id: string; error: string }> = [];
  const chain = opts.chain ?? [];

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i]!;
    const id = opts.idOf(candidate);
    try {
      const result = await opts.call(candidate, i);
      return { ok: true, result, usedIndex: i, usedId: id, degraded: i > 0, attempts: i + 1, errors };
    } catch (e) {
      if (opts.isFatal?.(e)) throw e; // non-recoverable across providers → propagate
      errors.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ok: false, usedIndex: -1, usedId: null, degraded: true, attempts: chain.length, errors };
}
