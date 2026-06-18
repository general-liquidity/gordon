/**
 * Active ACE lesson-set revision — process-local attribution stamp.
 *
 * The Curator stamps each persisted lesson set with a monotonic `revision`
 * (see Curator.ts). This module tracks the revision that was actually INJECTED
 * into the running agent's prompt this session — set once at injection time
 * (`promptSections.ts`). Recorded outputs (action-log entries) are stamped with
 * it so any logged action can be attributed to the lesson revision the agent
 * was operating under when it produced the action — closing the ACE loop the
 * other way (the Reflector mines these same entries).
 *
 * Why the injected revision and not `loadACELessons().revision`: the on-disk
 * store can change mid-session as the Curator runs, but attribution needs the
 * revision the agent SAW, which is fixed at prompt-compose time.
 *
 * Deliberately ZERO imports — a leaf module so any layer (e.g. action-log) can
 * read the stamp without an import cycle back through the Curator.
 */

let activeRevision = 0;

/** Set the active revision (the one injected into the prompt this session). */
export function setActiveACELessonRevision(revision: number): void {
  if (Number.isFinite(revision) && revision >= 0) {
    activeRevision = Math.floor(revision);
  }
}

/** The ACE lesson revision the agent is operating under. 0 = none / ACE off. */
export function getActiveACELessonRevision(): number {
  return activeRevision;
}

/** Reset to the default (0). For test isolation. */
export function resetActiveACELessonRevision(): void {
  activeRevision = 0;
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
): Record<string, unknown> {
  const rev = getActiveACELessonRevision();
  if (rev <= 0 || "aceLessonRevision" in payload) return payload;
  return { ...payload, aceLessonRevision: rev };
}
