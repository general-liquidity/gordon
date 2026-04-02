import React from "react";
import { Box, Text } from "ink";
import { fitColumnWidths, truncateWithEllipsis, useMeasuredWidth } from "../../layout.ts";
import { COLORS } from "../../theme.ts";
import type { DeskTone } from "../desk/DeskPanel.tsx";

export interface DataTableColumn<Row extends Record<string, string>> {
  key: keyof Row;
  label: string;
  width?: number;
  align?: "left" | "right";
}

export interface DataTableRow<Row extends Record<string, string>> {
  id: string;
  values: Row;
  tone?: DeskTone;
  active?: boolean;
}

interface DataTableProps<Row extends Record<string, string>> {
  columns: Array<DataTableColumn<Row>>;
  rows: Array<DataTableRow<Row>>;
  emptyTitle: string;
  emptyDetail?: string;
}

function toneColor(tone?: DeskTone): string {
  switch (tone) {
    case "success":
      return COLORS.MONEY;
    case "danger":
      return COLORS.RISK;
    case "warning":
      return COLORS.AMBER;
    case "analysis":
      return COLORS.VIOLET;
    case "info":
      return COLORS.ICE;
    case "operate":
      return COLORS.ORANGE;
    case "brand":
      return COLORS.BRASS;
    default:
      return COLORS.WHITE;
  }
}

export function DataTable<Row extends Record<string, string>>({
  columns,
  rows,
  emptyTitle,
  emptyDetail,
}: DataTableProps<Row>): React.ReactElement {
  const { ref, width } = useMeasuredWidth(96);
  const requestedWidths = columns.map((column) => {
    if (column.width) {
      return column.width;
    }

    const maxValueWidth = rows.reduce((max, row) => {
      const value = row.values[column.key];
      return Math.max(max, String(value ?? "").length);
    }, column.label.length);
    return Math.max(8, Math.min(22, maxValueWidth + 2));
  });
  const colWidths = fitColumnWidths({
    widths: requestedWidths,
    maxTotalWidth: Math.max(28, width - 4),
    minWidth: 6,
  });

  return (
    <Box ref={ref} flexDirection="column">
      <Box>
        {columns.map((column, index) => {
          const colWidth = colWidths[index] ?? 10;
          return (
            <Box
              key={String(column.key)}
              width={colWidth}
              justifyContent={column.align === "right" ? "flex-end" : "flex-start"}
            >
              <Text color={COLORS.BRASS} bold>
                {truncateWithEllipsis(column.label, Math.max(4, colWidth - 1))}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box>
        <Text color={COLORS.BRASS_DIM}>
          {"─".repeat(Math.max(18, colWidths.reduce((sum, colWidth) => sum + colWidth, 0)))}
        </Text>
      </Box>

      {rows.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.WHITE}>{emptyTitle}</Text>
          {emptyDetail && (
            <Text color={COLORS.DIM}>{emptyDetail}</Text>
          )}
        </Box>
      ) : (
        rows.map((row) => (
          <Box key={row.id}>
            {columns.map((column, index) => {
              const colWidth = colWidths[index] ?? 10;
              const value = row.values[column.key] ?? "";
              const renderedValue = row.active && index === 0
                ? `› ${String(value)}`
                : String(value);
              return (
                <Box
                  key={`${row.id}-${String(column.key)}`}
                  width={colWidth}
                  justifyContent={column.align === "right" ? "flex-end" : "flex-start"}
                >
                  <Text
                    color={row.active ? COLORS.WHITE : toneColor(row.tone)}
                    bold={row.active}
                  >
                    {truncateWithEllipsis(renderedValue, Math.max(4, colWidth - 1))}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))
      )}
    </Box>
  );
}

export default DataTable;
