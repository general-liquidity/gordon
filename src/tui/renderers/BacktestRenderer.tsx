import React from "react";
import { Box } from "ink";
import { DataTable, fmtPct, type Column } from "../components/DataTable.js";
import { InlineChart } from "../components/InlineChart.js";

/**
 * BacktestRenderer -- Backtest metrics DataTable + InlineChart equity curve
 * Phase 10
 */

interface BacktestData {
  strategy: string;
  symbol: string;
  period: string;
  returnPct: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  equityCurve?: number[];
}

interface Props {
  data: BacktestData;
}

export function BacktestRenderer({ data }: Props) {
  const rows: Record<string, unknown>[] = [
    { metric: "STRATEGY", value: data.strategy },
    { metric: "SYMBOL", value: data.symbol },
    { metric: "PERIOD", value: data.period },
    { metric: "RETURN", value: fmtPct(data.returnPct) },
    { metric: "SHARPE", value: data.sharpe.toFixed(2) },
    { metric: "MAX DD", value: fmtPct(-Math.abs(data.maxDrawdown)) },
    { metric: "WIN RATE", value: fmtPct(data.winRate) },
    { metric: "TRADES", value: String(data.trades) },
  ];

  const columns: Column[] = [
    { key: "metric", header: "METRIC", width: 12, align: "left" },
    { key: "value", header: "VALUE", width: 16, align: "right" },
  ];

  return (
    <Box flexDirection="column">
      <DataTable columns={columns} data={rows} />
      {data.equityCurve && data.equityCurve.length > 2 && (
        <Box paddingLeft={2} marginTop={1}>
          <InlineChart data={data.equityCurve} width={30} />
        </Box>
      )}
    </Box>
  );
}
