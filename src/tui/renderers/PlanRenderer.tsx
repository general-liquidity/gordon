import React from "react";
import { Box, Text } from "../ink-custom";
import { DataTable, fmtNum, type Column } from "../components/DataTable.js";

/**
 * PlanRenderer -- Trade plan / ticket view
 * Phase 10: Header (symbol + side colored) + DataTable for ticket fields
 */

interface PlanData {
  symbol: string;
  side: string;
  entry: number;
  stop: number;
  targets: number[];
  size: number;
  risk: number;
  riskPct: number;
  venue: string;
  reviewState: string;
}

interface Props {
  data: PlanData;
}

export function PlanRenderer({ data }: Props) {
  const sideColor =
    data.side.toLowerCase() === "long" || data.side.toLowerCase() === "buy"
      ? "green"
      : "red";

  const rows: Record<string, unknown>[] = [
    { field: "ENTRY", value: fmtNum(data.entry) },
    { field: "STOP", value: fmtNum(data.stop) },
    {
      field: "TARGETS",
      value: data.targets.map((t) => fmtNum(t)).join(" / "),
    },
    { field: "SIZE", value: fmtNum(data.size) },
    {
      field: "RISK",
      value: `${fmtNum(data.risk)} (${data.riskPct.toFixed(1)}%)`,
    },
    { field: "VENUE", value: data.venue },
  ];

  const columns: Column[] = [
    { key: "field", header: "FIELD", width: 10, align: "left" },
    { key: "value", header: "VALUE", width: 24, align: "right" },
  ];

  const reviewColor =
    data.reviewState === "approved"
      ? "green"
      : data.reviewState === "rejected"
        ? "red"
        : "yellow";

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {/* Header: symbol + side colored */}
      <Box>
        <Text bold color="cyanBright">
          {data.symbol}
        </Text>
        <Text> </Text>
        <Text bold color={sideColor}>
          {data.side.toUpperCase()}
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text color={reviewColor}>{data.reviewState}</Text>
      </Box>

      {/* Ticket fields table */}
      <DataTable columns={columns} data={rows} />
    </Box>
  );
}
