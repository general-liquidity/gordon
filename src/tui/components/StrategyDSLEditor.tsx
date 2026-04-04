/**
 * StrategyDSLEditor — Form-based strategy builder
 *
 * Form fields for building a DSL strategy with entry/exit conditions,
 * position sizing, and risk parameters. Live JSON preview at bottom.
 *
 * Pattern: Claude Code multi-field form dialog with preview.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Dialog } from "../design-system/Dialog.js";

// ============================================================================
// Types
// ============================================================================

export interface Condition {
  indicator: string;
  operator: ">" | "<" | "=" | "crosses_above" | "crosses_below";
  value: number;
}

export interface DSLStrategy {
  name: string;
  entryConditions: Condition[];
  exitConditions: Condition[];
  positionSizing: string;
  riskParams: { stopLoss: number; takeProfit: number };
}

interface Props {
  onSave: (strategy: DSLStrategy) => void;
  onCancel: () => void;
  initialStrategy?: DSLStrategy;
}

// ============================================================================
// Constants
// ============================================================================

const OPERATORS: Condition["operator"][] = [">", "<", "=", "crosses_above", "crosses_below"];
const SIZING_OPTIONS = ["fixed", "kelly", "risk_parity", "equal_weight", "volatility_adjusted"];

const DEFAULT_STRATEGY: DSLStrategy = {
  name: "",
  entryConditions: [{ indicator: "RSI", operator: "<", value: 30 }],
  exitConditions: [{ indicator: "RSI", operator: ">", value: 70 }],
  positionSizing: "fixed",
  riskParams: { stopLoss: 2, takeProfit: 6 },
};

type FieldId = "name" | "entry" | "exit" | "sizing" | "stopLoss" | "takeProfit";
const FIELD_ORDER: FieldId[] = ["name", "entry", "exit", "sizing", "stopLoss", "takeProfit"];

// ============================================================================
// Helpers
// ============================================================================

function conditionToString(c: Condition): string {
  return `${c.indicator} ${c.operator} ${c.value}`;
}

// ============================================================================
// Component
// ============================================================================

export function StrategyDSLEditor({ onSave, onCancel, initialStrategy }: Props) {
  const [strategy, setStrategy] = useState<DSLStrategy>(
    initialStrategy ?? { ...DEFAULT_STRATEGY }
  );
  const [fieldIdx, setFieldIdx] = useState(0);
  const [nameBuffer, setNameBuffer] = useState(strategy.name);
  const [stopBuffer, setStopBuffer] = useState(String(strategy.riskParams.stopLoss));
  const [tpBuffer, setTpBuffer] = useState(String(strategy.riskParams.takeProfit));
  const [sizingIdx, setSizingIdx] = useState(SIZING_OPTIONS.indexOf(strategy.positionSizing) || 0);

  const currentField = FIELD_ORDER[fieldIdx]!;

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    // Tab to next field
    if (key.tab) {
      setFieldIdx((i) => (i + 1) % FIELD_ORDER.length);
      return;
    }

    // Enter on last field = save
    if (key.return && currentField === "takeProfit") {
      const finalStrategy: DSLStrategy = {
        ...strategy,
        name: nameBuffer || "Untitled",
        positionSizing: SIZING_OPTIONS[sizingIdx] ?? "fixed",
        riskParams: {
          stopLoss: Number(stopBuffer) || 2,
          takeProfit: Number(tpBuffer) || 6,
        },
      };
      onSave(finalStrategy);
      return;
    }

    // Enter on other fields = advance
    if (key.return) {
      setFieldIdx((i) => Math.min(FIELD_ORDER.length - 1, i + 1));
      return;
    }

    // Field-specific input handling
    if (currentField === "name") {
      if (key.backspace || key.delete) {
        setNameBuffer((s) => s.slice(0, -1));
      } else if (input && !key.upArrow && !key.downArrow) {
        setNameBuffer((s) => s + input);
      }
    }

    if (currentField === "sizing") {
      if (key.upArrow) setSizingIdx((c) => Math.max(0, c - 1));
      if (key.downArrow) setSizingIdx((c) => Math.min(SIZING_OPTIONS.length - 1, c + 1));
    }

    if (currentField === "stopLoss") {
      if (key.backspace || key.delete) {
        setStopBuffer((s) => s.slice(0, -1));
      } else if (input && !key.upArrow && !key.downArrow) {
        setStopBuffer((s) => s + input);
      }
    }

    if (currentField === "takeProfit") {
      if (key.backspace || key.delete) {
        setTpBuffer((s) => s.slice(0, -1));
      } else if (input && !key.upArrow && !key.downArrow) {
        setTpBuffer((s) => s + input);
      }
    }

    // Entry/exit condition management
    if (currentField === "entry" || currentField === "exit") {
      const isEntry = currentField === "entry";
      if (input === "a") {
        // Add new condition
        const newCond: Condition = { indicator: "SMA", operator: ">", value: 0 };
        setStrategy((s) => ({
          ...s,
          [isEntry ? "entryConditions" : "exitConditions"]: [
            ...s[isEntry ? "entryConditions" : "exitConditions"],
            newCond,
          ],
        }));
      }
      if (input === "d") {
        // Remove last condition
        setStrategy((s) => {
          const arr = s[isEntry ? "entryConditions" : "exitConditions"];
          if (arr.length <= 1) return s;
          return {
            ...s,
            [isEntry ? "entryConditions" : "exitConditions"]: arr.slice(0, -1),
          };
        });
      }
    }
  });

  const preview: DSLStrategy = {
    name: nameBuffer || "Untitled",
    entryConditions: strategy.entryConditions,
    exitConditions: strategy.exitConditions,
    positionSizing: SIZING_OPTIONS[sizingIdx] ?? "fixed",
    riskParams: {
      stopLoss: Number(stopBuffer) || 2,
      takeProfit: Number(tpBuffer) || 6,
    },
  };

  return (
    <Dialog title="STRATEGY BUILDER" subtitle="Build a DSL strategy" color="cyan" onClose={onCancel}>
      {/* Name */}
      <Box>
        <Text bold color={currentField === "name" ? "cyanBright" : undefined}>Name: </Text>
        <Text>{nameBuffer || "..."}</Text>
        {currentField === "name" && <Text color="cyanBright">{"\u2588"}</Text>}
      </Box>

      {/* Entry conditions */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={currentField === "entry" ? "cyanBright" : undefined}>
          Entry Conditions:
        </Text>
        {strategy.entryConditions.map((c, i) => (
          <Box key={`entry-${i}`} paddingLeft={2}>
            <Text dimColor>{i + 1}. </Text>
            <Text>{conditionToString(c)}</Text>
          </Box>
        ))}
        {currentField === "entry" && (
          <Text dimColor paddingLeft={2}>a=add d=remove</Text>
        )}
      </Box>

      {/* Exit conditions */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={currentField === "exit" ? "cyanBright" : undefined}>
          Exit Conditions:
        </Text>
        {strategy.exitConditions.map((c, i) => (
          <Box key={`exit-${i}`} paddingLeft={2}>
            <Text dimColor>{i + 1}. </Text>
            <Text>{conditionToString(c)}</Text>
          </Box>
        ))}
        {currentField === "exit" && (
          <Text dimColor paddingLeft={2}>a=add d=remove</Text>
        )}
      </Box>

      {/* Position sizing */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={currentField === "sizing" ? "cyanBright" : undefined}>
          Position Sizing:
        </Text>
        {currentField === "sizing" ? (
          SIZING_OPTIONS.map((opt, i) => (
            <Box key={opt} paddingLeft={2}>
              <Text color={i === sizingIdx ? "cyanBright" : undefined}>
                {i === sizingIdx ? "\u25B8 " : "  "}{opt}
              </Text>
            </Box>
          ))
        ) : (
          <Box paddingLeft={2}>
            <Text>{SIZING_OPTIONS[sizingIdx]}</Text>
          </Box>
        )}
      </Box>

      {/* Risk params */}
      <Box marginTop={1}>
        <Text bold color={currentField === "stopLoss" ? "cyanBright" : undefined}>Stop Loss: </Text>
        <Text>{stopBuffer}%</Text>
        {currentField === "stopLoss" && <Text color="cyanBright">{"\u2588"}</Text>}
        <Text>  </Text>
        <Text bold color={currentField === "takeProfit" ? "cyanBright" : undefined}>Take Profit: </Text>
        <Text>{tpBuffer}%</Text>
        {currentField === "takeProfit" && <Text color="cyanBright">{"\u2588"}</Text>}
      </Box>

      {/* JSON preview */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{"\u2500".repeat(40)}</Text>
        <Text dimColor>Preview:</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{JSON.stringify(preview, null, 2).slice(0, 200)}</Text>
        </Box>
      </Box>

      <Text> </Text>
      <Text dimColor>Tab next field {"\u00b7"} Enter advance/save {"\u00b7"} Esc cancel</Text>
    </Dialog>
  );
}
