import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

/**
 * DoctorDialog — Actionable diagnostics with fix suggestions
 *
 * Shows health checks with status icons. User can select a failing
 * check to see fix instructions and optionally auto-fix.
 */

interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "info";
  message: string;
  fixCommand?: string;
  fixLabel?: string;
}

interface Props {
  checks: DiagnosticCheck[];
  onRunFix: (command: string) => void;
  onCancel: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  pass: "\u2713",
  warn: "\u26A0",
  fail: "\u2717",
  info: "\u2139",
};

const STATUS_COLORS: Record<string, string> = {
  pass: "green",
  warn: "yellow",
  fail: "red",
  info: "cyan",
};

export function DoctorDialog({ checks, onRunFix, onCancel }: Props) {
  const [selectedCheck, setSelectedCheck] = useState<DiagnosticCheck | null>(null);

  useInput((_input, key) => {
    if (key.escape) {
      if (selectedCheck) setSelectedCheck(null);
      else onCancel();
    }
  });

  const fixableChecks = checks.filter((c) => c.status !== "pass" && c.fixCommand);

  if (selectedCheck) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">
          FIX: {selectedCheck.label}
        </Text>
        <Box marginTop={1}>
          <Text>{selectedCheck.message}</Text>
        </Box>
        {selectedCheck.fixCommand && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Suggested fix:</Text>
            <Text color="green"> {selectedCheck.fixCommand}</Text>
            <Box marginTop={1}>
              <Select
                options={[
                  { label: `Run: ${selectedCheck.fixCommand}`, value: "fix" },
                  { label: "Go back", value: "back" },
                ]}
                onChange={(v) => {
                  if (v === "fix" && selectedCheck.fixCommand) onRunFix(selectedCheck.fixCommand);
                  else setSelectedCheck(null);
                }}
              />
            </Box>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">
          DOCTOR
        </Text>
        <Text dimColor>
          {" "}
          ({checks.filter((c) => c.status === "pass").length}/{checks.length} passing)
        </Text>
      </Box>

      {checks.map((check) => (
        <Box key={check.id}>
          <Text color={STATUS_COLORS[check.status] as any}> {STATUS_ICONS[check.status]} </Text>
          <Text bold={check.status !== "pass"}>{check.label}</Text>
          <Text dimColor> {check.message}</Text>
        </Box>
      ))}

      {fixableChecks.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Select an issue to fix:</Text>
          <Select
            options={fixableChecks.map((c) => ({
              label: `${STATUS_ICONS[c.status]} ${c.label} — ${c.fixLabel ?? c.fixCommand}`,
              value: c.id,
            }))}
            onChange={(id) => {
              const check = checks.find((c) => c.id === id);
              if (check) setSelectedCheck(check);
            }}
          />
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Esc to close</Text>
      </Box>
    </Box>
  );
}
