/**
 * ACE Tools (Mastra Format)
 *
 * Activation wiring for the ACE (Agentic Context Engineering) loop. The
 * Reflector + Curator pipeline in src/infra/agents/ace/ is already
 * built and gated behind GORDON_ACE_ENABLED. These tools expose it to
 * the agent + slash commands so accumulated lessons can be refreshed
 * and inspected on demand.
 *
 * Both tools no-op when ACE is disabled — caller never crashes on a
 * cold install.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  formatACELessonsForPrompt,
  getACELessonsPath,
  isACEEnabled,
  loadACELessons,
  runCurator,
  runReflector,
} from "../ace/index.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("ace-tools");

// ============================================================================
// run_ace_cycle — refresh lessons from the action log
// ============================================================================

export const runACECycleTool = createTool({
  id: "run_ace_cycle",
  description:
    "Refresh the ACE (Agentic Context Engineering) lessons store from the action log. " +
    "Runs the Reflector to extract recurring patterns from recent trades, executions, and " +
    "decisions, then the Curator to dedupe + rank + persist them. Lessons accumulated this " +
    "way are injected into the system prompt of future sessions. Use after a notable trading " +
    "session, after a recovery event, or when the user runs /reflect.",
  inputSchema: z.object({
    lookbackEntries: z
      .number()
      .min(10)
      .max(2000)
      .default(200)
      .describe("Action-log lookback window (entries). Default 200."),
    threadId: z
      .string()
      .optional()
      .describe("Optional thread filter — restrict to one session's action log."),
  }),
  outputSchema: z.object({
    enabled: z.boolean(),
    candidatesExtracted: z.number(),
    lessonsRetained: z.number(),
    entriesAnalyzed: z.number(),
    lessonsPath: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ lookbackEntries, threadId }) => {
    if (!isACEEnabled()) {
      return {
        enabled: false,
        candidatesExtracted: 0,
        lessonsRetained: 0,
        entriesAnalyzed: 0,
        lessonsPath: getACELessonsPath(),
      };
    }
    try {
      const reflectorOutput = runReflector({ lookbackEntries, threadId });
      if (reflectorOutput.candidates.length > 0) {
        runCurator(reflectorOutput);
      }
      const store = loadACELessons();
      return {
        enabled: true,
        candidatesExtracted: reflectorOutput.candidates.length,
        lessonsRetained: store.lessons.length,
        entriesAnalyzed: reflectorOutput.entriesAnalyzed,
        lessonsPath: getACELessonsPath(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("run_ace_cycle failed", { err: message });
      return {
        enabled: true,
        candidatesExtracted: 0,
        lessonsRetained: 0,
        entriesAnalyzed: 0,
        lessonsPath: getACELessonsPath(),
        error: message,
      };
    }
  },
});

// ============================================================================
// list_ace_lessons — inspect the current lesson store
// ============================================================================

export const listACELessonsTool = createTool({
  id: "list_ace_lessons",
  description:
    "List ACE lessons currently persisted to ~/.gordon/ace-lessons.json. Use when the user " +
    "asks what Gordon has learned across sessions, or to inspect what's being injected into " +
    "the system prompt. Returns the lesson text, category, evidence count, and score.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Max lessons to return. Sorted by score descending."),
  }),
  outputSchema: z.object({
    enabled: z.boolean(),
    count: z.number(),
    lessons: z.array(
      z.object({
        category: z.string(),
        text: z.string(),
        evidenceCount: z.number(),
        score: z.number(),
        firstSeenAt: z.number(),
        lastSeenAt: z.number(),
      }),
    ),
  }),
  execute: async ({ limit }) => {
    if (!isACEEnabled()) {
      return { enabled: false, count: 0, lessons: [] };
    }
    const store = loadACELessons();
    const trimmed = store.lessons.slice(0, limit);
    return {
      enabled: true,
      count: store.lessons.length,
      lessons: trimmed.map((l) => ({
        category: l.category,
        text: l.text,
        evidenceCount: l.evidenceCount,
        score: Math.round(l.score * 100) / 100,
        firstSeenAt: l.firstSeenAt,
        lastSeenAt: l.lastSeenAt,
      })),
    };
  },
});

// ============================================================================
// Export bundle (Mastra format)
// ============================================================================

export const aceTools = {
  run_ace_cycle: runACECycleTool,
  list_ace_lessons: listACELessonsTool,
};

/** Test/debug helper — expose the formatted prompt block for prompt-section injection. */
export function getACEPromptBlock(): string {
  if (!isACEEnabled()) return "";
  const store = loadACELessons();
  return formatACELessonsForPrompt(store);
}
