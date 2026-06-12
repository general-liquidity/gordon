import React from "react";
import {
  DataTable,
  fmtNum,
  type Column,
} from "../components/charts/DataTable.tsx";
import { getMoneyColor } from "../design-system/colorMap.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

/**
 * StrategyRenderer -- Strategy overview table
 * Phase 10: NAME(14) STATUS(10) PNL(10,right,colored) SHARPE(8,right) TRADES(8,right)
 */

interface StrategyRow {
  name: string;
  status: string;
  pnl: number;
  sharpe: number;
  trades: number;
}

interface Props {
  data: StrategyRow[];
}

export function StrategyRenderer({ data }: Props) {
  const theme = useTheme();
  const columns: Column<StrategyRow>[] = [
    { key: "name", header: "NAME", width: 14, align: "left" },
    {
      key: "status",
      header: "STATUS",
      width: 10,
      align: "left",
      color: (v) => {
        const s = String(v).toLowerCase();
        if (s === "active" || s === "running") return theme.riskSafe;
        if (s === "paused" || s === "stopped") return theme.riskWarning;
        if (s === "error" || s === "failed") return theme.riskDanger;
        return undefined;
      },
    },
    {
      key: "pnl",
      header: "PNL",
      width: 10,
      align: "right",
      format: (v) => fmtNum(Number(v)),
      color: (v) => getMoneyColor(Number(v), theme),
    },
    {
      key: "sharpe",
      header: "SHARPE",
      width: 8,
      align: "right",
      format: (v) => Number(v).toFixed(2),
    },
    {
      key: "trades",
      header: "TRADES",
      width: 8,
      align: "right",
      format: (v) => String(Number(v)),
    },
  ];
  const totalPnl = data.reduce((sum, r) => sum + r.pnl, 0);
  const totalTrades = data.reduce((sum, r) => sum + r.trades, 0);
  const summaryRow: Record<string, string> = {
    name: "TOTAL",
    pnl: fmtNum(totalPnl),
    trades: String(totalTrades),
  };

  return (
    <DataTable
      columns={columns as unknown as Column<Record<string, unknown>>[]}
      data={data as unknown as Record<string, unknown>[]}
      summaryRow={summaryRow}
    />
  );
}
