/**
 * Memory Tools (Mastra Format)
 *
 * Agent tools for interacting with Gordon's persistent memory system.
 * Allows agents to search memories, record observations and insights,
 * retrieve lessons learned, and get contextual memory for conversations.
 *
 * All memory operations are wrapped in try/catch — memory failures
 * should never crash agent execution.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getMemoryManager } from "../../../../../core/memory/index.ts";
import { searchSessionHistory } from "../../../../memory/selfHistory/index.ts";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("memory-tools");

// ============================================================================
// Search Memory Tool
// ============================================================================

export const searchMemoryTool = createTool({
  id: "search_memory",
  description:
    "Search across all persistent memory entries using hybrid keyword + semantic search. " +
    "Use to recall past trades, observations, insights, or market conditions.",
  inputSchema: z.object({
    query: z.string().describe("Search query (natural language or keywords)"),
    limit: z.number().min(1).max(20).default(5).describe("Max results to return"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        content: z.string(),
        type: z.string(),
        score: z.number(),
        age: z.string(),
        symbols: z.array(z.string()).optional(),
      }),
    ),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ query, limit }) => {
    try {
      const manager = await getMemoryManager();
      const results = await manager.journal.search(query, {
        limit: limit ?? 5,
      });

      return {
        results: results.map((r) => ({
          content: r.entry.content,
          type: r.entry.type,
          score: Math.round(r.score * 100) / 100,
          age: formatAge(r.entry.createdAt),
          symbols: r.entry.symbols,
        })),
        count: results.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("search_memory failed", { error: message });
      return { results: [], count: 0, error: message };
    }
  },
});

// ============================================================================
// Record Observation Tool
// ============================================================================

export const recordObservationTool = createTool({
  id: "record_observation",
  description:
    "Record a market observation to persistent memory. " +
    "Use when noticing patterns, anomalies, or notable market conditions worth remembering.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    observation: z.string().describe("What was observed (pattern, anomaly, condition)"),
    conditions: z.string().default("").describe("Market conditions at time of observation"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, observation, conditions }) => {
    try {
      const manager = await getMemoryManager();
      const id = await manager.journal.recordObservation({
        symbol: symbol.toUpperCase(),
        observation,
        conditions: conditions || "Not specified",
      });

      return { success: true, id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("record_observation failed", { error: message });
      return { success: false, error: message };
    }
  },
});

// ============================================================================
// Record Insight Tool
// ============================================================================

export const recordInsightTool = createTool({
  id: "record_insight",
  description:
    "Record an agent insight or conclusion to persistent memory. " +
    "Use when arriving at an important conclusion, signal, or recommendation worth preserving.",
  inputSchema: z.object({
    content: z.string().describe("The insight or conclusion"),
    confidence: z.number().min(0).max(1).describe("Confidence level (0-1)"),
    symbol: z.string().optional().describe("Related symbol if applicable"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ content, confidence, symbol }) => {
    try {
      const manager = await getMemoryManager();
      const id = await manager.journal.recordInsight({
        agentId: "agent",
        insight: content,
        confidence,
        symbol: symbol?.toUpperCase(),
      });

      return { success: true, id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("record_insight failed", { error: message });
      return { success: false, error: message };
    }
  },
});

// ============================================================================
// Get Lessons Tool
// ============================================================================

export const getLessonsTool = createTool({
  id: "get_lessons",
  description:
    "Get lessons learned for a specific trading symbol. " +
    "Returns past trade journal entries and insights to avoid repeating mistakes.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    limit: z.number().min(1).max(20).default(10).describe("Max lessons to return"),
  }),
  outputSchema: z.object({
    lessons: z.array(
      z.object({
        content: z.string(),
        type: z.string(),
        importance: z.number(),
        age: z.string(),
      }),
    ),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }) => {
    try {
      const manager = await getMemoryManager();
      const entries = await manager.journal.getLessonsForSymbol(symbol.toUpperCase());

      const sliced = entries.slice(0, limit ?? 10);

      return {
        lessons: sliced.map((e) => ({
          content: e.content,
          type: e.type,
          importance: Math.round(e.importance * 100) / 100,
          age: formatAge(e.createdAt),
        })),
        count: sliced.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_lessons failed", { error: message });
      return { lessons: [], count: 0, error: message };
    }
  },
});

// ============================================================================
// Get Memory Context Tool
// ============================================================================

export const getMemoryContextTool = createTool({
  id: "get_memory_context",
  description:
    "Get relevant memory context for the current conversation. " +
    "Returns formatted markdown with recent work, relevant memories, and trade history.",
  inputSchema: z.object({
    query: z.string().optional().describe("Current query or topic for semantic retrieval"),
  }),
  outputSchema: z.object({
    context: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ query }) => {
    try {
      const manager = await getMemoryManager();
      const context = await manager.getContextForAgent("agent", query);

      return { context: context || "No relevant memories found." };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_memory_context failed", { error: message });
      return { context: "", error: message };
    }
  },
});

// ============================================================================
// Search Session History Tool (self-history recall)
// ============================================================================

/**
 * Ranked recall over Gordon's OWN past chat sessions. Unlike `search_memory`
 * (which searches the extracted-fact journal), this searches the raw
 * transcripts of prior sessions — "when did I last analyze this setup", "what
 * did I conclude about SOL microstructure", "show the last time this playbook
 * fired". Backed by the incremental staleness catalog + the hybrid retrieval
 * stack, so every hit carries why it matched and a citation cursor
 * (session id + message offset) back to the exact turn.
 */
export const searchSessionHistoryTool = createTool({
  id: "search_session_history",
  description:
    "Search Gordon's own PAST CHAT SESSIONS (raw transcripts) with ranked, " +
    "provenance-carrying recall. Use to recall your prior analysis or the " +
    "operator's past questions: 'when did I last analyze this setup', 'what " +
    "did I conclude about SOL microstructure', 'the last time this playbook " +
    "fired'. Each result includes why it matched and a citation (session id + " +
    "message offset) to the exact turn. Distinct from search_memory, which " +
    "searches extracted durable facts, not transcripts.",
  inputSchema: z.object({
    query: z.string().describe("Search query (natural language or keywords)"),
    limit: z.number().min(1).max(20).default(5).describe("Max past-session turns to return"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        content: z.string(),
        role: z.string(),
        agent: z.string().optional(),
        score: z.number(),
        age: z.string(),
        whyMatched: z.array(z.string()),
        citation: z.object({
          sessionId: z.string(),
          messageIndex: z.number(),
          timestamp: z.string().nullable(),
        }),
      }),
    ),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ query, limit }) => {
    try {
      const hits = searchSessionHistory(query, { limit: limit ?? 5 });
      return {
        results: hits.map((h) => ({
          content: h.content,
          role: h.role,
          ...(h.agent ? { agent: h.agent } : {}),
          score: h.score,
          age: h.timestamp !== null ? formatAge(new Date(h.timestamp).toISOString()) : "unknown",
          whyMatched: h.whyMatched,
          citation: h.citation,
        })),
        count: hits.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("search_session_history failed", { error: message });
      return { results: [], count: 0, error: message };
    }
  },
});

// ============================================================================
// Helpers
// ============================================================================

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Memory tools exported as an object for Mastra Agent.
 * This is the format expected by Mastra's Agent class.
 */
export const memoryTools = {
  search_memory: searchMemoryTool,
  record_observation: recordObservationTool,
  record_insight: recordInsightTool,
  get_lessons: getLessonsTool,
  get_memory_context: getMemoryContextTool,
};

/**
 * Self-history recall tools — a separate object so they can be tier-gated
 * independently of the hot-tier memory tools. Registered COLD on the
 * researcher (self-recall is a deep-work path, not the hot scan loop).
 */
export const selfHistoryTools = {
  search_session_history: searchSessionHistoryTool,
};
