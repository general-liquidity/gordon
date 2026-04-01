import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";

interface RuntimeInspectorProps {
  inspector: RuntimeInspectorViewModel | null;
}

export function RuntimeInspector({ inspector }: RuntimeInspectorProps): React.ReactElement | null {
  if (!inspector || !inspector.hasContent) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLORS.CYAN}
      marginX={2}
      marginBottom={1}
      paddingX={1}
    >
      <Text color={COLORS.CYAN}>Runtime Inspector</Text>
      <Text color={COLORS.DIM}>
        Stream {inspector.streamStatus}
        {inspector.activeAgent ? ` via ${inspector.activeAgent}` : ""}
        {inspector.threadId ? ` · ${inspector.threadId.slice(0, 16)}...` : ""}
      </Text>
      <Text color={COLORS.DIM}>
        Transcript {inspector.transcriptEntryCount} · Compactions {inspector.compactionCount} · Background {inspector.backgroundTaskCount}
      </Text>
      <Text color={COLORS.DIM}>
        Pending approvals {inspector.pendingApprovalCount} · Recent approvals {inspector.recentApprovalCount}
      </Text>
      <Text color={COLORS.DIM}>
        Plugins {inspector.pluginCount} · MCP {inspector.mcpServerCount} · Tools {inspector.registeredToolCount} · Commands {inspector.commandCount}
      </Text>
      <Text color={COLORS.DIM}>
        Remote {inspector.remoteConnectionStatus}
        {inspector.remoteDetail ? ` · ${inspector.remoteDetail}` : ""}
        {` · Bridge ${inspector.activeBridgeSessions}`}
      </Text>
      <Text color={COLORS.DIM}>
        Scopes: {inspector.permissionScopes.length > 0 ? inspector.permissionScopes.join(", ") : "none"}
      </Text>

      {inspector.recentHandoffs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.TAN}>Recent handoffs</Text>
          {inspector.recentHandoffs.map((handoff) => (
            <Text key={handoff.id} color={COLORS.DIM}>
              - {handoff.fromWorker} → {handoff.toWorker}: {handoff.reason}
            </Text>
          ))}
        </Box>
      )}

      {inspector.recentApprovals.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.CYAN}>Recent approvals</Text>
          {inspector.recentApprovals.map((approval) => (
            <Text key={approval.id} color={COLORS.DIM}>
              - {approval.status} · {approval.toolName}{approval.actor ? ` · ${approval.actor}` : ""}
            </Text>
          ))}
        </Box>
      )}

      {inspector.recentBridge.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.HIGHLIGHT}>Recent bridge</Text>
          {inspector.recentBridge.map((session) => (
            <Text key={session.id} color={COLORS.DIM}>
              - {session.source} · {session.commandType} · {session.status}
            </Text>
          ))}
        </Box>
      )}

      {inspector.recentScratchpad.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.HIGHLIGHT}>Recent scratchpad</Text>
          {inspector.recentScratchpad.map((entry) => (
            <Text key={entry.id} color={COLORS.DIM}>
              - {entry.worker} [{entry.kind}]: {entry.content}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default RuntimeInspector;
