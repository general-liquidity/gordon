/**
 * Agent-list wiring — produces a system-message attachment listing
 * available subagents, ready to splice into the orchestrator's prompt
 * before the user turn.
 *
 * Activation: `GORDON_AGENT_LIST_ATTACHMENT` env flag. When unset
 * the helper returns `null` so callers can `if (attachment)` it in
 * cleanly without changing prompt shape.
 *
 * Source of truth: caller supplies the entries. Gordon's hardcoded
 * 3-agent surface (gordon/executor/researcher) is captured in
 * `GORDON_BUILTIN_AGENTS` for convenience.
 */

import {
  buildAgentListAttachment,
  shouldRefreshAgentList,
  type AgentListAttachment,
  type AgentListEntry,
} from "../agentListAttachment.ts";

const FLAG_ENV = "GORDON_AGENT_LIST_ATTACHMENT";

export const GORDON_BUILTIN_AGENTS: ReadonlyArray<AgentListEntry> = [
  {
    id: "executor",
    description: "Trade execution + plan-approval flow",
    tags: ["trading", "execution"],
  },
  {
    id: "researcher",
    description: "Market scans, news / sentiment, regime analysis",
    tags: ["research", "analysis"],
  },
];

export function isAgentListAttachmentEnabled(): boolean {
  return process.env[FLAG_ENV] === "1";
}

/**
 * Build the attachment, or return null when disabled. Caller checks
 * `previousFingerprint` to decide whether to actually inject — when
 * the surface hasn't changed since the last turn, the attachment can
 * be skipped to preserve prompt cache.
 */
export function buildIfEnabled(
  entries: ReadonlyArray<AgentListEntry> = GORDON_BUILTIN_AGENTS,
): AgentListAttachment | null {
  if (!isAgentListAttachmentEnabled()) return null;
  return buildAgentListAttachment([...entries]);
}

export { shouldRefreshAgentList };
