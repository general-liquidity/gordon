import React from "react";
import { Box, Text, useInput } from "ink";
import { GordonSelect as Select } from "../design-system/GordonSelect.js";
import { Pane } from "../design-system/Pane.js";

// ============================================================================
// AutonomousControlDialog — Start/stop/pause/configure autonomous trading loop
//
// Shows current status, cycle count, opportunities found, mandate info.
// Actions: start, pause, resume, stop, configure interval.
// ============================================================================

interface Props {
  isActive: boolean;
  isPaused: boolean;
  cycleCount: number;
  opportunitiesFound: number;
  mandateId?: string;
  intervalMinutes: number;
  onAction: (action: "start" | "stop" | "pause" | "resume") => void;
  onClose: () => void;
}

export function AutonomousControlDialog({
  isActive,
  isPaused,
  cycleCount,
  opportunitiesFound,
  mandateId,
  intervalMinutes,
  onAction,
  onClose,
}: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const statusColor = isActive ? (isPaused ? "yellow" : "green") : "gray";
  const statusLabel = isActive ? (isPaused ? "PAUSED" : "RUNNING") : "STOPPED";
  const statusIcon = isActive ? (isPaused ? "\u25C8" : "\u25CF") : "\u25CB";

  const actions = isActive
    ? isPaused
      ? [
          { label: "Resume loop", value: "resume" },
          { label: "Stop loop", value: "stop" },
        ]
      : [
          { label: "Pause loop", value: "pause" },
          { label: "Stop loop", value: "stop" },
        ]
    : [
        { label: "Start autonomous loop", value: "start" },
      ];

  return (
    <Pane title="AUTONOMOUS TRADING" color={statusColor}>
      {/* Status */}
      <Box>
        <Text color={statusColor} bold>{statusIcon} {statusLabel}</Text>
        {mandateId && <Text dimColor> {"\u00b7"} mandate {mandateId}</Text>}
      </Box>

      {/* Stats */}
      {isActive && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor>Cycles:        </Text>
            <Text>{cycleCount}</Text>
          </Box>
          <Box>
            <Text dimColor>Opportunities: </Text>
            <Text color={opportunitiesFound > 0 ? "green" : undefined}>{opportunitiesFound}</Text>
          </Box>
          <Box>
            <Text dimColor>Interval:      </Text>
            <Text>every {intervalMinutes}m</Text>
          </Box>
        </Box>
      )}

      {/* Actions */}
      <Text> </Text>
      <Select
        options={actions}
        onChange={(value) => {
          onAction(value as "start" | "stop" | "pause" | "resume");
          onClose();
        }}
      />

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
