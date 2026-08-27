import { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

// ============================================================================
// EnterAutonomousPermissionRequest — Confirmation before entering autonomous
// trading mode. Bordered yellow box with a 3-second countdown.
// ============================================================================

interface Props {
  strategyCount: number;
  onDecision: (d: "approve" | "deny") => void;
}

export function EnterAutonomousPermissionRequest({ strategyCount, onDecision }: Props) {
  const [countdown, setCountdown] = useState(3);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (countdown <= 0) {
      setUnlocked(true);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useInput((_, key) => {
    if (key.escape) onDecision("deny");
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        paddingX={2}
        paddingY={1}
      >
        <Text color="yellow" bold>
          {"⚠"} ENTER AUTONOMOUS MODE
        </Text>
        <Text> </Text>
        <Text>
          {"  "}Gordon will trade{" "}
          <Text bold color="yellow">
            without asking for approval.
          </Text>
        </Text>
        <Text dimColor>
          {"  "}
          {strategyCount} {strategyCount === 1 ? "strategy" : "strategies"} will run autonomously.
        </Text>
        <Text> </Text>
        <Text color="yellow">{"  "}You can exit autonomous mode at any time.</Text>
        <Text> </Text>
        {!unlocked ? (
          <Text dimColor>
            {"  "}Confirm available in {countdown}s... (Esc to cancel)
          </Text>
        ) : (
          <Box paddingLeft={2}>
            <Select
              options={[
                { label: "Enter autonomous mode", value: "approve" },
                { label: "Cancel", value: "deny" },
              ]}
              onChange={(v) => onDecision(v as "approve" | "deny")}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
