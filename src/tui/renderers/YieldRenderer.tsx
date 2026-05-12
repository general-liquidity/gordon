/**
 * YieldRenderer — Renders DeFiLlama yield data
 *
 * DataTable with PROTOCOL/POOL/TVL/APY/CHAIN columns.
 * APY coloring: >20% green bold, 10-20% green, 5-10% yellow, <5% default.
 * Summary row: "N pools - avg APY X%".
 *
 * Pattern: Claude Code structured output renderer (DataTable-based).
 */

import React from "react";
import { Box, Text } from "../ink-custom";
import { DataTable, fmtNum, type Column } from "../components/charts/DataTable.tsx";

// ============================================================================
// Types
// ============================================================================

export interface YieldData {
  protocol: string;
  pool: string;
  tvl: number;
  apy: number;
  chain: string;
}

interface Props {
  data: YieldData[];
}

// ============================================================================
// Column definitions
// ============================================================================

const COLUMNS: Column<YieldData>[] = [
  {
    key: "protocol",
    header: "PROTOCOL",
    width: 14,
    format: (v) => String(v),
  },
  {
    key: "pool",
    header: "POOL",
    width: 16,
    format: (v) => String(v),
  },
  {
    key: "tvl",
    header: "TVL",
    width: 12,
    align: "right",
    format: (v) => `$${fmtNum(Number(v))}`,
  },
  {
    key: "apy",
    header: "APY",
    width: 10,
    align: "right",
    format: (v) => `${Number(v).toFixed(1)}%`,
    color: (v) => {
      const n = Number(v);
      if (n >= 20) return "green";
      if (n >= 10) return "green";
      if (n >= 5) return "yellow";
      return undefined;
    },
  },
  {
    key: "chain",
    header: "CHAIN",
    width: 12,
    format: (v) => String(v),
  },
];

// ============================================================================
// Component
// ============================================================================

export function YieldRenderer({ data }: Props) {
  const avgApy = data.length > 0
    ? data.reduce((sum, d) => sum + d.apy, 0) / data.length
    : 0;

  const summaryRow: Record<string, string> = {
    protocol: `${data.length} pools`,
    apy: `avg ${avgApy.toFixed(1)}%`,
  };

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text bold color="cyanBright">YIELD OPPORTUNITIES</Text>
        {data.length > 0 && <Text dimColor> ({data.length})</Text>}
      </Box>
      <DataTable
        columns={COLUMNS as unknown as Column[]}
        data={data as unknown as Record<string, unknown>[]}
        summaryRow={data.length > 0 ? summaryRow : undefined}
      />
    </Box>
  );
}
