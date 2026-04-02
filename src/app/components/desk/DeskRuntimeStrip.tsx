import React from "react";
import { Box } from "ink";

import type { RuntimeInspectorViewModel } from "../../presenters/RuntimePresenter.ts";
import { CockpitLines } from "../cockpit/CockpitLines.tsx";
import { BlotterRow } from "./BlotterRow.tsx";
import { DeskPanel } from "./DeskPanel.tsx";

export const DeskRuntimeStrip: React.FC<{
  inspector: RuntimeInspectorViewModel | null;
}> = ({ inspector }) => {
  if (!inspector || !inspector.hasContent) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <DeskPanel
        eyebrow="Desk Control"
        title={`Stream ${inspector.streamStatus}${inspector.activeAgent ? ` · ${inspector.activeAgent}` : ""}`}
        subtitle="Runtime, approvals, plugins, and bridge state stay adjacent to the live transcript."
        tone="info"
      >
        <BlotterRow
          label="Queue"
          value={`Approvals ${inspector.pendingApprovalCount} · Background ${inspector.backgroundTaskCount}`}
          detail={`Bridge ${inspector.activeBridgeSessions} · Transcript ${inspector.transcriptEntryCount}`}
          tone={inspector.pendingApprovalCount > 0 ? "warning" : "info"}
        />
        <BlotterRow
          label="Plugins"
          value={`${inspector.pluginCount} loaded · ${inspector.pluginAttentionCount} attention`}
          detail={`${inspector.routedPluginCount} routed · ${inspector.commandCount} commands`}
          tone={inspector.pluginAttentionCount > 0 ? "warning" : "brand"}
        />
        <BlotterRow
          label="Bridge"
          value={inspector.remoteConnectionStatus}
          detail={inspector.remoteDetail ?? "No live bridge ingress."}
          tone={inspector.activeBridgeSessions > 0 ? "operate" : "muted"}
        />
      </DeskPanel>
      {inspector.pendingApprovals.length > 0 ? (
        <CockpitLines
          eyebrow="Approval Desk"
          title={`${inspector.pendingApprovals.length} blocking approval${inspector.pendingApprovals.length === 1 ? "" : "s"}`}
          subtitle="Stage approve or deny directly from the command bar."
          tone="warning"
          lines={inspector.pendingApprovals.slice(0, 4).map((approval) => ({
            label: approval.toolName,
            value: approval.reason ?? "Approval required",
            detail: `${approval.permissionScope} · ${approval.riskClass} risk`,
            tone: "warning",
          }))}
        />
      ) : null}
    </Box>
  );
};
