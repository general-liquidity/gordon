import React from "react";
import {
  DataTable,
  fmtNum,
  fmtPct,
  changeColor,
  type Column,
} from "../components/charts/DataTable.tsx";

/**
 * ScanResultRenderer -- Market scan results table
 * Phase 10: SYM(8) LAST(10,right) CHG%(8,right,colored) VOL(10,right) SIGNAL(12)
 */

interface ScanRow {
  symbol: string;
  price: number;
  changePct: number;
  volume: number;
  signal: string;
}

interface Props {
  data: ScanRow[];
}

const COLUMNS: Column<ScanRow>[] = [
  { key: "symbol", header: "SYM", width: 8, align: "left" },
  {
    key: "price",
    header: "LAST",
    width: 10,
    align: "right",
    format: (v) => fmtNum(Number(v)),
  },
  {
    key: "changePct",
    header: "CHG%",
    width: 8,
    align: "right",
    format: (v) => fmtPct(Number(v)),
    color: (v) => changeColor(Number(v)),
  },
  {
    key: "volume",
    header: "VOL",
    width: 10,
    align: "right",
    format: (v) => fmtNum(Number(v)),
  },
  { key: "signal", header: "SIGNAL", width: 12, align: "left" },
];

export function ScanResultRenderer({ data }: Props) {
  return (
    <DataTable
      columns={COLUMNS as unknown as Column<Record<string, unknown>>[]}
      data={data as unknown as Record<string, unknown>[]}
    />
  );
}
