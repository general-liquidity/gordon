import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { getRiskColor, type RiskLevel } from "../../design-system/colorMap.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";

/**
 * ApprovalBrowser — Interactive approval manager
 *
 * Lists pending approvals. User can select one to approve/deny inline
 * instead of typing "approve <id>" or "deny <id>" manually.
 */

interface ApprovalItem {
  id: string;
  shortId: string;
  toolName: string;
  riskLevel: "standard" | "high" | "critical";
  summary: string;
  timestamp: string;
}

interface Props {
  pending: ApprovalItem[];
  recent: Array<ApprovalItem & { decision: "approved" | "denied"; decidedAt: string }>;
  onApprove: (id: string, persist: boolean) => void;
  onDeny: (id: string, reason?: string) => void;
  onCancel: () => void;
}

export function ApprovalBrowser({ pending, recent, onApprove, onDeny, onCancel }: Props) {
  const [view, setView] = useState<"pending" | "recent">("pending");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const theme = useTheme();

  const items = view === "pending" ? pending : recent;

  useInput((_input, key) => {
    if (key.escape) {
      if (decidingId) setDecidingId(null);
      else onCancel();
    }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(items.length - 1, i + 1));
    if (key.return && view === "pending" && !decidingId) {
      const item = pending[selectedIdx];
      if (item) setDecidingId(item.id);
    }
    if (key.tab) {
      setView((v) => v === "pending" ? "recent" : "pending");
      setSelectedIdx(0);
    }
  });

  const riskTone = (level: ApprovalItem["riskLevel"]) => (
    getRiskColor(level === "standard" ? "low" : level as RiskLevel, theme)
  );

  if (decidingId) {
    const item = pending.find((p) => p.id === decidingId);
    if (!item) { setDecidingId(null); return null; }
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color={theme.uiBrand}>DECIDE: {item.toolName}</Text>
        <Text dimColor>{item.summary}</Text>
        <Text>Risk: <Text color={riskTone(item.riskLevel)}>{item.riskLevel}</Text></Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: "Approve (this time)", value: "approve-once" },
              { label: "Always approve this tool", value: "approve-persist" },
              { label: "Deny", value: "deny" },
            ]}
            onChange={(v) => {
              if (v === "approve-once") onApprove(item.id, false);
              else if (v === "approve-persist") onApprove(item.id, true);
              else onDeny(item.id);
              setDecidingId(null);
            }}
          />
        </Box>
        <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.uiBrand}>APPROVALS</Text>
        <Text dimColor>  ({pending.length} pending)</Text>
      </Box>

      <Box>
        <Text color={view === "pending" ? theme.uiBrand : undefined} dimColor={view !== "pending"}> pending </Text>
        <Text color={view === "recent" ? theme.uiBrand : undefined} dimColor={view !== "recent"}> recent </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {items.length === 0 && <Text dimColor>  No {view} approvals.</Text>}
        {items.slice(0, 15).map((item, i) => {
          const isFocused = i === selectedIdx;
          return (
            <Box key={item.id}>
              <Text color={isFocused ? theme.uiBrand : undefined}>{isFocused ? " \u25B8" : "  "}</Text>
              <Text color={riskTone(item.riskLevel)}> [{item.riskLevel[0]!.toUpperCase()}] </Text>
              <Text bold={isFocused}>{item.toolName.padEnd(20)}</Text>
              <Text dimColor={!isFocused} wrap="truncate-end">{item.summary}</Text>
              {"decision" in item && <Text color={(item as any).decision === "approved" ? theme.riskSafe : theme.riskDanger}> {(item as any).decision}</Text>}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} navigate {"\u00B7"} Tab {view === "pending" ? "recent" : "pending"} {"\u00B7"} {view === "pending" ? "Enter decide" : ""} {"\u00B7"} Esc close</Text>
      </Box>
    </Box>
  );
}
