import type { SessionRuntime } from "../../runtime/index.ts";
import type { RuntimeApprovalRequest, RuntimeBridgeSession, RuntimeTranscriptEntry } from "../../runtime/contracts/types.ts";
import type { RuntimeSessionState } from "../../runtime/state/SessionState.ts";
import type { HandoffArtifact, WorkerScratchpadEntry } from "../../runtime/workers/HandoffArtifact.ts";

export interface RuntimeInspectorViewModel {
  sessionId?: string;
  resourceId?: string;
  threadId?: string;
  streamStatus: RuntimeSessionState["stream"]["status"];
  activeAgent?: string;
  permissionScopes: string[];
  backgroundTaskCount: number;
  pendingApprovalCount: number;
  recentApprovalCount: number;
  pluginCount: number;
  mcpServerCount: number;
  registeredToolCount: number;
  commandCount: number;
  remoteConnectionStatus: RuntimeSessionState["remote"]["connectionStatus"];
  remoteReachable: boolean;
  remoteDetail?: string;
  activeBridgeSessions: number;
  recentBridge: RuntimeBridgeSession[];
  transcriptEntryCount: number;
  compactionCount: number;
  recentTranscript: RuntimeTranscriptEntry[];
  recentApprovals: RuntimeApprovalRequest[];
  recentScratchpad: WorkerScratchpadEntry[];
  recentHandoffs: HandoffArtifact[];
  hasContent: boolean;
  lastUpdatedAt: string;
}

export function createRuntimeInspectorViewModel(
  runtime: SessionRuntime,
  options: { maxItems?: number } = {},
): RuntimeInspectorViewModel {
  const maxItems = options.maxItems ?? 4;
  const state = runtime.getState();
  const transcript = runtime.getTranscript();
  const scratchpad = runtime.getScratchpadEntries();
  const handoffs = runtime.getHandoffArtifacts();

  return {
    sessionId: state.session.sessionId,
    resourceId: state.session.resourceId ?? state.session.snapshot?.resourceId,
    threadId: state.session.threadId ?? state.session.snapshot?.threadId ?? undefined,
    streamStatus: state.stream.status,
    activeAgent: state.stream.activeAgent,
    permissionScopes: state.permissionScopes,
    backgroundTaskCount: state.background.tasks.length,
    pendingApprovalCount: state.approvals.pending.length,
    recentApprovalCount: state.approvals.recent.length,
    pluginCount: state.tooling.plugins.length,
    mcpServerCount: state.tooling.mcpServers.length,
    registeredToolCount: runtime.getRegisteredTools().length,
    commandCount: state.tooling.commands.length,
    remoteConnectionStatus: state.remote.connectionStatus,
    remoteReachable: state.remote.reachable,
    remoteDetail: state.remote.detail,
    activeBridgeSessions: state.bridge.active.length,
    recentBridge: state.bridge.recent.slice(0, maxItems),
    transcriptEntryCount: transcript.length,
    compactionCount: runtime.getTranscriptStore().getCompactionCount(),
    recentTranscript: transcript.slice(-maxItems),
    recentApprovals: state.approvals.recent.slice(0, maxItems),
    recentScratchpad: scratchpad.slice(-maxItems),
    recentHandoffs: handoffs.slice(-maxItems),
    hasContent:
      transcript.length > 0
      || scratchpad.length > 0
      || handoffs.length > 0
      || state.approvals.pending.length > 0
      || state.approvals.recent.length > 0
      || state.tooling.plugins.length > 0
      || state.tooling.mcpServers.length > 0
      || state.bridge.active.length > 0
      || state.remote.connectionStatus !== "offline",
    lastUpdatedAt: state.lastUpdatedAt,
  };
}

export function formatRuntimeInspectorSummary(viewModel: RuntimeInspectorViewModel): string {
  const lines: string[] = [
    "**Runtime State**",
    "",
    `Stream: ${viewModel.streamStatus}${viewModel.activeAgent ? ` via ${viewModel.activeAgent}` : ""}`,
    `Thread: ${viewModel.threadId ?? "none"}`,
    `Resource: ${viewModel.resourceId ?? "none"}`,
    `Transcript entries: ${viewModel.transcriptEntryCount}`,
    `Compactions: ${viewModel.compactionCount}`,
    `Background tasks: ${viewModel.backgroundTaskCount}`,
    `Pending approvals: ${viewModel.pendingApprovalCount} · Recent approvals: ${viewModel.recentApprovalCount}`,
    `Plugins: ${viewModel.pluginCount} · MCP servers: ${viewModel.mcpServerCount} · Tools: ${viewModel.registeredToolCount} · Commands: ${viewModel.commandCount}`,
    `Remote runtime: ${viewModel.remoteConnectionStatus}${viewModel.remoteDetail ? ` (${viewModel.remoteDetail})` : ""} · Bridge sessions: ${viewModel.activeBridgeSessions}`,
    `Permission scopes: ${viewModel.permissionScopes.length > 0 ? viewModel.permissionScopes.join(", ") : "none"}`,
  ];

  if (viewModel.recentApprovals.length > 0) {
    lines.push("", "**Recent approvals**");
    for (const approval of viewModel.recentApprovals) {
      lines.push(`- ${approval.status} · ${approval.toolName}${approval.actor ? ` · ${approval.actor}` : ""}`);
    }
  }

  if (viewModel.recentBridge.length > 0) {
    lines.push("", "**Recent bridge activity**");
    for (const session of viewModel.recentBridge) {
      lines.push(`- ${session.source} · ${session.commandType} · ${session.status}`);
    }
  }

  if (viewModel.recentHandoffs.length > 0) {
    lines.push("", "**Recent handoffs**");
    for (const handoff of viewModel.recentHandoffs) {
      lines.push(`- ${handoff.fromWorker} -> ${handoff.toWorker}: ${handoff.reason}`);
    }
  }

  if (viewModel.recentScratchpad.length > 0) {
    lines.push("", "**Recent scratchpad**");
    for (const entry of viewModel.recentScratchpad) {
      lines.push(`- ${entry.worker} [${entry.kind}]: ${entry.content}`);
    }
  }

  return lines.join("\n");
}
