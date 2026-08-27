import type React from "react";
import { Text } from "../../ink-custom";

// ============================================================================
// CompactionPanel — compact status display for conversation compaction state
//
// No compaction fields exist on RuntimeSessionState (checked runtime.ts,
// SessionState.ts, and contracts/types.ts). The runtime surfaces session,
// stream, background, tooling, remote, approvals, and bridge slices only.
// Compaction tracking lives in ConversationBudget (infra/context) which is
// not wired into the runtime state store.
//
// This component therefore accepts optional props for embedding in a status
// bar or overlay, falling back gracefully when no data is provided.
// ============================================================================

interface Props {
  contextUsageRatio?: number; // 0-1
  compactionCount?: number;
}

export function CompactionPanel({ contextUsageRatio, compactionCount }: Props) {
  if (contextUsageRatio == null && compactionCount == null) return null;

  const usagePct = contextUsageRatio != null ? Math.round(contextUsageRatio * 100) : null;
  const isHigh = usagePct != null && usagePct > 70;

  const parts: React.ReactNode[] = [];

  if (usagePct != null) {
    parts.push(
      <Text key="label-ctx">context </Text>,
      isHigh ? (
        <Text key="pct" color="yellow">
          {usagePct}%
        </Text>
      ) : (
        <Text key="pct">{usagePct}%</Text>
      ),
    );
  }

  if (compactionCount != null) {
    if (parts.length > 0) {
      parts.push(<Text key="sep"> · </Text>);
    }
    parts.push(<Text key="compacted">compacted {compactionCount}×</Text>);
  }

  return <Text dimColor>{parts}</Text>;
}
