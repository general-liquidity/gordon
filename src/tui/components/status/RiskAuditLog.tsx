/**
 * RiskAuditLog — History of risk evaluations
 *
 * Scrollable list of risk audit entries, most recent first.
 * Each entry: timestamp + symbol + decision badge + check summary.
 * Space to expand individual check results.
 *
 * Pattern: Claude Code task history with expandable detail.
 */

import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export type AuditDecision = "approved" | "rejected" | "warning";

export interface RiskAuditEntry {
  timestamp: string;
  orderId: string;
  symbol: string;
  checks: { name: string; passed: boolean }[];
  decision: AuditDecision;
  mode: string;
}

interface Props {
  entries: RiskAuditEntry[];
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function decisionColor(d: AuditDecision): string {
  if (d === "approved") return "green";
  if (d === "rejected") return "red";
  return "yellow";
}

function decisionIcon(d: AuditDecision): string {
  if (d === "approved") return "\u2713";
  if (d === "rejected") return "\u2717";
  return "\u26A0";
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function RiskAuditLog({ entries, onClose }: Props) {
  const [cursor, setCursor] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(entries.length - 1, c + 1));
      return;
    }
    if (input === " ") {
      setExpandedIndex((prev) => (prev === cursor ? null : cursor));
    }
  });

  if (entries.length === 0) {
    return (
      <Pane title="RISK AUDIT">
        <Text dimColor>No audit entries recorded.</Text>
        <Text> </Text>
        <Text dimColor>Esc close</Text>
      </Pane>
    );
  }

  return (
    <Pane title="RISK AUDIT">
      <Box>
        <Text dimColor>({entries.length} entries)</Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={3}>
        <Box width={18}>
          <Text bold dimColor>
            TIMESTAMP
          </Text>
        </Box>
        <Box width={10}>
          <Text bold dimColor>
            SYMBOL
          </Text>
        </Box>
        <Box width={12}>
          <Text bold dimColor>
            DECISION
          </Text>
        </Box>
        <Box width={12}>
          <Text bold dimColor>
            CHECKS
          </Text>
        </Box>
        <Box width={8}>
          <Text bold dimColor>
            MODE
          </Text>
        </Box>
      </Box>

      {/* Entries */}
      {entries.map((entry, i) => {
        const isFocused = i === cursor;
        const isExpanded = expandedIndex === i;
        const pointer = isFocused ? "\u25B8 " : "  ";
        const passedCount = entry.checks.filter((c) => c.passed).length;
        const totalChecks = entry.checks.length;
        const color = decisionColor(entry.decision);
        const icon = decisionIcon(entry.decision);

        return (
          <Box key={`${entry.orderId}-${i}`} flexDirection="column">
            <Box>
              <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
              <Box width={18}>
                <Text dimColor>{padRight(formatTimestamp(entry.timestamp), 18)}</Text>
              </Box>
              <Box width={10}>
                <Text bold={isFocused}>{padRight(entry.symbol, 10)}</Text>
              </Box>
              <Box width={12}>
                <Text color={color}>
                  {icon} {padRight(entry.decision.toUpperCase(), 10)}
                </Text>
              </Box>
              <Box width={12}>
                <Text color={passedCount === totalChecks ? "green" : "yellow"}>
                  {passedCount}/{totalChecks} passed
                </Text>
              </Box>
              <Box width={8}>
                <Text dimColor>{entry.mode}</Text>
              </Box>
            </Box>

            {/* Expanded check details */}
            {isExpanded && (
              <Box flexDirection="column" paddingLeft={4} marginBottom={1}>
                {entry.checks.map((check) => (
                  <Box key={check.name}>
                    <Text color={check.passed ? "green" : "red"}>
                      {check.passed ? "\u2713" : "\u2717"}{" "}
                    </Text>
                    <Text dimColor={check.passed}>{check.name}</Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Space expand {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
