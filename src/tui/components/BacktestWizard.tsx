/**
 * BacktestWizard — Multi-step backtest configuration
 *
 * 5 steps: strategy, symbol+timeframe, dates+capital, optimization, review.
 * Progress dots at top, step counter. Uses Dialog wrapper.
 *
 * Pattern: Claude Code multi-step wizard dialog.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Dialog } from "../design-system/Dialog.js";

// ============================================================================
// Types
// ============================================================================

export interface BacktestConfig {
  strategyId: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  optimization: "none" | "grid" | "random";
}

interface Props {
  strategies: string[];
  onRun: (config: BacktestConfig) => void;
  onCancel: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
const OPT_MODES: Array<"none" | "grid" | "random"> = ["none", "grid", "random"];
const STEPS = ["Strategy", "Symbol", "Dates", "Optimization", "Review"];

// ============================================================================
// Component
// ============================================================================

export function BacktestWizard({ strategies, onRun, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [strategyCursor, setStrategyCursor] = useState(0);
  const [symbol, setSymbol] = useState("");
  const [tfCursor, setTfCursor] = useState(3); // default 1h
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState("10000");
  const [optCursor, setOptCursor] = useState(0);
  const [activeField, setActiveField] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      if (step > 0) {
        setStep((s) => s - 1);
      } else {
        onCancel();
      }
      return;
    }

    // Step 0: Select strategy
    if (step === 0) {
      if (key.upArrow) setStrategyCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setStrategyCursor((c) => Math.min(strategies.length - 1, c + 1));
      if (key.return) setStep(1);
      return;
    }

    // Step 1: Symbol + timeframe
    if (step === 1) {
      if (key.tab) {
        setActiveField((f) => (f + 1) % 2);
        return;
      }
      if (activeField === 0) {
        if (key.return) {
          setActiveField(1);
          return;
        }
        if (key.backspace || key.delete) {
          setSymbol((s) => s.slice(0, -1));
          return;
        }
        if (input && !key.upArrow && !key.downArrow) {
          setSymbol((s) => s + input.toUpperCase());
          return;
        }
      }
      if (activeField === 1) {
        if (key.upArrow) setTfCursor((c) => Math.max(0, c - 1));
        if (key.downArrow) setTfCursor((c) => Math.min(TIMEFRAMES.length - 1, c + 1));
        if (key.return) {
          setStep(2);
          setActiveField(0);
        }
      }
      return;
    }

    // Step 2: Dates + capital
    if (step === 2) {
      if (key.tab) {
        setActiveField((f) => (f + 1) % 3);
        return;
      }
      if (key.return) {
        if (activeField < 2) {
          setActiveField((f) => f + 1);
        } else {
          setStep(3);
          setActiveField(0);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (activeField === 0) setStartDate((s) => s.slice(0, -1));
        if (activeField === 1) setEndDate((s) => s.slice(0, -1));
        if (activeField === 2) setCapital((s) => s.slice(0, -1));
        return;
      }
      if (input && !key.upArrow && !key.downArrow) {
        if (activeField === 0) setStartDate((s) => s + input);
        if (activeField === 1) setEndDate((s) => s + input);
        if (activeField === 2) setCapital((s) => s + input);
      }
      return;
    }

    // Step 3: Optimization mode
    if (step === 3) {
      if (key.upArrow) setOptCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setOptCursor((c) => Math.min(OPT_MODES.length - 1, c + 1));
      if (key.return) setStep(4);
      return;
    }

    // Step 4: Review
    if (step === 4) {
      if (key.return) {
        onRun({
          strategyId: strategies[strategyCursor] ?? "",
          symbol: symbol || "BTCUSD",
          timeframe: TIMEFRAMES[tfCursor] ?? "1h",
          startDate,
          endDate,
          initialCapital: Number(capital) || 10000,
          optimization: OPT_MODES[optCursor] ?? "none",
        });
      }
    }
  });

  return (
    <Dialog
      title="BACKTEST WIZARD"
      subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
      color="cyan"
      onClose={onCancel}
    >
      {/* Progress dots */}
      <Box>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <Text dimColor> {"\u2500"} </Text>}
            <Text color={i === step ? "cyanBright" : i < step ? "green" : undefined} dimColor={i > step}>
              {i < step ? "\u25CF" : i === step ? "\u25C9" : "\u25CB"} {s}
            </Text>
          </React.Fragment>
        ))}
      </Box>
      <Text> </Text>

      {/* Step 0: Strategy selection */}
      {step === 0 && (
        <Box flexDirection="column">
          <Text bold>Select Strategy:</Text>
          {strategies.map((s, i) => {
            const isFocused = i === strategyCursor;
            return (
              <Box key={s} paddingLeft={2}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? "\u25B8 " : "  "}{s}
                </Text>
              </Box>
            );
          })}
          <Text> </Text>
          <Text dimColor>{"\u2191\u2193"} select {"\u00b7"} Enter next</Text>
        </Box>
      )}

      {/* Step 1: Symbol + timeframe */}
      {step === 1 && (
        <Box flexDirection="column">
          <Box>
            <Text bold color={activeField === 0 ? "cyanBright" : undefined}>Symbol: </Text>
            <Text>{symbol || "..."}</Text>
            {activeField === 0 && <Text color="cyanBright">{"\u2588"}</Text>}
          </Box>
          <Text> </Text>
          <Text bold color={activeField === 1 ? "cyanBright" : undefined}>Timeframe:</Text>
          {TIMEFRAMES.map((tf, i) => {
            const isFocused = activeField === 1 && i === tfCursor;
            return (
              <Box key={tf} paddingLeft={2}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? "\u25B8 " : "  "}{tf}
                </Text>
              </Box>
            );
          })}
          <Text> </Text>
          <Text dimColor>Tab switch fields {"\u00b7"} Enter next {"\u00b7"} Esc back</Text>
        </Box>
      )}

      {/* Step 2: Dates + capital */}
      {step === 2 && (
        <Box flexDirection="column">
          <Box>
            <Text bold color={activeField === 0 ? "cyanBright" : undefined}>Start Date: </Text>
            <Text>{startDate}</Text>
            {activeField === 0 && <Text color="cyanBright">{"\u2588"}</Text>}
          </Box>
          <Box>
            <Text bold color={activeField === 1 ? "cyanBright" : undefined}>End Date:   </Text>
            <Text>{endDate}</Text>
            {activeField === 1 && <Text color="cyanBright">{"\u2588"}</Text>}
          </Box>
          <Box>
            <Text bold color={activeField === 2 ? "cyanBright" : undefined}>Capital:    $</Text>
            <Text>{capital}</Text>
            {activeField === 2 && <Text color="cyanBright">{"\u2588"}</Text>}
          </Box>
          <Text> </Text>
          <Text dimColor>Tab switch fields {"\u00b7"} Enter next {"\u00b7"} Esc back</Text>
        </Box>
      )}

      {/* Step 3: Optimization mode */}
      {step === 3 && (
        <Box flexDirection="column">
          <Text bold>Optimization Mode:</Text>
          {OPT_MODES.map((m, i) => {
            const isFocused = i === optCursor;
            const desc = m === "none" ? "No optimization" : m === "grid" ? "Grid search over parameter space" : "Random parameter sampling";
            return (
              <Box key={m} paddingLeft={2}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? "\u25B8 " : "  "}{m.toUpperCase()}
                </Text>
                <Text dimColor> {"\u2014"} {desc}</Text>
              </Box>
            );
          })}
          <Text> </Text>
          <Text dimColor>{"\u2191\u2193"} select {"\u00b7"} Enter next {"\u00b7"} Esc back</Text>
        </Box>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <Box flexDirection="column">
          <Text bold>Review Configuration:</Text>
          <Text> </Text>
          <Box paddingLeft={2} flexDirection="column">
            <Box><Text dimColor>Strategy:     </Text><Text bold>{strategies[strategyCursor]}</Text></Box>
            <Box><Text dimColor>Symbol:       </Text><Text bold>{symbol || "BTCUSD"}</Text></Box>
            <Box><Text dimColor>Timeframe:    </Text><Text bold>{TIMEFRAMES[tfCursor]}</Text></Box>
            <Box><Text dimColor>Period:       </Text><Text>{startDate} to {endDate}</Text></Box>
            <Box><Text dimColor>Capital:      </Text><Text>${capital}</Text></Box>
            <Box><Text dimColor>Optimization: </Text><Text>{(OPT_MODES[optCursor] ?? "none").toUpperCase()}</Text></Box>
          </Box>
          <Text> </Text>
          <Text bold color="green">Press Enter to run backtest</Text>
          <Text dimColor>Esc go back</Text>
        </Box>
      )}
    </Dialog>
  );
}
