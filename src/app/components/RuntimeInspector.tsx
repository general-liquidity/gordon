import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";
import { BlotterRow } from "./desk/BlotterRow.tsx";

interface RuntimeInspectorProps {
  inspector: RuntimeInspectorViewModel | null;
}

export function RuntimeInspector({ inspector }: RuntimeInspectorProps): React.ReactElement | null {
  if (!inspector || !inspector.hasContent) {
    return null;
  }

  const showToolingPanel =
    inspector.pluginCount > 0
    || inspector.mcpServerCount > 0
    || inspector.commandCount > 0
    || inspector.routingCount > 0;

  const showRecentFlow =
    inspector.recentHandoffs.length > 0
    || inspector.recentBridge.length > 0;

  return (
    <Box flexDirection="column" marginX={1} marginBottom={1}>
      <DeskPanel
        eyebrow="Operator Rail"
        title="Runtime Control"
        subtitle={`Stream ${inspector.streamStatus}${inspector.activeAgent ? ` via ${inspector.activeAgent}` : ""}`}
        tone="info"
      >
        <BlotterRow
          label="Thread"
          value={inspector.threadId ? `${inspector.threadId.slice(0, 16)}...` : "none"}
          detail={`Transcript ${inspector.transcriptEntryCount} · Compactions ${inspector.compactionCount}`}
          tone="info"
        />
        <BlotterRow
          label="Queue"
          value={`Background ${inspector.backgroundTaskCount} · Pending approvals ${inspector.pendingApprovalCount}`}
          detail={`Recent approvals ${inspector.recentApprovalCount} · Bridge ${inspector.activeBridgeSessions}`}
          tone="info"
        />
        <BlotterRow
          label="Runtime"
          value={`${inspector.remoteConnectionStatus}${inspector.remoteDetail ? ` · ${inspector.remoteDetail}` : ""}`}
          detail={`Scopes: ${inspector.permissionScopes.length > 0 ? inspector.permissionScopes.join(", ") : "none"}`}
          tone="operate"
        />
      </DeskPanel>
      {showToolingPanel && (
        <Box marginTop={1}>
          <DeskPanel
            eyebrow="Desk Tooling"
            title="Plugins, MCP, and Commands"
            subtitle={`Plugins ${inspector.pluginCount} · MCP ${inspector.mcpServerCount} · Tools ${inspector.registeredToolCount} · Commands ${inspector.commandCount}`}
            tone="brand"
            compact
          >
            <Text color={COLORS.DIM}>
              Routing {inspector.routingCount} · Hot reload {inspector.toolingHotReloadEnabled ? "on" : "off"}
              {inspector.toolingLastReloadAt ? ` · Reloaded ${inspector.toolingLastReloadAt}` : ""}
            </Text>
            {inspector.recentPlugins.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {inspector.recentPlugins.map((plugin) => (
                  <BlotterRow
                    key={plugin.id}
                    label={plugin.name}
                    value={`${plugin.status ?? "unknown"} · ${plugin.lifecycle ?? "mcp"}`}
                    detail={`${plugin.defaultAgent ? `${plugin.defaultAgent} · ` : ""}${plugin.reloadRecommended ? "reload suggested · " : ""}${plugin.integrationCommands && plugin.integrationCommands.length > 0 ? plugin.integrationCommands.join(", ") : "no surfaced commands"}`}
                    tone="brand"
                  />
                ))}
              </Box>
            )}
          </DeskPanel>
        </Box>
      )}

      {showRecentFlow && (
        <Box marginTop={1}>
          <DeskPanel
            eyebrow="Recent Flow"
            title="Desk Activity"
            subtitle="Latest runtime decisions and handoffs"
            tone="analysis"
            compact
          >
            {inspector.recentHandoffs.length > 0 && inspector.recentHandoffs.map((handoff) => (
              <BlotterRow
                key={handoff.id}
                label="Handoff"
                value={`${handoff.fromWorker} → ${handoff.toWorker}`}
                detail={handoff.reason}
                tone="analysis"
              />
            ))}
            {inspector.recentBridge.length > 0 && inspector.recentBridge.map((session) => (
              <BlotterRow
                key={session.id}
                label="Bridge"
                value={`${session.source} · ${session.commandType}`}
                detail={session.status}
                tone="operate"
              />
            ))}
          </DeskPanel>
        </Box>
      )}
    </Box>
  );
}

export default RuntimeInspector;
