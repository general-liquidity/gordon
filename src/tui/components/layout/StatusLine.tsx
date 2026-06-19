import React from "react";
import { Box, Text } from "../../ink-custom";
import { formatElapsed } from "../../hooks/animation/useElapsedTime.ts";
import { CostDisplay } from "../status/CostDisplay.tsx";
import { MemoryUsageIndicator } from "../notices/MemoryUsageIndicator.tsx";
import { TradingModeBadge } from "../status/TradingModeBadge.tsx";
import { KillSwitchBadge } from "../status/KillSwitchBadge.tsx";
import type { PermissionMode } from "../../state/types.ts";
import type { KillSwitchStatus } from "../../state/killSwitchStatus.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";
import { useStatusLineHook } from "../../hooks/useStatusLineHook.ts";

export function formatStatusTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export const StatusLine = React.memo(function StatusLine({
  memoryUsageRatio,
  liveContextTokens,
  lastTurnDurationMs,
  lastTurnTokens,
  autonomousActive,
  contextLimit,
  permissionMode,
  killSwitches,
}: {
  memoryUsageRatio: number;
  liveContextTokens: number;
  lastTurnDurationMs: number;
  lastTurnTokens: number;
  autonomousActive: boolean;
  contextLimit: number;
  permissionMode: PermissionMode;
  killSwitches: KillSwitchStatus | null;
}): React.ReactElement {
  const theme = useTheme();
  // Operator-defined status segment (GORDON_STATUS_LINE_COMMAND). Renders only
  // when set and the hook command produced safe output; otherwise null.
  const statusLineSegment = useStatusLineHook();
  // Brighter than faint `dimColor` (which renders too dark on most terminals):
  // a medium gray that reads as secondary but stays legible, matching Claude
  // Code's status row. `sep` is the same color for the `·` dividers.
  const muted = theme.uiMuted;
  return (
    <Box paddingX={2} marginY={1} justifyContent="space-between">
      <Box gap={1}>
        <Text color={memoryUsageRatio > 0.9 ? "red" : memoryUsageRatio > 0.7 ? "yellow" : muted}>
          {Math.round((1 - memoryUsageRatio) * 100)}% left
        </Text>
        {liveContextTokens > 0 && (
          <>
            <Text color={muted}>{"·"}</Text>
            <Text color={muted}>{formatStatusTokenCount(liveContextTokens)} ctx</Text>
          </>
        )}
        {lastTurnDurationMs > 0 && (
          <>
            <Text color={muted}>{"·"}</Text>
            <Text color={muted}>{formatElapsed(lastTurnDurationMs / 1000)}</Text>
            {lastTurnTokens > 0 && (
              <>
                <Text color={muted}>{"·"}</Text>
                <Text color={muted}>{formatStatusTokenCount(lastTurnTokens)} tok</Text>
              </>
            )}
          </>
        )}
        {autonomousActive && (
          <>
            <Text color={muted}>{"·"}</Text>
            <Text color={theme.variantAdvisor}>{"●"} autonomous</Text>
          </>
        )}
        {memoryUsageRatio > 0.7 && (
          <>
            <Text color={muted}>{"·"}</Text>
            <MemoryUsageIndicator usageRatio={memoryUsageRatio} tokenLimit={contextLimit} />
          </>
        )}
        {statusLineSegment && (
          <>
            <Text color={muted}>{"·"}</Text>
            <Text color={muted}>{statusLineSegment}</Text>
          </>
        )}
      </Box>
      <Box gap={1}>
        <TradingModeBadge mode={permissionMode} />
        <KillSwitchBadge status={killSwitches} />
        <CostDisplay />
        <Text color={muted}>{"·"} Ctrl+P {"·"} ? help</Text>
      </Box>
    </Box>
  );
});
