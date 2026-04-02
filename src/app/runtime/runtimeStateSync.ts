import type { SessionInfo } from "../../infra/storage/session.ts";
import type { RuntimeSessionState } from "../../runtime/state/SessionState.ts";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";

export function buildRuntimeLinkedSession(
  previous: SessionInfo | null,
  runtimeState: RuntimeSessionState,
): SessionInfo | null {
  const snapshot = runtimeState.session.snapshot;
  if (!snapshot?.threadId) {
    return previous;
  }

  return {
    resourceId: runtimeState.session.resourceId ?? snapshot.resourceId,
    threadId: runtimeState.session.threadId ?? snapshot.threadId,
    isNewSession: false,
    previousThreadId: previous?.previousThreadId ?? null,
  };
}

export function buildRuntimeActivityStatus(
  previousActivityStatus: string | null,
  wasStreaming: boolean,
  runtimeState: RuntimeSessionState,
): string | null {
  const nextIsStreaming = runtimeState.stream.status === "running";
  if (nextIsStreaming) {
    return runtimeState.stream.activeAgent
      ? `Working via ${runtimeState.stream.activeAgent}...`
      : previousActivityStatus ?? "Preparing response...";
  }

  return wasStreaming ? null : previousActivityStatus;
}

export function shouldRefreshRuntimeInspector(
  previous: RuntimeInspectorViewModel | null,
  next: RuntimeInspectorViewModel,
): boolean {
  return (
    previous?.lastUpdatedAt !== next.lastUpdatedAt
    || previous?.transcriptEntryCount !== next.transcriptEntryCount
    || previous?.recentHandoffs.length !== next.recentHandoffs.length
    || previous?.recentScratchpad.length !== next.recentScratchpad.length
    || previous?.streamStatus !== next.streamStatus
    || previous?.pluginCount !== next.pluginCount
    || previous?.mcpServerCount !== next.mcpServerCount
    || previous?.registeredToolCount !== next.registeredToolCount
    || previous?.remoteConnectionStatus !== next.remoteConnectionStatus
    || previous?.pendingApprovalCount !== next.pendingApprovalCount
    || previous?.recentApprovalCount !== next.recentApprovalCount
    || previous?.approvalRuleCount !== next.approvalRuleCount
    || previous?.pluginAttentionCount !== next.pluginAttentionCount
    || previous?.activeBridgeSessions !== next.activeBridgeSessions
  );
}
