import type { SessionRuntime } from "../../runtime/index.ts";
import { getRuntimeApprovalShortId } from "../runtime/runtimeApprovalId.ts";
import {
  createRuntimeInspectorViewModel,
  formatRuntimeInspectorSummary,
} from "../presenters/RuntimePresenter.ts";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function formatRuntimeSessionInfo(runtime: SessionRuntime): Promise<string> {
  const session = await runtime.getCurrentSession();
  const inspector = createRuntimeInspectorViewModel(runtime);
  const sessionAge = session.threadStartedAt
    ? Math.round((Date.now() - new Date(session.threadStartedAt).getTime()) / 1000 / 60)
    : 0;

  return [
    "**Current Session Info**",
    "",
    `- **Thread ID:** \`${session.threadId?.slice(0, 25) || "None"}...\``,
    `- **Resource ID:** \`${session.resourceId}\``,
    `- **Session Started:** ${session.threadStartedAt ? new Date(session.threadStartedAt).toLocaleString() : "N/A"}`,
    `- **Session Age:** ${sessionAge} minutes`,
    `- **Total Sessions:** ${session.sessionCount}`,
    `- **Transcript Entries:** ${inspector.transcriptEntryCount}`,
    `- **Handoffs:** ${inspector.recentHandoffs.length}`,
    `- **Scratchpad Entries:** ${runtime.getScratchpadEntries().length}`,
    `- **Pending Approvals:** ${runtime.getPendingApprovals().length}`,
    `- **Registered Tools:** ${inspector.registeredToolCount}`,
    `- **Runtime Commands:** ${inspector.commandCount}`,
    `- **Plugins / MCP Servers:** ${inspector.pluginCount} / ${inspector.mcpServerCount}`,
    `- **Remote Runtime:** ${inspector.remoteConnectionStatus}${inspector.remoteDetail ? ` (${inspector.remoteDetail})` : ""}`,
    `- **Bridge Sessions:** ${inspector.activeBridgeSessions}`,
    "",
    "Use `/resume` to continue a previous session or `/new-session` to start fresh.",
  ].join("\n");
}

export function formatRuntimeState(runtime: SessionRuntime): string {
  return formatRuntimeInspectorSummary(createRuntimeInspectorViewModel(runtime));
}

export function formatRuntimePlugins(runtime: SessionRuntime): string {
  const inspector = createRuntimeInspectorViewModel(runtime, { maxItems: 12 });
  const tooling = runtime.getState().tooling;

  if (tooling.plugins.length === 0 && tooling.mcpServers.length === 0) {
    return "No runtime plugins or MCP servers are currently active.";
  }

  const lines = [
    "**Runtime Plugins**",
    "",
    `- Last sync: ${tooling.lastSyncedAt ?? "never"}`,
    `- Last reload: ${tooling.lastReloadAt ?? "never"}`,
    `- Hot reload: ${tooling.hotReloadEnabled ? "enabled" : "disabled"}`,
    `- Routing configs: ${tooling.routingCount}`,
    `- Plugin attention: ${inspector.pluginAttentionCount}`,
    `- Commands surfaced: ${tooling.commands.length > 0 ? tooling.commands.join(", ") : "none"}`,
  ];

  if (inspector.recentPlugins.length > 0) {
    lines.push("", "**Plugin inventory**");
    for (const plugin of inspector.recentPlugins) {
      lines.push(
        `- ${plugin.name} · ${plugin.status ?? "unknown"} · ${plugin.lifecycle ?? "mcp"} · tools=${plugin.toolCount ?? 0} · commands=${plugin.commandCount ?? 0}${plugin.defaultAgent ? ` · default=${plugin.defaultAgent}` : ""}${plugin.attentionReasons && plugin.attentionReasons.length > 0 ? ` · ${plugin.attentionReasons.join(", ")}` : ""}${plugin.reloadRecommended ? " · reload suggested" : ""}${plugin.integrationCommands && plugin.integrationCommands.length > 0 ? ` · ${plugin.integrationCommands.join(", ")}` : ""}`,
      );
    }
  }

  if (tooling.mcpServers.length > 0) {
    lines.push("", "**MCP servers**");
    for (const server of tooling.mcpServers.slice(0, 12)) {
      lines.push(`- ${server.name} · ${server.category} · tools=${server.toolCount ?? "unknown"}`);
    }
  }

  return lines.join("\n");
}

export function formatRuntimeTranscript(runtime: SessionRuntime, args: string): string {
  const [limitToken] = args.split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(parsePositiveInt(limitToken, 12), 40));
  const entries = runtime.getTranscript().slice(-limit);

  if (entries.length === 0) {
    return "Runtime transcript is empty for this session.";
  }

  return [
    `**Runtime Transcript** (last ${entries.length})`,
    "",
    ...entries.map((entry) => `- [${entry.timestamp}] ${entry.role}: ${entry.content}`),
  ].join("\n");
}

export function formatRuntimeScratchpad(runtime: SessionRuntime, args: string): string {
  const worker = args.trim() || undefined;
  const entries = runtime.getScratchpadEntries(worker);

  if (entries.length === 0) {
    return worker
      ? `No scratchpad entries recorded for ${worker}.`
      : "No runtime scratchpad entries recorded yet.";
  }

  return [
    worker ? `**Runtime Scratchpad: ${worker}**` : "**Runtime Scratchpad**",
    "",
    ...entries
      .slice(-12)
      .map((entry) => `- [${entry.timestamp}] ${entry.worker} [${entry.kind}]: ${entry.content}`),
  ].join("\n");
}

export function formatRuntimeHandoffs(runtime: SessionRuntime): string {
  const handoffs = runtime.getHandoffArtifacts();

  if (handoffs.length === 0) {
    return "No worker handoffs recorded for this session yet.";
  }

  return [
    "**Runtime Handoffs**",
    "",
    ...handoffs
      .slice(-12)
      .map(
        (handoff) =>
          `- [${handoff.timestamp}] ${handoff.fromWorker} -> ${handoff.toWorker}: ${handoff.reason}`,
      ),
  ].join("\n");
}

export function formatRuntimeApprovals(runtime: SessionRuntime): string {
  const pending = runtime.getPendingApprovals();
  const recent = runtime.getRecentApprovals(8);

  if (pending.length === 0 && recent.length === 0) {
    return "No runtime approval activity recorded yet.";
  }

  const lines = ["**Runtime Approvals**", ""];
  if (pending.length > 0) {
    lines.push("Pending:");
    for (const request of pending.slice(0, 12)) {
      const shortId = getRuntimeApprovalShortId(request.id);
      lines.push(
        `- ${shortId} · ${request.toolName} · ${request.approvalClass} · ${request.reason ?? "approval required"}`,
      );
      lines.push(`  Approve: /runtime-approve ${shortId} or approve ${shortId}`);
      lines.push(`  Approve + persist: /runtime-approve ${shortId} persist`);
      lines.push(`  Deny: /runtime-deny ${shortId} reason or deny ${shortId} reason`);
      lines.push(`  Deny + persist: /runtime-deny ${shortId} persist reason`);
    }
  }

  if (recent.length > 0) {
    lines.push("", "Recent:");
    for (const request of recent) {
      lines.push(
        `- ${request.status.toUpperCase()} · ${getRuntimeApprovalShortId(request.id)} · ${request.toolName}${request.actor ? ` · ${request.actor}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export function applyRuntimeApprovalDecision(
  runtime: SessionRuntime,
  args: string,
  decision: "approve" | "deny",
): string {
  const tokens = args.split(/\s+/).filter(Boolean);
  const requestId = tokens[0];
  if (!requestId) {
    return decision === "approve"
      ? "Usage: /runtime-approve <request-id> [persist]"
      : "Usage: /runtime-deny <request-id> [persist] [reason]";
  }

  const persist = tokens.some((token) => token.toLowerCase() === "persist");
  const reason =
    decision === "deny"
      ? tokens
          .filter((token) => token.toLowerCase() !== "persist")
          .slice(1)
          .join(" ")
          .trim() || undefined
      : undefined;

  const result =
    decision === "approve"
      ? runtime.approvePendingRequest(requestId, {
          actor: "operator",
          persist,
          scope: persist ? "persistent" : "session",
        })
      : runtime.denyPendingRequest(requestId, {
          actor: "operator",
          persist,
          scope: persist ? "persistent" : "session",
          reason,
        });

  if (!result) {
    return `Approval request ${requestId} was not found.`;
  }

  return [
    `**Runtime Approval ${decision === "approve" ? "Approved" : "Denied"}**`,
    "",
    `- Request: ${result.id}`,
    `- Short ID: ${getRuntimeApprovalShortId(result.id)}`,
    `- Tool: ${result.toolName}`,
    `- Scope: ${persist ? "persistent" : "session"}`,
    `- Status: ${result.status}`,
    result.reason ? `- Reason: ${result.reason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRuntimeBridge(runtime: SessionRuntime): string {
  const bridge = runtime.getBridgeSessions();
  if (bridge.active.length === 0 && bridge.recent.length === 0) {
    return "No runtime bridge ingress recorded yet.";
  }

  const lines = ["**Runtime Bridge**", ""];
  if (bridge.active.length > 0) {
    lines.push("Active:");
    for (const session of bridge.active.slice(0, 8)) {
      lines.push(`- ${session.source} · ${session.commandType} · ${session.status}`);
    }
  }

  if (bridge.recent.length > 0) {
    lines.push("", "Recent:");
    for (const session of bridge.recent.slice(0, 8)) {
      lines.push(
        `- ${session.source} · ${session.commandType} · ${session.status}${session.detail ? ` · ${session.detail}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatRuntimeHistory(runtime: SessionRuntime, args: string): string {
  const tokens = args.split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(parsePositiveInt(tokens[tokens.length - 1], 8), 30));
  const query = tokens.length > 1 ? tokens.slice(0, -1).join(" ") : (tokens[0] ?? "");

  if (query) {
    const results = runtime.searchHistory(query, { limit });
    if (results.length === 0) {
      return `No runtime history matches found for "${query}".`;
    }

    return [
      `**Runtime History Search**: ${query}`,
      "",
      ...results.map(
        (result) =>
          `- [${result.timestamp}] ${result.source}${result.worker ? `:${result.worker}` : ""} · ${result.content}`,
      ),
    ].join("\n");
  }

  const sessions = runtime.listRecentHistory(limit);
  if (sessions.length === 0) {
    return "No persisted runtime sessions found.";
  }

  return [
    "**Persisted Runtime Sessions**",
    "",
    ...sessions.map(
      (session) =>
        `- ${session.runtimeId} · ${session.savedAt} · thread=${session.threadId ?? "none"} · transcript=${session.transcriptEntryCount}`,
    ),
  ].join("\n");
}

export function compactRuntimeTranscript(runtime: SessionRuntime, args: string): string {
  const tokens = args.split(/\s+/).filter(Boolean);
  const maxEntries = Math.max(10, Math.min(parsePositiveInt(tokens[0], 80), 200));
  const before = runtime.getTranscript().length;
  const compacted = runtime.compactTranscript(maxEntries);
  const after = compacted.length;

  return [
    "**Runtime Transcript Compacted**",
    "",
    `Before: ${before} entries`,
    `After: ${after} entries`,
    `Target max entries: ${maxEntries}`,
    "",
    "Use `/runtime-transcript` to inspect the updated runtime transcript.",
  ].join("\n");
}
