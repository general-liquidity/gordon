/**
 * GenomeEvolutionPanel — Launch and monitor evolution runs
 *
 * Shows generation count, best fitness, population size, mutation rate,
 * and top 10 variants by fitness. Controls to start/stop.
 *
 * Pattern: Claude Code long-running task monitor with live metrics.
 */

import React from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Pane } from "../design-system/Pane.js";
import { ProgressBar } from "../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export interface GenomeVariant {
  id: string;
  fitness: number;
  generation: number;
  params: Record<string, number>;
}

interface Props {
  isRunning: boolean;
  generation: number;
  bestFitness: number;
  populationSize: number;
  mutationRate: number;
  variants: GenomeVariant[];
  onStart?: () => void;
  onStop?: () => void;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function fitnessColor(fitness: number): string {
  if (fitness >= 0.8) return "green";
  if (fitness >= 0.5) return "yellow";
  return "red";
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function GenomeEvolutionPanel({
  isRunning,
  generation,
  bestFitness,
  populationSize,
  mutationRate,
  variants,
  onStart,
  onStop,
  onClose,
}: Props) {
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      if (isRunning) {
        onStop?.();
      } else {
        onStart?.();
      }
    }
  });

  const top10 = [...variants]
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, 10);

  return (
    <Pane title="GENOME EVOLUTION" color={isRunning ? "green" : "cyan"}>
      {/* Status */}
      <Box>
        <Text color={isRunning ? "green" : "gray"}>
          {isRunning ? "\u25CF RUNNING" : "\u25CB STOPPED"}
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text>Generation {generation}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text>Pop {populationSize}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text>Mutation {(mutationRate * 100).toFixed(1)}%</Text>
      </Box>

      {/* Best fitness */}
      <Box marginTop={1}>
        <Box width={14}>
          <Text dimColor>Best Fitness</Text>
        </Box>
        <ProgressBar value={bestFitness} width={20} fillColor={fitnessColor(bestFitness)} />
        <Text> </Text>
        <Text bold color={fitnessColor(bestFitness)}>{(bestFitness * 100).toFixed(1)}%</Text>
      </Box>
      <Text> </Text>

      {/* Top variants */}
      <Text bold dimColor>TOP VARIANTS</Text>
      <Box paddingLeft={2} flexDirection="column">
        <Box>
          <Box width={6}><Text bold dimColor>RANK</Text></Box>
          <Box width={12}><Text bold dimColor>ID</Text></Box>
          <Box width={10}><Text bold dimColor>FITNESS</Text></Box>
          <Box width={8}><Text bold dimColor>GEN</Text></Box>
          <Box width={24}><Text bold dimColor>PARAMS</Text></Box>
        </Box>

        {top10.map((v, i) => {
          const paramStr = Object.entries(v.params)
            .map(([k, val]) => `${k}=${val}`)
            .join(" ")
            .slice(0, 22);

          return (
            <Box key={v.id}>
              <Box width={6}>
                <Text>{padRight(`#${i + 1}`, 6)}</Text>
              </Box>
              <Box width={12}>
                <Text dimColor>{padRight(v.id.slice(0, 10), 12)}</Text>
              </Box>
              <Box width={10}>
                <ProgressBar value={v.fitness} width={6} fillColor={fitnessColor(v.fitness)} />
                <Text color={fitnessColor(v.fitness)}> {(v.fitness * 100).toFixed(0)}%</Text>
              </Box>
              <Box width={8}>
                <Text dimColor>{v.generation}</Text>
              </Box>
              <Box width={24}>
                <Text dimColor>{paramStr}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Text> </Text>
      <Text dimColor>
        Enter {isRunning ? "stop" : "start"} {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
