/**
 * ExecutionAlgoSelector — Execution algorithm picker
 *
 * Presents available execution algorithms when placing an order,
 * using the ink-ui Select component:
 *
 *   EXECUTION · AAPL · 500 shares @ $185.50
 *   ┌──────────────────────────────────────┐
 *   │  Market       Immediate fill         │
 *   │  Limit        Fill at target price   │
 *   │  TWAP         Time-weighted average  │
 *   │  VWAP         Volume-weighted avg    │
 *   │  Iceberg      Hidden size            │
 *   └──────────────────────────────────────┘
 *
 * Pattern: Claude Code Select in approval dialog.
 */

import React from "react";
import { Box, Text } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

// ============================================================================
// Types
// ============================================================================

export type AlgoType = "market" | "limit" | "twap" | "vwap" | "iceberg";

export interface AlgoOption {
  type: AlgoType;
  name: string;
  description: string;
  estimatedSlippage: string;
  recommendedFor: string;
}

interface Props {
  onSelect: (algo: AlgoType) => void;
  symbol: string;
  size: number;
  currentPrice: number;
}

// ============================================================================
// Algo definitions
// ============================================================================

const ALGOS: AlgoOption[] = [
  {
    type: "market",
    name: "Market",
    description: "Immediate execution at best available price",
    estimatedSlippage: "0.05-0.15%",
    recommendedFor: "Urgent fills, high liquidity",
  },
  {
    type: "limit",
    name: "Limit",
    description: "Execute only at specified price or better",
    estimatedSlippage: "0%",
    recommendedFor: "Price-sensitive orders, patient entry",
  },
  {
    type: "twap",
    name: "TWAP",
    description: "Split order evenly across time window",
    estimatedSlippage: "0.02-0.08%",
    recommendedFor: "Large orders, low urgency",
  },
  {
    type: "vwap",
    name: "VWAP",
    description: "Distribute order weighted by volume profile",
    estimatedSlippage: "0.01-0.05%",
    recommendedFor: "Institutional size, benchmark tracking",
  },
  {
    type: "iceberg",
    name: "Iceberg",
    description: "Show only small visible portion of full size",
    estimatedSlippage: "0.03-0.10%",
    recommendedFor: "Large orders, minimize market impact",
  },
];

// ============================================================================
// Component
// ============================================================================

export function ExecutionAlgoSelector({ onSelect, symbol, size, currentPrice }: Props) {
  const selectOptions = ALGOS.map((algo) => ({
    label: `${algo.name.padEnd(10)} ${algo.description}`,
    value: algo.type,
  }));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
    >
      {/* Header */}
      <Box>
        <Text bold color="cyan">EXECUTION</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text bold>{symbol}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text>{size.toLocaleString()} shares @ ${currentPrice.toFixed(2)}</Text>
      </Box>

      {/* Algo details table */}
      <Box flexDirection="column" paddingLeft={2} marginTop={1}>
        {ALGOS.map((algo) => (
          <Box key={algo.type}>
            <Box width={10}>
              <Text bold>{algo.name}</Text>
            </Box>
            <Box width={14}>
              <Text dimColor>slip: {algo.estimatedSlippage}</Text>
            </Box>
            <Text dimColor>{algo.recommendedFor}</Text>
          </Box>
        ))}
      </Box>

      {/* Select */}
      <Box paddingLeft={2} marginTop={1} flexDirection="column">
        <Text dimColor>Select algorithm:</Text>
        <Select
          options={selectOptions}
          onChange={(value) => onSelect(value as AlgoType)}
        />
      </Box>
    </Box>
  );
}
