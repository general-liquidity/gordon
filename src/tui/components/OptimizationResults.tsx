/**
 * OptimizationResults — Grid/heatmap for parameter optimization
 *
 * Renders as text grid: rows = param1, cols = param2.
 * Cell color by Sharpe ratio. Highlights best result.
 * Flags overfitting risk.
 *
 * Pattern: Claude Code analysis output with color-coded grid.
 */

import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export interface OptResult {
  param1: number;
  param2: number;
  sharpe: number;
  returns: number;
  overfitRisk: number;
}

interface Props {
  results: OptResult[];
  param1Name: string;
  param2Name: string;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function sharpeColor(sharpe: number): string {
  if (sharpe >= 2.0) return "green";
  if (sharpe >= 1.0) return "yellow";
  if (sharpe >= 0) return "white";
  return "red";
}

function sharpeCellChar(sharpe: number): string {
  if (sharpe >= 3.0) return "\u2588\u2588";
  if (sharpe >= 2.0) return "\u2593\u2593";
  if (sharpe >= 1.0) return "\u2592\u2592";
  if (sharpe >= 0) return "\u2591\u2591";
  return "\u00b7\u00b7";
}

// ============================================================================
// Component
// ============================================================================

export function OptimizationResults({ results, param1Name, param2Name, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const { p1Values, p2Values, grid, best } = useMemo(() => {
    const p1Set = [...new Set(results.map((r) => r.param1))].sort((a, b) => a - b);
    const p2Set = [...new Set(results.map((r) => r.param2))].sort((a, b) => a - b);

    const lookup = new Map<string, OptResult>();
    let bestResult: OptResult | null = null;

    for (const r of results) {
      const key = `${r.param1}:${r.param2}`;
      lookup.set(key, r);
      if (!bestResult || r.sharpe > bestResult.sharpe) {
        bestResult = r;
      }
    }

    return {
      p1Values: p1Set,
      p2Values: p2Set,
      grid: lookup,
      best: bestResult,
    };
  }, [results]);

  return (
    <Pane title="OPTIMIZATION RESULTS" color="cyan">
      <Box>
        <Text dimColor>
          {results.length} combinations {"\u00b7"} {param1Name} x {param2Name}
        </Text>
      </Box>
      <Text> </Text>

      {/* Column headers (param2 values) */}
      <Box>
        <Box width={10}>
          <Text bold dimColor>{param1Name.slice(0, 8)}</Text>
        </Box>
        {p2Values.map((v) => (
          <Box key={v} width={6}>
            <Text bold dimColor>{v}</Text>
          </Box>
        ))}
      </Box>

      {/* Grid rows */}
      {p1Values.map((p1) => (
        <Box key={p1}>
          <Box width={10}>
            <Text bold>{p1}</Text>
          </Box>
          {p2Values.map((p2) => {
            const key = `${p1}:${p2}`;
            const r = grid.get(key);
            if (!r) {
              return (
                <Box key={p2} width={6}>
                  <Text dimColor>{"  --"}</Text>
                </Box>
              );
            }
            const isBest = best && r.param1 === best.param1 && r.param2 === best.param2;
            const overfit = r.overfitRisk > 0.7;
            return (
              <Box key={p2} width={6}>
                <Text
                  color={sharpeColor(r.sharpe)}
                  bold={!!isBest}
                  inverse={!!isBest}
                >
                  {sharpeCellChar(r.sharpe)}
                </Text>
                {overfit && <Text color="yellow">{"\u26A0"}</Text>}
                {!overfit && <Text> </Text>}
              </Box>
            );
          })}
        </Box>
      ))}

      {/* Legend */}
      <Text> </Text>
      <Box>
        <Text dimColor>Legend: </Text>
        <Text color="green">{"\u2588\u2588"} {"\u2265"}3.0 </Text>
        <Text color="green">{"\u2593\u2593"} {"\u2265"}2.0 </Text>
        <Text color="yellow">{"\u2592\u2592"} {"\u2265"}1.0 </Text>
        <Text>{"\u2591\u2591"} {"\u2265"}0.0 </Text>
        <Text color="red">{"\u00b7\u00b7"} {"<"}0 </Text>
        <Text color="yellow">{"\u26A0"} overfit risk</Text>
      </Box>

      {/* Best result */}
      {best && (
        <Box marginTop={1}>
          <Text bold color="green">
            Best: {param1Name}={best.param1} {param2Name}={best.param2}
            {" "}{"\u2014"} Sharpe {best.sharpe.toFixed(2)} ({(best.returns * 100).toFixed(1)}% return)
          </Text>
          {best.overfitRisk > 0.7 && (
            <Text color="yellow"> {"\u26A0"} High overfit risk ({(best.overfitRisk * 100).toFixed(0)}%)</Text>
          )}
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
