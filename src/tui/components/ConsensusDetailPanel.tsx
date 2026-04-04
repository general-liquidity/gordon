/**
 * ConsensusDetailPanel — Full consensus evaluation for trade proposals
 *
 * Shows 5 evaluators with weights, votes, confidence, and expandable reasoning.
 * Final row: aggregate decision + overall confidence + quorum status.
 * Space to toggle reasoning expansion per evaluator.
 *
 * Pattern: Claude Code agent decision tree with expandable detail.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../design-system/Pane.js";
import { ProgressBar } from "../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export type EvaluatorVoteType = "BUY" | "SELL" | "NEUTRAL" | "HOLD";

export interface EvaluatorVote {
  name: string;
  weight: number;
  vote: EvaluatorVoteType;
  confidence: number;
  reasoning: string;
}

interface Props {
  symbol: string;
  evaluators: EvaluatorVote[];
  finalDecision: string;
  confidence: number;
  quorumMet: boolean;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function voteColor(vote: EvaluatorVoteType): string {
  if (vote === "BUY") return "green";
  if (vote === "SELL") return "red";
  if (vote === "HOLD") return "yellow";
  return "gray";
}

function confidenceColor(pct: number): string {
  if (pct >= 80) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function ConsensusDetailPanel({
  symbol,
  evaluators,
  finalDecision,
  confidence,
  quorumMet,
  onClose,
}: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);

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
      setCursor((c) => Math.min(evaluators.length - 1, c + 1));
      return;
    }
    if (input === " ") {
      setExpandedIndex((prev) => (prev === cursor ? null : cursor));
    }
  });

  const decisionColor = voteColor(finalDecision as EvaluatorVoteType);

  return (
    <Pane title="CONSENSUS" color={decisionColor}>
      {/* Header */}
      <Box>
        <Text bold color={decisionColor}>{finalDecision}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text bold>{symbol}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text color={confidenceColor(confidence)}>{confidence}% confidence</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text color={quorumMet ? "green" : "red"}>
          {quorumMet ? "\u2713 quorum met" : "\u2717 no quorum"}
        </Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={3}>
        <Box width={16}><Text bold dimColor>EVALUATOR</Text></Box>
        <Box width={8}><Text bold dimColor>WEIGHT</Text></Box>
        <Box width={10}><Text bold dimColor>VOTE</Text></Box>
        <Box width={12}><Text bold dimColor>CONFIDENCE</Text></Box>
      </Box>

      {/* Evaluator rows */}
      {evaluators.map((ev, i) => {
        const isFocused = i === cursor;
        const isExpanded = expandedIndex === i;
        const pointer = isFocused ? "\u25B8 " : "  ";

        return (
          <Box key={ev.name} flexDirection="column">
            <Box>
              <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
              <Box width={16}>
                <Text bold={isFocused}>{padRight(ev.name, 16)}</Text>
              </Box>
              <Box width={8}>
                <ProgressBar value={ev.weight} width={5} fillColor="cyan" />
                <Text dimColor> {(ev.weight * 100).toFixed(0)}%</Text>
              </Box>
              <Box width={10}>
                <Text color={voteColor(ev.vote)} bold>
                  {padRight(ev.vote, 10)}
                </Text>
              </Box>
              <Box width={12}>
                <Text color={confidenceColor(ev.confidence)}>
                  {ev.confidence}%
                </Text>
              </Box>
            </Box>

            {/* Expanded reasoning */}
            {isExpanded && (
              <Box paddingLeft={4} marginBottom={1}>
                <Text dimColor wrap="wrap">{ev.reasoning}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Final decision row */}
      <Text> </Text>
      <Box>
        <Text dimColor>{"\u2500".repeat(46)}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Box width={16}>
          <Text bold>AGGREGATE</Text>
        </Box>
        <Box width={8}>
          <Text dimColor>1.00</Text>
        </Box>
        <Box width={10}>
          <Text color={decisionColor} bold>{finalDecision}</Text>
        </Box>
        <Box width={12}>
          <Text color={confidenceColor(confidence)} bold>{confidence}%</Text>
        </Box>
      </Box>

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Space expand reasoning {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
