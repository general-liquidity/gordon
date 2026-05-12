/**
 * Memory Factory
 *
 * Creates Memory instances for the main Gordon agent and sub-agents.
 * Extracted from agents.ts to be shared by per-agent definition files.
 */

import { Memory } from "@mastra/memory";
import { getFastMastraModel } from "../../runtime/providers/registry.ts";
import { LocalEmbeddingProvider } from "../../../core/memory/embeddings.ts";
import { createMastraStorageConfig } from "./mastraStorage.ts";
import { createModuleLogger } from "../../logger/logger.ts";
import { WORKING_MEMORY_LABELS } from "../capabilityTruth.ts";
import { getMemoryConfig } from "./memoryConfig.ts";
import { wrapMemoryWithGate, MAX_WORKING_MEMORY_CHARS } from "./memoryGate.ts";

const logger = createModuleLogger("agents");

/**
 * Working-memory template — Hermes hot-tier discipline.
 *
 * Holds ONLY durable trader-profile fields (risk preferences, venue,
 * account type, market focus). Session-state fields — Current Focus,
 * Active Analysis, Pending Decisions, Recent Wins/Losses — were
 * removed: per the "Reverse-Engineering Memory" article, those are
 * exactly the categories that turn working memory into context rot.
 * The Hermes rule: "Save user preferences, environment facts,
 * recurring corrections, stable conventions. Do not save task progress,
 * session outcomes, temporary TODO state."
 *
 * Session-state lives in working state (Mastra thread messages, the
 * orchestrator's stream context), NOT in the always-injected hot tier.
 *
 * Total filled length must stay under MAX_WORKING_MEMORY_CHARS (2200).
 * The memoryGate enforces this on write.
 */
const WORKING_MEMORY_TEMPLATE = `
# Trader Profile

## Personal Info
- Name:
- Timezone:
- Trading Experience Level: (beginner/intermediate/advanced)

## Risk Preferences
- Max Risk Per Trade: (e.g., 2%)
- Max Portfolio Allocation Per Position: (e.g., 10%)
- Preferred Stop Loss Style: (tight/normal/wide)
- Risk Tolerance: (conservative/moderate/aggressive)

## Trading Style
- Preferred Timeframes: (1h/4h/1D)
- ${WORKING_MEMORY_LABELS.favorites}:
- ${WORKING_MEMORY_LABELS.avoided}:
- Preferred Strategies:
- Trading Hours: (e.g., "9am-5pm EST" or "24/7")

## Account Context
- ${WORKING_MEMORY_LABELS.defaultVenue}: (active exchange, broker, or protocol)
- ${WORKING_MEMORY_LABELS.accountType}: (spot/margin/futures/cash)
- ${WORKING_MEMORY_LABELS.marketFocus}
- ${WORKING_MEMORY_LABELS.baseCurrency}
`;

function createMastraLocalEmbedder() {
  const provider = new LocalEmbeddingProvider();

  return {
    modelId: provider.name,
    async doEmbed(args: { values: string[] }): Promise<{ embeddings: number[][] }> {
      const embeddings = await provider.embedBatch(args.values);
      return { embeddings };
    },
  };
}

/**
 * Create the full memory instance for the main Gordon agent.
 *
 * Hot tier (always-injected): durable trader-profile working memory,
 * char-capped at MAX_WORKING_MEMORY_CHARS via memoryGate.
 *
 * Cold tier (tool-invoked only): vector storage is attached, but
 * `semanticRecall` is disabled — the model issues cold-recall queries
 * explicitly through the tools in memory-tools.ts.
 *
 * Background: observationalMemory still runs (observation + reflection
 * passes) so session summaries accumulate for later retrieval.
 */
export function createMemory(): Memory {
  const _memoryConfig = getMemoryConfig();
  const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
  const vectorDbUrl = process.env.VECTOR_DATABASE_URL || "file:gordon-vector.db";
  const { storage, vector, mode } = createMastraStorageConfig({
    storeId: "gordon-memory",
    dbUrl,
    enableVector: true,
    vectorId: "gordon-vector",
    vectorDbUrl,
  });

  const lastMessages = _memoryConfig.lastMessages;
  logger.info("Creating memory", {
    lastMessages,
    mode,
    hotTierCap: MAX_WORKING_MEMORY_CHARS,
  });

  // Semantic recall is explicitly disabled (Hermes pattern: cold recall
  // must go through tools, not ambient injection). Vector storage is
  // still attached so `searchMemoryTool` and friends in memory-tools.ts
  // can issue scoped queries on demand.
  const mem = new Memory({
    storage,
    vector,
    embedder: vector ? createMastraLocalEmbedder() : undefined,
    options: {
      lastMessages,
      semanticRecall: false,
      workingMemory: {
        enabled: true,
        template: WORKING_MEMORY_TEMPLATE,
      },
      generateTitle: true,
      observationalMemory: {
        model: getFastMastraModel(),
        scope: "thread",
        observation: {
          messageTokens: 30_000,
          bufferTokens: 0.2,
          bufferActivation: 0.8,
          blockAfter: 1.2,
        },
        reflection: {
          observationTokens: 40_000,
          bufferActivation: 0.5,
          blockAfter: 1.2,
        },
      },
    },
  });

  return wrapMemoryWithGate(mem);
}

/**
 * Lightweight shared memory for sub-agents (Scanner, Analyst, etc.)
 *
 * When Mastra's Agent Network routes to a sub-agent, it passes memory context
 * (threadId, resourceId) which triggers injection of the updateWorkingMemory tool.
 * Without a Memory instance on the sub-agent, this tool crashes.
 *
 * This memory disables workingMemory so the tool is NOT injected (Mastra checks
 * workingMemory.enabled before adding the tool). Sub-agents use our custom
 * shared_context tools for cross-agent communication instead.
 */
/**
 * Per-agent memory instances. Each sub-agent gets its own isolated store
 * so Executor learns from execution outcomes and Researcher learns from
 * analysis patterns independently. Claude Code pattern: agent-scoped
 * persistent knowledge stores.
 */
const _subAgentMemories = new Map<string, Memory>();

export function createSubAgentMemory(agentId?: string): Memory {
  const key = agentId ?? "_shared";
  const existing = _subAgentMemories.get(key);
  if (existing) return existing;

  const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
  const storeId = agentId ? `gordon-memory-${agentId}` : "gordon-sub-memory";
  const { storage } = createMastraStorageConfig({
    storeId,
    dbUrl,
    enableVector: false,
  });
  const mem = new Memory({
    storage,
    options: {
      lastMessages: 10,
      workingMemory: {
        enabled: false,
      },
    },
  });
  const wrapped = wrapMemoryWithGate(mem);
  _subAgentMemories.set(key, wrapped);
  return wrapped;
}

/**
 * Reset all sub-agent memory instances.
 * Called when the session is cleared.
 */
export function resetSubAgentMemory(): void {
  _subAgentMemories.clear();
}
