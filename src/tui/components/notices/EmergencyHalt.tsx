/**
 * EmergencyHalt — Critical action dialog to close all positions
 *
 * Red bordered dialog: "EMERGENCY HALT - Close all positions and cancel
 * all orders?" with a 3-second countdown before confirm becomes active.
 * Calls runtime methods to close/cancel when confirmed.
 *
 * Phase 17 of the TUI rebuild.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

// ============================================================================
// Types
// ============================================================================

interface Props {
  /** Called when user confirms the halt */
  onConfirm: () => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Number of currently open positions */
  openPositionCount?: number;
  /** Number of pending orders */
  pendingOrderCount?: number;
}

// ============================================================================
// Component
// ============================================================================

export function EmergencyHalt({
  onConfirm,
  onCancel,
  openPositionCount = 0,
  pendingOrderCount = 0,
}: Props) {
  const [countdown, setCountdown] = useState(3);
  const [unlocked, setUnlocked] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) {
      setUnlocked(true);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Escape to cancel at any time
  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="center">
        <Text color="red" bold inverse>{" EMERGENCY HALT "}</Text>
      </Box>
      <Text> </Text>

      {/* Warning message */}
      <Text color="red" bold>
        Close all positions and cancel all orders?
      </Text>
      <Text> </Text>

      {/* Position summary */}
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          Open positions: <Text bold color="yellow">{openPositionCount}</Text>
        </Text>
        <Text>
          Pending orders:  <Text bold color="yellow">{pendingOrderCount}</Text>
        </Text>
      </Box>
      <Text> </Text>

      {/* Irreversibility warning */}
      <Text color="red">
        {"\u26A0"} This action is IRREVERSIBLE. All positions will be market-closed.
      </Text>
      <Text> </Text>

      {/* Countdown or confirm */}
      {!unlocked ? (
        <Box>
          <Text dimColor>
            Confirm available in <Text bold color="red">{countdown}s</Text>... (Esc to cancel)
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Select
            options={[
              { label: "CONFIRM — CLOSE EVERYTHING", value: "confirm" },
              { label: "Cancel — keep positions open", value: "cancel" },
            ]}
            onChange={(v) => {
              if (v === "confirm") onConfirm();
              else onCancel();
            }}
          />
        </Box>
      )}
    </Box>
  );
}
