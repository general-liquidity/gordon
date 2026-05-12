import React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

// ============================================================================
// InjectionDefensePanel — Shows injection detection results in detail
//
// Displays matched patterns by category (instruction_override, role_impersonation,
// mode_manipulation, emergency_exploit, encoding_obfuscation, tool_injection,
// social_engineering, data_exfiltration) with severity and matched text.
// ============================================================================

export interface InjectionMatch {
  category: string;
  pattern: string;
  matchedText: string;
  severity: "low" | "medium" | "high" | "critical";
}

interface Props {
  matches: InjectionMatch[];
  inputBlocked: boolean;
  inputText: string;
  onClose: () => void;
}

const SEVERITY_CONFIG: Record<string, { color: string; icon: string }> = {
  critical: { color: "red",    icon: "\u2717" },
  high:     { color: "red",    icon: "\u26A0" },
  medium:   { color: "yellow", icon: "\u25C8" },
  low:      { color: "gray",   icon: "\u00b7" },
};

const CATEGORY_LABELS: Record<string, string> = {
  instruction_override: "Instruction Override",
  role_impersonation: "Role Impersonation",
  mode_manipulation: "Mode Manipulation",
  emergency_exploit: "Emergency Exploit",
  encoding_obfuscation: "Encoding Obfuscation",
  tool_injection: "Tool Injection",
  social_engineering: "Social Engineering",
  data_exfiltration: "Data Exfiltration",
};

export function InjectionDefensePanel({ matches, inputBlocked, inputText, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Pane title="INJECTION DEFENSE" color={inputBlocked ? "red" : "yellow"}>
      {/* Summary */}
      <Box>
        <Text color={inputBlocked ? "red" : "yellow"} bold>
          {inputBlocked ? "\u2717 INPUT BLOCKED" : "\u26A0 PATTERNS DETECTED"}
        </Text>
        <Text dimColor> {"\u00b7"} {matches.length} match{matches.length !== 1 ? "es" : ""}</Text>
      </Box>
      <Text> </Text>

      {/* Input preview (truncated) */}
      <Box>
        <Text dimColor>Input: </Text>
        <Text>{inputText.length > 60 ? inputText.slice(0, 60) + "\u2026" : inputText}</Text>
      </Box>
      <Text> </Text>

      {/* Matches by category */}
      {matches.map((match, i) => {
        const sev = SEVERITY_CONFIG[match.severity] ?? SEVERITY_CONFIG.medium!;
        return (
          <Box key={i} paddingLeft={2} flexDirection="column" marginBottom={0}>
            <Box>
              <Text color={sev.color}>{sev.icon} </Text>
              <Text bold color={sev.color}>{match.severity.toUpperCase()}</Text>
              <Text dimColor> {"\u00b7"} </Text>
              <Text>{CATEGORY_LABELS[match.category] ?? match.category}</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text dimColor>Pattern: {match.pattern}</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text color={sev.color}>
                Matched: "{match.matchedText.slice(0, 80)}{match.matchedText.length > 80 ? "\u2026" : ""}"
              </Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
