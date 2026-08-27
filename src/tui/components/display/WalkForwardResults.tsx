/**
 * WalkForwardResults — Walk-forward analysis display
 *
 * Table showing in-sample vs out-of-sample returns and Sharpe per window.
 * Color: green if out-sample > 50% of in-sample, red if degradation > 50%.
 * Overall robustness score with ProgressBar.
 *
 * Pattern: Claude Code analysis results with quality scoring.
 */

import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export interface WalkForwardWindow {
  windowIndex: number;
  inSampleReturn: number;
  outSampleReturn: number;
  inSampleSharpe: number;
  outSampleSharpe: number;
}

interface Props {
  windows: WalkForwardWindow[];
  overallScore: number;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function degradationColor(inSample: number, outSample: number): string {
  if (inSample === 0) return "white";
  const ratio = outSample / inSample;
  if (ratio >= 0.5) return "green";
  if (ratio >= 0) return "yellow";
  return "red";
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

function fmtSharpe(n: number): string {
  return n.toFixed(2);
}

function scoreColor(score: number): string {
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

// ============================================================================
// Component
// ============================================================================

export function WalkForwardResults({ windows, overallScore, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Pane title="WALK-FORWARD ANALYSIS">
      {/* Overall robustness */}
      <Box>
        <Box width={14}>
          <Text dimColor>Robustness</Text>
        </Box>
        <ProgressBar value={overallScore / 100} width={20} fillColor={scoreColor(overallScore)} />
        <Text> </Text>
        <Text bold color={scoreColor(overallScore)}>
          {overallScore}/100
        </Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box>
        <Box width={8}>
          <Text bold dimColor>
            WINDOW
          </Text>
        </Box>
        <Box width={14}>
          <Text bold dimColor>
            IN-SAMPLE RET
          </Text>
        </Box>
        <Box width={15}>
          <Text bold dimColor>
            OUT-SAMPLE RET
          </Text>
        </Box>
        <Box width={14}>
          <Text bold dimColor>
            IN-SAMPLE SR
          </Text>
        </Box>
        <Box width={15}>
          <Text bold dimColor>
            OUT-SAMPLE SR
          </Text>
        </Box>
      </Box>

      {/* Data rows */}
      {windows.map((w) => {
        const retColor = degradationColor(w.inSampleReturn, w.outSampleReturn);
        const srColor = degradationColor(w.inSampleSharpe, w.outSampleSharpe);

        return (
          <Box key={w.windowIndex}>
            <Box width={8}>
              <Text>{padLeft(`W${w.windowIndex}`, 6)}</Text>
            </Box>
            <Box width={14}>
              <Text>{padLeft(fmtPct(w.inSampleReturn), 12)}</Text>
            </Box>
            <Box width={15}>
              <Text color={retColor}>{padLeft(fmtPct(w.outSampleReturn), 13)}</Text>
            </Box>
            <Box width={14}>
              <Text>{padLeft(fmtSharpe(w.inSampleSharpe), 12)}</Text>
            </Box>
            <Box width={15}>
              <Text color={srColor}>{padLeft(fmtSharpe(w.outSampleSharpe), 13)}</Text>
            </Box>
          </Box>
        );
      })}

      {/* Summary */}
      <Text> </Text>
      <Box>
        <Text dimColor>{"\u2500".repeat(66)}</Text>
      </Box>
      <Box>
        <Text dimColor>
          {windows.length} windows {"\u00b7"}{" "}
        </Text>
        <Text color={scoreColor(overallScore)}>
          {overallScore >= 70
            ? "Robust strategy"
            : overallScore >= 40
              ? "Moderate robustness"
              : "Poor robustness \u2014 consider refit"}
        </Text>
      </Box>

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
