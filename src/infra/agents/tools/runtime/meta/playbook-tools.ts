/**
 * Playbook Tools (Mastra Format)
 *
 * Agent tools for interacting with Gordon's Playbook system.
 * Allows agents to list, search, retrieve, and get role-specific
 * prompt fragments from trading playbooks.
 *
 * All playbook operations are wrapped in try/catch — playbook failures
 * should never crash agent execution.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  playbookRegistry,
  PlaybookPromptGenerator,
} from "../../../../../core/playbooks/index.ts";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("playbook-tools");
const promptGenerator = new PlaybookPromptGenerator();

// ============================================================================
// List Playbooks Tool
// ============================================================================

export const listPlaybooksTool = createTool({
  id: "list_playbooks",
  description:
    "List all available trading playbooks, grouped by skill tier. " +
    "Use when user asks 'what playbooks are available?' or 'show strategies'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    tiers: z.array(
      z.object({
        label: z.string(),
        playbooks: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            tier: z.string(),
            risk: z.string(),
            markets: z.string(),
            timeframes: z.string(),
            tags: z.string(),
            description: z.string(),
          })
        ),
      })
    ),
    total: z.number(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const formatted = playbookRegistry.listFormatted();
      return formatted;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("list_playbooks failed", { error: message });
      return { tiers: [], total: 0, error: message };
    }
  },
});

// ============================================================================
// Get Playbook Tool
// ============================================================================

export const getPlaybookTool = createTool({
  id: "get_playbook",
  description:
    "Get detailed information about a specific playbook by its ID. " +
    "Returns a full human-readable summary of the strategy.",
  inputSchema: z.object({
    id: z.string().describe("Playbook ID (kebab-case, e.g., 'momentum-breakout')"),
  }),
  outputSchema: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    try {
      const pb = playbookRegistry.getOrThrow(id);
      const summary = promptGenerator.generateSummary(pb);

      return {
        id: pb.id,
        name: pb.name,
        summary,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_playbook failed", { error: message, playbookId: id });
      return { error: message };
    }
  },
});

// ============================================================================
// Search Playbooks Tool
// ============================================================================

export const searchPlaybooksTool = createTool({
  id: "search_playbooks",
  description:
    "Search playbooks by a free-text query. Matches against names, descriptions, tags, markets, and symbols. " +
    "Use when looking for a strategy that fits specific criteria.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query (e.g., 'momentum', 'low risk', 'BTC')"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        tier: z.number(),
        riskLevel: z.string(),
        description: z.string(),
        tags: z.array(z.string()),
      })
    ),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ query }) => {
    try {
      const matches = playbookRegistry.search(query);

      return {
        results: matches.map((pb) => ({
          id: pb.id,
          name: pb.name,
          tier: pb.tier,
          riskLevel: pb.riskLevel,
          description:
            pb.description.length > 150
              ? pb.description.slice(0, 147) + "..."
              : pb.description,
          tags: pb.tags,
        })),
        count: matches.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("search_playbooks failed", { error: message });
      return { results: [], count: 0, error: message };
    }
  },
});

// ============================================================================
// Get Playbook for Agent Tool
// ============================================================================

export const getPlaybookForAgentTool = createTool({
  id: "get_playbook_for_agent",
  description:
    "Get the playbook prompt fragment tailored for a specific agent role. " +
    "Returns only the information relevant to that agent (e.g., trigger conditions for Scanner, management rules for Monitor).",
  inputSchema: z.object({
    playbookId: z
      .string()
      .describe("Playbook ID (kebab-case)"),
    agentRole: z
      .enum(["scanner", "analyst", "planner", "monitor", "teacher"])
      .describe("The agent role to generate the prompt fragment for"),
  }),
  outputSchema: z.object({
    playbookId: z.string().optional(),
    agentRole: z.string().optional(),
    prompt: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbookId, agentRole }) => {
    try {
      const pb = playbookRegistry.getOrThrow(playbookId);

      let prompt: string;
      switch (agentRole) {
        case "scanner":
          prompt = promptGenerator.generateForScanner(pb);
          break;
        case "analyst":
          prompt = promptGenerator.generateForAnalyst(pb);
          break;
        case "planner":
          prompt = promptGenerator.generateForPlanner(pb);
          break;
        case "monitor":
          prompt = promptGenerator.generateForMonitor(pb);
          break;
        case "teacher":
          prompt = promptGenerator.generateForTeacher(pb);
          break;
        default:
          return { error: `Unknown agent role: ${agentRole}` };
      }

      return {
        playbookId: pb.id,
        agentRole,
        prompt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_playbook_for_agent failed", {
        error: message,
        playbookId,
        agentRole,
      });
      return { error: message };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Playbook tools exported as an object for Mastra Agent.
 * This is the format expected by Mastra's Agent class.
 */
export const playbookTools = {
  list_playbooks: listPlaybooksTool,
  get_playbook: getPlaybookTool,
  search_playbooks: searchPlaybooksTool,
  get_playbook_for_agent: getPlaybookForAgentTool,
};
