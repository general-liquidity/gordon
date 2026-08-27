/**
 * ConsensusView — Multi-signal trade consensus tree
 *
 * Shows multiple analysis signals voting on a trade decision
 * in a tree format with status icons:
 *
 *   CONSENSUS · BUY (4/5 agree) · 85% confidence
 *     ├─ RSI Oversold      ✓ BUY
 *     ├─ MACD Cross        ✓ BUY
 *     ├─ Volume Surge      ✓ BUY
 *     ├─ Trend Following   ✗ NEUTRAL
 *     └─ Support Bounce    ✓ BUY
 *
 * Pattern: Claude Code agent progress tree with status markers.
 */

import { Box, Text } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export type Vote = "BUY" | "SELL" | "NEUTRAL" | "HOLD";

export interface Signal {
  name: string;
  vote: Vote;
  recommendation: string;
}

interface Props {
  signals: Signal[];
  decision: Vote;
  confidence: number;
}

// ============================================================================
// Helpers
// ============================================================================

function voteColor(vote: Vote): string {
  if (vote === "BUY") return "green";
  if (vote === "SELL") return "red";
  if (vote === "HOLD") return "yellow";
  return "gray";
}

function voteIcon(vote: Vote, decision: Vote): { icon: string; color: string } {
  const agrees = vote === decision;
  return {
    icon: agrees ? "\u2713" : "\u2717",
    color: agrees ? "green" : "red",
  };
}

function decisionColor(decision: Vote): string {
  if (decision === "BUY") return "green";
  if (decision === "SELL") return "red";
  return "yellow";
}

function confidenceColor(pct: number): string {
  if (pct >= 80) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

// ============================================================================
// Component
// ============================================================================

export function ConsensusView({ signals, decision, confidence }: Props) {
  const agreeCount = signals.filter((s) => s.vote === decision).length;
  const total = signals.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={decisionColor(decision)}
      paddingX={1}
      paddingY={0}
    >
      {/* Header */}
      <Box>
        <Text bold color={decisionColor(decision)}>
          CONSENSUS
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text bold color={decisionColor(decision)}>
          {decision}
        </Text>
        <Text dimColor>
          {" "}
          ({agreeCount}/{total} agree)
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text color={confidenceColor(confidence)}>{confidence}% confidence</Text>
      </Box>

      {/* Signal tree */}
      {signals.map((signal, i) => {
        const isLast = i === signals.length - 1;
        const connector = isLast ? "\u2514\u2500" : "\u251C\u2500";
        const { icon, color } = voteIcon(signal.vote, decision);
        const padded = signal.name.padEnd(20);

        return (
          <Box key={signal.name} paddingLeft={2}>
            <Text dimColor>{connector} </Text>
            <Text>{padded}</Text>
            <Text color={color}>{icon} </Text>
            <Text color={voteColor(signal.vote)}>{signal.recommendation}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
