import React from "react";
import {
  DataTable,
  fmtNum,
  fmtPct,
  changeColor,
  type Column,
} from "../components/charts/DataTable.tsx";

/**
 * PositionRenderer -- Open positions table with colored PNL + summary row
 * Phase 10: SYM / SIDE / QTY / ENTRY / LAST / PNL / PNL%
 */

interface PositionRow {
  symbol: string;
  side: string;
  qty: number;
  entry: number;
  last: number;
  pnl: number;
  pnlPct: number;
}

interface Props {
  data: PositionRow[];
}

const COLUMNS: Column<PositionRow>[] = [
  { key: "symbol", header: "SYM", width: 8, align: "left" },
  {
    key: "side",
    header: "SIDE",
    width: 6,
    align: "left",
    color: (v) =>
      String(v).toLowerCase().includes("long") ||
      String(v).toLowerCase().includes("buy")
        ? "green"
        : "red",
  },
  {
    key: "qty",
    header: "QTY",
    width: 10,
    align: "right",
    format: (v) => fmtNum(Number(v)),
  },
  {
    key: "entry",
    header: "ENTRY",
    width: 10,
    align: "right",
    format: (v) => fmtNum(Number(v)),
  },
  {
    key: "last",
    header: "LAST",
    width: 10,
    align: "right",
    format: (v) => fmtNum(Number(v)),
  },
  {
    key: "pnl",
    header: "PNL",
    width: 10,
    align: "right",
    format: (v) => fmtNum(Number(v)),
    color: (v) => changeColor(Number(v)),
  },
  {
    key: "pnlPct",
    header: "PNL%",
    width: 8,
    align: "right",
    format: (v) => fmtPct(Number(v)),
    color: (v) => changeColor(Number(v)),
  },
];

export function PositionRenderer({ data }: Props) {
  const totalPnl = data.reduce((sum, r) => sum + r.pnl, 0);
  const summaryRow: Record<string, string> = {
    symbol: "TOTAL",
    pnl: fmtNum(totalPnl),
  };

  return (
    <DataTable
      columns={COLUMNS as unknown as Column<Record<string, unknown>>[]}
      data={data as unknown as Record<string, unknown>[]}
      summaryRow={summaryRow}
    />
  );
}
