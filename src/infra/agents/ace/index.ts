/**
 * ACE (Agentic Context Engineering) loop — barrel export
 *
 * The loop pairs a Reflector (extracts lesson candidates from the action log)
 * with a Curator (ranks, dedupes, persists lessons across sessions).
 *
 * Activate with `GORDON_ACE_ENABLED=true`. Both halves no-op otherwise.
 */

export {
  isACEEnabled,
  runReflector,
  mergeEvidenceIds,
  MAX_EVIDENCE_IDS,
  type ACELessonCandidate,
  type ReflectorInput,
  type ReflectorOutput,
} from "./Reflector.ts";

export {
  runCurator,
  loadACELessons,
  formatACELessonsForPrompt,
  getACELessonsPath,
  loadLessonEvidence,
  type ACELesson,
  type ACELessonStore,
} from "./Curator.ts";

export {
  getActiveACELessonRevision,
  setActiveACELessonRevision,
  resetActiveACELessonRevision,
  stampAceLessonRevision,
} from "./activeRevision.ts";

import { runReflector } from "./Reflector.ts";
import { runCurator } from "./Curator.ts";

/**
 * Convenience helper — run Reflector then Curator. No-op when ACE disabled.
 */
export function runACECycle(input: { lookbackEntries?: number; threadId?: string } = {}): void {
  const out = runReflector(input);
  if (out.candidates.length === 0) return;
  runCurator(out);
}
