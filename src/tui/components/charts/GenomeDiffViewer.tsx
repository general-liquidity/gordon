/**
 * GenomeDiffViewer -- Strategy mutation before/after diff
 *
 * Shows original parameters (dimmed, left column) vs mutated parameters
 * (highlighted changes in cyan, right column). Header displays mutation ID,
 * parent strategy, and fitness score.
 *
 * Used when /evolve or /mutate returns results.
 *
 * Pattern: Claude Code StructuredDiff (side-by-side parameter comparison).
 */

import React from "react";
import { Box, Text } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export interface GenomeParam {
  key: string;
  original: string | number;
  mutated: string | number;
}

export interface MutationResult {
  mutationId: string;
  parentStrategy: string;
  childStrategy?: string;
  fitnessScore: number;
  generation?: number;
  params: GenomeParam[];
}

interface Props {
  mutation: MutationResult;
}

// ============================================================================
// Constants
// ============================================================================

const COL_KEY = 22;
const COL_VAL = 18;
const SEPARATOR = "  \u2192  "; // →

// ============================================================================
// Helpers
// ============================================================================

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function fmt(v: string | number): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  return v;
}

function hasChanged(p: GenomeParam): boolean {
  return String(p.original) !== String(p.mutated);
}

function fitnessColor(score: number): string {
  if (score >= 0.8) return "green";
  if (score >= 0.5) return "yellow";
  return "red";
}

// ============================================================================
// Component
// ============================================================================

export function GenomeDiffViewer({ mutation }: Props) {
  const changedCount = mutation.params.filter(hasChanged).length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box>
        <Text bold color="cyan">
          GENOME DIFF
        </Text>
        <Text dimColor>
          {" "}
          {"\u00b7"} {mutation.mutationId}
        </Text>
      </Box>
      <Text> </Text>

      {/* Metadata */}
      <Box>
        <Text dimColor>parent </Text>
        <Text bold>{mutation.parentStrategy}</Text>
        {mutation.childStrategy && (
          <>
            <Text dimColor> {"\u2192"} </Text>
            <Text bold color="cyan">
              {mutation.childStrategy}
            </Text>
          </>
        )}
      </Box>
      <Box>
        <Text dimColor>fitness </Text>
        <Text bold color={fitnessColor(mutation.fitnessScore)}>
          {mutation.fitnessScore.toFixed(4)}
        </Text>
        {mutation.generation != null && (
          <>
            <Text dimColor> {"\u00b7"} gen </Text>
            <Text>{mutation.generation}</Text>
          </>
        )}
        <Text dimColor>
          {" "}
          {"\u00b7"} {changedCount}/{mutation.params.length} params mutated
        </Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box>
        <Box width={COL_KEY}>
          <Text bold dimColor>
            PARAMETER
          </Text>
        </Box>
        <Box width={COL_VAL}>
          <Text bold dimColor>
            ORIGINAL
          </Text>
        </Box>
        <Text dimColor>{"      "}</Text>
        <Box width={COL_VAL}>
          <Text bold dimColor>
            MUTATED
          </Text>
        </Box>
      </Box>

      {/* Separator line */}
      <Box>
        <Text dimColor>
          {"\u2500".repeat(COL_KEY + COL_VAL + SEPARATOR.length + COL_VAL)}
        </Text>
      </Box>

      {/* Parameter rows */}
      {mutation.params.map((p) => {
        const changed = hasChanged(p);
        const origStr = fmt(p.original);
        const mutStr = fmt(p.mutated);

        return (
          <Box key={p.key}>
            <Box width={COL_KEY}>
              <Text dimColor={!changed} bold={changed}>
                {padRight(p.key, COL_KEY)}
              </Text>
            </Box>
            <Box width={COL_VAL}>
              <Text dimColor>{padRight(origStr, COL_VAL)}</Text>
            </Box>
            <Text dimColor={!changed} color={changed ? "cyan" : undefined}>
              {changed ? SEPARATOR : "      "}
            </Text>
            <Box width={COL_VAL}>
              <Text
                color={changed ? "cyan" : undefined}
                dimColor={!changed}
                bold={changed}
              >
                {padRight(mutStr, COL_VAL)}
              </Text>
            </Box>
            {changed && (
              <Text color="cyan"> {"\u25C0"}</Text>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        {"\u25C0"} marks mutated parameters
      </Text>
    </Box>
  );
}
