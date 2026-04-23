import React from "react";
import { Box, Text } from "ink";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { Divider } from "../Divider.js";

// ============================================================================
// ToolExecutionPermissionRequest — Generic tool approval dialog
//
// Like StandardApproval in ApprovalDialog but for generic tool calls.
// Shows tool name + top 3 args (truncated to 60 chars each).
// Options: Allow once / Always allow / Deny
// ============================================================================

interface Props {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  reason?: string;
  riskClass?: "low" | "medium" | "high";
  onDecision: (d: "approve" | "always" | "deny") => void;
}

const MAX_ARGS = 3;
const MAX_ARG_LEN = 60;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function ArgList({ toolArgs }: { toolArgs: Record<string, unknown> }) {
  const entries = Object.entries(toolArgs).slice(0, MAX_ARGS);
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(([k, v]) => {
        const raw = typeof v === "string" ? v : JSON.stringify(v);
        return (
          <Box key={k} paddingLeft={4}>
            <Text dimColor>{k}: </Text>
            <Text>{truncate(raw, MAX_ARG_LEN)}</Text>
          </Box>
        );
      })}
    </>
  );
}

export function ToolExecutionPermissionRequest({
  toolName,
  toolArgs,
  reason,
  riskClass = "low",
  onDecision,
}: Props) {
  const riskColor =
    riskClass === "high" ? "red" : riskClass === "medium" ? "yellow" : "green";

  const content = (
    <>
      <Text color="yellow" bold>{"⚠"} TOOL EXECUTION REQUEST</Text>
      <Text> </Text>
      <Text>
        {"  "}Gordon wants to run:{" "}
        <Text bold color="cyanBright">`{toolName}`</Text>
      </Text>
      {toolArgs && Object.keys(toolArgs).length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <ArgList toolArgs={toolArgs} />
        </Box>
      )}
      <Box>
        <Text dimColor>{"  "}Risk: </Text>
        <Text color={riskColor} bold>{riskClass.toUpperCase()}</Text>
      </Box>
      {reason && <Text dimColor>{"  "}{reason}</Text>}
      <Text> </Text>
      <Box paddingLeft={2}>
        <Select
          options={[
            { label: "Allow once", value: "approve" },
            { label: "Always allow this tool", value: "always" },
            { label: "Deny", value: "deny" },
          ]}
          onChange={(v) => onDecision(v as "approve" | "always" | "deny")}
        />
      </Box>
    </>
  );

  if (riskClass === "high") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="red"
          paddingX={2}
          paddingY={1}
        >
          {content}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider />
      <Box paddingX={2} flexDirection="column">
        {content}
      </Box>
      <Divider />
    </Box>
  );
}
