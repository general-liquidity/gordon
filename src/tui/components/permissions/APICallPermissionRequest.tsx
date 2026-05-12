import React from "react";
import { Box, Text } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// APICallPermissionRequest — Approval for outbound API calls
// ============================================================================

interface Props {
  endpoint: string;
  method: string;
  reason?: string;
  onDecision: (d: "approve" | "deny") => void;
}

export function APICallPermissionRequest({ endpoint, method, reason, onDecision }: Props) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider />
      <Box paddingX={2} flexDirection="column">
        <Text color="yellow" bold>{"⚠"} API CALL REQUEST</Text>
        <Text> </Text>
        <Text>
          {"  "}Gordon wants to call:{" "}
          <Text bold color="cyanBright">{method} {endpoint}</Text>
        </Text>
        {reason && <Text dimColor>{"  "}{reason}</Text>}
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={[
              { label: "Allow", value: "approve" },
              { label: "Deny", value: "deny" },
            ]}
            onChange={(v) => onDecision(v as "approve" | "deny")}
          />
        </Box>
      </Box>
      <Divider />
    </Box>
  );
}
