/**
 * Peer delegation tool — Gordon → external CLI agent.
 *
 * Exposes the `delegate_to_peer` tool used by the `/delegate <peer> <prompt>`
 * slash command. Wraps the CliSubprocessPeer abstraction so the agent
 * sees a clean tool surface.
 *
 * OPERATOR-DRIVEN ONLY. The executor agent's system prompt intentionally
 * does NOT instruct Gordon to autonomously delegate work to peers. The
 * operator invokes this via `/delegate` (or, less commonly, by an
 * explicit "use Cursor to ..." instruction in their message). Cold
 * autonomous delegation is the cold-prompt-engineering trap the
 * book-port-wave-pattern memory warns against.
 *
 * Composes with the existing safety stack:
 *   - withToolsMetrics wraps execution → metrics + result-sanitizer
 *   - withResultSanitizer strips injection patterns from peer stdout
 *     before it re-enters Gordon's context
 *   - GORDON_PEER_DELEGATION=0 disables the tool entirely
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  getPeer,
  isPeerDelegationEnabled,
  listPeers,
  peerResultToPayload,
} from "../../peers/index.ts";
import { recordStructuredObservation } from "../../../platform/observability/index.ts";
import { validateToolOutput } from "../types.ts";

const delegateToPeerOutputSchema = z.object({
  success: z.boolean(),
  peer: z.string().optional(),
  output: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
});

export const delegateToPeerTool = createTool({
  id: "delegate_to_peer",
  description:
    "OPERATOR-DRIVEN ONLY. Delegate a task to an external CLI agent. Use ONLY when " +
    "the operator explicitly invokes /delegate or explicitly tells you to use a specific " +
    "peer (e.g. 'use Cursor to refactor ...'). Never autonomously decide to delegate. " +
    "Currently registered peers: cursor (local code editing via cursor-agent), " +
    "warp (cloud-runner via oz agent run). The peer's full prompt-driven LLM loop " +
    "runs in its own process; output is returned to Gordon's context for review.",
  inputSchema: z.object({
    peer: z
      .string()
      .describe("Peer agent ID. Currently 'cursor' or 'warp'. See /delegate for list."),
    prompt: z
      .string()
      .min(5, { message: "prompt must be at least 5 characters" })
      .describe(
        "The task description handed to the peer. The peer interprets this in its own context.",
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(30 * 60 * 1000)
      .optional()
      .describe("Override timeout in ms (max 30 min). Default from peer config."),
  }),
  outputSchema: delegateToPeerOutputSchema,
  execute: async ({ peer, prompt, timeoutMs }) => {
    if (!isPeerDelegationEnabled()) {
      return validateToolOutput(
        delegateToPeerOutputSchema,
        {
          success: false,
          error: "Peer delegation disabled. Set GORDON_PEER_DELEGATION=1 to enable.",
        },
        { toolName: "delegate_to_peer" },
      );
    }

    const target = getPeer(peer);
    if (!target) {
      const available = listPeers()
        .map((p) => p.id)
        .join(", ");
      return validateToolOutput(
        delegateToPeerOutputSchema,
        {
          success: false,
          error: `Unknown peer '${peer}'. Available: ${available}`,
        },
        { toolName: "delegate_to_peer" },
      );
    }

    recordStructuredObservation({
      eventType: "peer_delegation.dispatch",
      workflow: "delegation",
      source: "agent_tool",
      component: "delegate_to_peer",
      toolName: "delegate_to_peer",
      outcome: "info",
      details: { peer: target.id, promptLength: prompt.length, timeoutMs },
    });

    const result = await target.delegate(prompt, { timeoutMs });

    recordStructuredObservation({
      eventType: result.success ? "peer_delegation.completed" : "peer_delegation.failed",
      workflow: "delegation",
      source: "agent_tool",
      component: "delegate_to_peer",
      toolName: "delegate_to_peer",
      outcome: result.success ? "success" : "failure",
      details: peerResultToPayload(result),
    });

    return validateToolOutput(
      delegateToPeerOutputSchema,
      {
        success: result.success,
        peer: target.id,
        output: result.output,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        error: result.error,
      },
      { toolName: "delegate_to_peer" },
    );
  },
});

export const peerTools = {
  delegate_to_peer: delegateToPeerTool,
};
