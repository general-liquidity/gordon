import React from "react";
import { Box, Text } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

// ============================================================================
// FallbackPermissionRequest — Minimal fallback approval dialog.
// No border, no dividers. Just a description and Approve / Deny.
// ============================================================================

interface Props {
  description: string;
  onDecision: (d: "approve" | "deny") => void;
}

export function FallbackPermissionRequest({ description, onDecision }: Props) {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={2}>
      <Text color="yellow" bold>{"⚠"} PERMISSION REQUEST</Text>
      <Text> </Text>
      <Text>{"  "}Gordon wants to: <Text bold>{description}</Text></Text>
      <Text> </Text>
      <Box paddingLeft={2}>
        <Select
          options={[
            { label: "Approve", value: "approve" },
            { label: "Deny", value: "deny" },
          ]}
          onChange={(v) => onDecision(v as "approve" | "deny")}
        />
      </Box>
    </Box>
  );
}
