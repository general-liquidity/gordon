import React from "react";
import { Box, Text } from "ink";

/**
 * DoctorRenderer -- System health check results
 * Phase 10: StatusIcon per check (checkmark/cross/warning) + label
 */

interface Check {
  label: string;
  ok: boolean;
  severity: "error" | "warning" | "info";
  message: string;
}

interface DoctorData {
  checks: Check[];
}

interface Props {
  data: DoctorData;
}

/** Inline status icon: checkmark for ok, cross for error, warning sign for warning */
function CheckIcon({ ok, severity }: { ok: boolean; severity: string }) {
  if (ok) {
    return <Text color="green">{"\u2713"}</Text>;
  }
  if (severity === "error") {
    return <Text color="red">{"\u2717"}</Text>;
  }
  return <Text color="yellow">{"\u26A0"}</Text>;
}

export function DoctorRenderer({ data }: Props) {
  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {data.checks.map((check, i) => (
        <Box key={i}>
          <CheckIcon ok={check.ok} severity={check.severity} />
          <Text> </Text>
          <Text bold>{check.label}</Text>
          <Text dimColor>  {check.message}</Text>
        </Box>
      ))}
    </Box>
  );
}
