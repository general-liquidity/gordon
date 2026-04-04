/**
 * Memory Factory
 *
 * Creates Memory instances for the main Gordon agent and sub-agents.
 * Extracted from agents.ts to be shared by per-agent definition files.
 */

import { Memory } from "@mastra/memory";
import { getFastMastraModel } from "../providers/registry.ts";
import { LocalEmbeddingProvider } from "../../core/memory/embeddings.ts";
import { createMastraStorageConfig } from "./mastraStorage.ts";
import { createModuleLogger } from "../logger/logger.ts";
import { WORKING_MEMORY_LABELS } from "./capabilityTruth.ts";
import { getMemoryConfig } from "./memoryConfig.ts";

const logger = createModuleLogger("agents");

/**
 * Working memory template for trading context
 * Maintains persistent state across conversations
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

## Session State
- Current Focus:
- Active Analysis:
- Pending Decisions:
- Recent Wins/Losses:
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
 * Features semantic recall, working memory, and observational memory.
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
  logger.info("Creating memory", { lastMessages, mode });

  return new Memory({
    storage,
    vector,
    embedder: vector ? createMastraLocalEmbedder() : undefined,
    options: {
      lastMessages,
      semanticRecall: vector
        ? {
          topK: 5,
          messageRange: {
            before: 3,
            after: 2,
          },
        }
        : false,
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
let _subAgentMemory: Memory | null = null;

export function createSubAgentMemory(): Memory {
  if (!_subAgentMemory) {
    const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
    const { storage } = createMastraStorageConfig({
      storeId: "gordon-sub-memory",
      dbUrl,
      enableVector: false,
    });
    _subAgentMemory = new Memory({
      storage,
      options: {
        lastMessages: 10,
        workingMemory: {
          enabled: false,
        },
      },
    });
  }
  return _subAgentMemory;
}

/**
 * Reset the sub-agent memory singleton.
 * Called when the session is cleared.
 */
export function resetSubAgentMemory(): void {
  _subAgentMemory = null;
}
