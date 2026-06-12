import React from "react";
import { Box, Text } from "../../ink-custom";

// ============================================================================
// DataTable — Ticker-grade inline table (NO borders, aligned columns)
//
// Claude Code style: plain aligned columns with color. No box-drawing chars.
//
// SYM      LAST       CHG%     VOL       SIGNAL
// BTC      67,432    +2.14%    1.2B      BREAKOUT
// ETH       3,821    +1.82%    890M      SUPPORT
// ============================================================================

export interface Column<T = Record<string, unknown>> {
  key: string;
  header: string;
  width: number;
  align?: "left" | "right";
  color?: (value: unknown, row: T) => string | undefined;
  format?: (value: unknown, row: T) => string;
}

interface Props<T = Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  summaryRow?: Record<string, string>;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  summaryRow,
}: Props<T>) {
  if (data.length === 0) {
    return <Text dimColor>  No data.</Text>;
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {/* Header row */}
      <Box>
        {columns.map((col) => (
          <Box key={col.key} width={col.width}>
            <Text bold dimColor>
              {col.align === "right" ? padLeft(col.header, col.width) : padRight(col.header, col.width)}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Data rows */}
      {data.map((row, rowIdx) => (
        <DataTableRow key={rowIdx} row={row} columns={columns} />
      ))}

      {/* Summary row */}
      {summaryRow && (
        <>
          <Box>
            {columns.map((col) => (
              <Box key={col.key} width={col.width}>
                <Text dimColor>{"\u2500".repeat(col.width)}</Text>
              </Box>
            ))}
          </Box>
          <Box>
            {columns.map((col) => {
              const val = summaryRow[col.key] ?? "";
              const aligned = col.align === "right" ? padLeft(val, col.width) : padRight(val, col.width);
              return (
                <Box key={col.key} width={col.width}>
                  <Text bold>{aligned}</Text>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
}

const DataTableRowInner = function DataTableRow<T extends Record<string, unknown>>({
  row,
  columns,
}: {
  row: T;
  columns: Column<T>[];
}) {
  return (
    <Box>
      {columns.map((col) => {
        const raw = row[col.key];
        const formatted = col.format ? col.format(raw, row) : formatValue(raw);
        const cellColor = col.color ? col.color(raw, row) : undefined;
        const aligned = col.align === "right" ? padLeft(formatted, col.width) : padRight(formatted, col.width);

        return (
          <Box key={col.key} width={col.width}>
            <Text color={cellColor}>{aligned}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

const DataTableRow = React.memo(DataTableRowInner) as typeof DataTableRowInner;

// ============================================================================
// Formatting helpers
// ============================================================================

function formatValue(value: unknown): string {
  if (value == null) return "\u2014";
  if (typeof value === "number") return fmtNum(value);
  return String(value);
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

export function fmtNum(n: number): string {
  if (Number.isNaN(n)) return "\u2014";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1_000_000) formatted = (n / 1_000_000).toFixed(1) + "M";
  else if (abs >= 1_000) formatted = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else if (abs >= 1) formatted = n.toFixed(2);
  else if (abs >= 0.01) formatted = n.toFixed(4);
  else formatted = n.toFixed(6);
  if (formatted.includes(".")) formatted = formatted.replace(/0+$/, "").replace(/\.$/, "");
  return formatted;
}

export function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function timeAgo(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}
