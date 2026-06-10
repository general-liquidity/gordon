// Once-per-session notice when the risk-kernel pre-check (evaluateToolAccess)
// throws. Without this the failure was swallowed and every approval silently
// fell back to manual review — the operator never learned the classifier was
// down, which defeats the point of having an automated risk gate.

let notified = false;

/**
 * Returns a user-facing warning the FIRST time the risk kernel fails this
 * session, null on subsequent failures. Caller decides how to surface it.
 */
export function noteRiskKernelFailure(err: unknown): string | null {
  if (notified) return null;
  notified = true;
  const detail = err instanceof Error ? err.message : String(err);
  return (
    `⚠ Risk-kernel pre-check failed: ${detail}. ` +
    `Automatic approve/deny is OFF — all tool approvals fall back to manual review. ` +
    `(Shown once per session.)`
  );
}

export function hasNotifiedRiskKernelFailure(): boolean {
  return notified;
}

export function resetRiskKernelHealth(): void {
  notified = false;
}
