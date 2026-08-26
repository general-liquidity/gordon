/**
 * Active ACE lesson-set revision — session-scoped attribution stamps.
 *
 * The Curator stamps each persisted lesson set with a monotonic `revision`
 * (see Curator.ts). This module tracks the revision that was actually INJECTED
 * into each running agent's prompt — set at injection time
 * (`promptSections.ts`). Recorded outputs (action-log entries) are stamped with
 * it so any logged action can be attributed to the lesson revision the agent
 * was operating under when it produced the action — closing the ACE loop the
 * other way (the Reflector mines these same entries).
 *
 * Why the injected revision and not `loadACELessons().revision`: the on-disk
 * store can change mid-session as the Curator runs, but attribution needs the
 * revision the agent SAW, which is fixed at prompt-compose time.
 *
 * A daemon can host concurrent sessions, so the revision is keyed by session,
 * thread, and resource aliases rather than stored in one process-global slot.
 * Deliberately ZERO imports — a leaf module so any layer (e.g. action-log) can
 * read the stamp without an import cycle back through the Curator.
 */

const DEFAULT_SCOPE = "__process_default__";
const activeRevisions = new Map<string, number>();

type RevisionScope = string | readonly (string | null | undefined)[];

function normalizeScopes(scope?: RevisionScope): string[] {
  if (typeof scope === "string") return scope.length > 0 ? [scope] : [DEFAULT_SCOPE];
  if (!scope) return [DEFAULT_SCOPE];
  const values = [...new Set(scope.filter((value): value is string => Boolean(value)))];
  return values.length > 0 ? values : [DEFAULT_SCOPE];
}

/** Set the active revision (the one injected into the prompt this session). */
export function setActiveACELessonRevision(
  revision: number,
  scope?: RevisionScope,
): void {
  if (Number.isFinite(revision) && revision >= 0) {
    const normalized = Math.floor(revision);
    for (const key of normalizeScopes(scope)) activeRevisions.set(key, normalized);
  }
}

/** The ACE lesson revision the agent is operating under. 0 = none / ACE off. */
export function getActiveACELessonRevision(
  scope?: RevisionScope,
): number {
  for (const key of normalizeScopes(scope)) {
    const revision = activeRevisions.get(key);
    if (revision !== undefined) return revision;
  }
  return 0;
}

/** Clear one session's aliases, or every scope when omitted (test/process reset). */
export function resetActiveACELessonRevision(
  scope?: RevisionScope,
): void {
  if (scope === undefined) {
    activeRevisions.clear();
    return;
  }
  for (const key of normalizeScopes(scope)) activeRevisions.delete(key);
}

/**
 * Return `payload` stamped with the active ACE lesson revision under
 * `aceLessonRevision`. No-op (returns the input unchanged) when no revision is
 * active (0 = ACE off / nothing injected) or when the payload already carries
 * the field — so a caller-supplied value is never clobbered and ACE-off
 * entries stay free of noise. Pure.
 */
export function stampAceLessonRevision(
  payload: Record<string, unknown>,
  scope?: RevisionScope,
): Record<string, unknown> {
  const rev = getActiveACELessonRevision(scope);
  if (rev <= 0 || "aceLessonRevision" in payload) return payload;
  return { ...payload, aceLessonRevision: rev };
}
