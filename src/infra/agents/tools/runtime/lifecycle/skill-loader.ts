/**
 * Skill Loader Tools
 *
 * Exposes the skill registry to agents so they can pull detailed workflow
 * guidance on demand instead of carrying it all in the base system prompt.
 * Inspired by Vibe-Trading's SKILL.md pattern.
 *
 * Tools:
 *   - list_skills — enumerate available skill ids with short summaries
 *   - load_skill  — fetch the full markdown for a specific skill
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { listSkillSummaries, loadSkill } from "../../../skills/index.ts";
import { hybridSearch, type MemoryEntry } from "../../../../memory/hybrid/search.ts";

// ============================================================================
// 1. list_skills
// ============================================================================

export const listSkillsTool = createTool({
  id: "list_skills",
  description:
    "List all available Gordon workflow skills with their one-line summaries. " +
    "Skills are structured guides for common workflows like /quick-scan, /dd, " +
    "/risk-check, /swing-entry, /research, /radar, /weekend-review. Call " +
    "list_skills to discover available skills, then load_skill to pull the " +
    "full workflow guide for the one you need. This replaces inline system " +
    "prompt documentation and keeps the base context small.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    total: z.number(),
    skills: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
      }),
    ),
  }),
  execute: async () => {
    const summaries = listSkillSummaries();
    return { total: summaries.length, skills: summaries };
  },
});

// ============================================================================
// 2. load_skill
// ============================================================================

export const loadSkillTool = createTool({
  id: "load_skill",
  description:
    "Load the full markdown content of a specific Gordon skill. Skills " +
    "contain structured guidance on when to use the workflow, the step-by-step " +
    "flow, the tools involved, what good output looks like, and common failure " +
    "modes. Call this before executing a known workflow to ground your reasoning " +
    "in the canonical approach rather than improvising. If the skill id is not " +
    "found, returns error with a suggestion to call list_skills.",
  inputSchema: z.object({
    id: z.string().describe("Skill id (e.g. 'quick-scan', 'dd', 'swing-entry', 'radar', 'research')"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    id: z.string(),
    content: z.string().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    const skill = loadSkill(id);
    if (!skill) {
      return {
        found: false,
        id,
        error: `Skill '${id}' not found. Call list_skills to see available skills.`,
      };
    }
    return {
      found: true,
      id: skill.id,
      content: skill.content,
      summary: skill.summary,
    };
  },
});

// ============================================================================
// 3. search_skills
// ============================================================================

export const searchSkillsTool = createTool({
  id: "search_skills",
  description:
    "Rank Gordon's workflow skills by relevance to a free-text query and " +
    "return the top matches. Prefer this over list_skills when you know what " +
    "you're trying to do (e.g. 'validate a backtest', 'analyze a filing', " +
    "'recover from a failed order') — list_skills enumerates the full catalog " +
    "unranked, while search_skills BM25-ranks the summaries and returns only " +
    "the best few. Then call load_skill on the id you want.",
  inputSchema: z.object({
    query: z.string().describe("What you're trying to do, in natural language."),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Maximum number of skills to return (default 5)."),
  }),
  outputSchema: z.object({
    total: z.number(),
    matches: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        score: z.number(),
      }),
    ),
  }),
  execute: async ({ query, top_k }) => {
    const summaries = listSkillSummaries();
    const summaryById = new Map(summaries.map((s) => [s.id, s.summary]));

    // Index the skill id + summary together so id tokens ("backtest-validate")
    // are searchable alongside the description. Skills are evergreen — no
    // temporal decay (timestamp null).
    const entries: MemoryEntry[] = summaries.map((s) => ({
      id: s.id,
      content: `${s.id} ${s.summary}`,
      timestamp: null,
    }));

    const ranked = hybridSearch(query, entries, { limit: top_k });

    return {
      total: ranked.length,
      matches: ranked.map((r) => ({
        id: r.id,
        summary: summaryById.get(r.id) ?? "",
        score: r.score,
      })),
    };
  },
});

// ============================================================================
// Export
// ============================================================================

export const skillLoaderTools = {
  list_skills: listSkillsTool,
  load_skill: loadSkillTool,
  search_skills: searchSkillsTool,
};
