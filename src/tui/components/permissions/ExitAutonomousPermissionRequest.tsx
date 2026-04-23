import React from "react";
import { Box, Text } from "ink";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { Divider } from "../Divider.js";

// ============================================================================
// ExitAutonomousPermissionRequest — Simple confirmation to leave autonomous mode
// ============================================================================

interface Props {
  onDecision: (d: "approve" | "deny") => void;
}

export function ExitAutonomousPermissionRequest({ onDecision }: Props) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider />
      <Box paddingX={2} flexDirection="column">
        <Text color="cyanBright" bold>{"→"} EXIT AUTONOMOUS MODE</Text>
        <Text> </Text>
        <Text>{"  "}Exit autonomous mode? Gordon will resume asking for approval.</Text>
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={[
              { label: "Yes, exit autonomous mode", value: "approve" },
              { label: "No, stay autonomous", value: "deny" },
            ]}
            onChange={(v) => onDecision(v as "approve" | "deny")}
          />
        </Box>
      </Box>
      <Divider />
    </Box>
  );
}
