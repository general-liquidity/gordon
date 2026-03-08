/**
 * Rich Table Component
 * Displays structured data with formatting and colors
 */

import React from "react";
import { Box, Text } from "ink";
import { fitColumnWidths, truncateWithEllipsis, useMeasuredWidth } from "../layout.ts";
import { COLORS } from "../theme.ts";

export type ColumnType = "text" | "number" | "currency" | "percent" | "change";

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
  type?: ColumnType;
  align?: "left" | "right" | "center";
}

export interface RichTableProps {
  columns: TableColumn[];
  data: Record<string, unknown>[];
  title?: string;
  maxRows?: number;
  showRank?: boolean;
}

function formatValue(value: unknown, type: ColumnType = "text"): string {
  if (value === null || value === undefined) return "-";

  switch (type) {
    case "number":
      if (typeof value === "number") {
        return value.toLocaleString();
      }
      return String(value);

    case "currency":
      if (typeof value === "number") {
        if (value >= 1000000) {
          return `$${(value / 1000000).toFixed(2)}M`;
        } else if (value >= 1000) {
          return `$${(value / 1000).toFixed(2)}K`;
        }
        return `$${value.toFixed(2)}`;
      }
      return String(value);

    case "percent":
      if (typeof value === "number") {
        return `${value.toFixed(2)}%`;
      }
      return String(value);

    case "change":
      if (typeof value === "number") {
        const sign = value >= 0 ? "+" : "";
        return `${sign}${value.toFixed(2)}%`;
      }
      return String(value);

    default:
      return String(value);
  }
}

function getValueColor(value: unknown, type: ColumnType = "text"): string {
  if (type === "change" || type === "percent") {
    if (typeof value === "number") {
      if (value > 0) return COLORS.GREEN;
      if (value < 0) return COLORS.RED;
    }
  }
  return COLORS.WHITE;
}

function getAlign(type: ColumnType = "text"): "left" | "right" | "center" {
  switch (type) {
    case "number":
    case "currency":
    case "percent":
    case "change":
      return "right";
    default:
      return "left";
  }
}

export const RichTable: React.FC<RichTableProps> = ({
  columns,
  data,
  title,
  maxRows = 10,
  showRank = false,
}) => {
  const visibleData = data.slice(0, maxRows);
  const hasMore = data.length > maxRows;
  const { ref, width } = useMeasuredWidth(96);

  // Calculate column widths
  const requestedWidths = columns.map((col) => {
    if (col.width) return col.width;
    // Auto-calculate based on header and data
    const headerLen = col.header.length;
    const maxDataLen = Math.max(
      ...visibleData.map((row) => {
        const val = row[col.key];
        return formatValue(val, col.type).length;
      }),
      0
    );
    return Math.max(headerLen, maxDataLen) + 2;
  });
  const rankWidth = showRank ? 4 : 0;
  const colWidths = fitColumnWidths({
    widths: requestedWidths,
    maxTotalWidth: Math.max(24, width - rankWidth - 2),
    minWidth: 6,
  });

  return (
    <Box ref={ref} flexDirection="column" marginY={1}>
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text color={COLORS.ACCENT} bold>
            {title}
          </Text>
        </Box>
      )}

      {/* Header row */}
      <Box>
        {showRank && (
          <Box width={rankWidth}>
            <Text color={COLORS.DIM} bold>
              #
            </Text>
          </Box>
        )}
        {columns.map((col, i) => {
          const width = colWidths[i] ?? 10;
          const align = col.align ?? getAlign(col.type);
          return (
            <Box key={col.key} width={width} justifyContent={align === "right" ? "flex-end" : "flex-start"}>
              <Text color={COLORS.ACCENT_DIM} bold>
                {col.header}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Separator */}
      <Box>
        <Text color={COLORS.DIM}>
          {"-".repeat(rankWidth + colWidths.reduce((a, b) => a + b, 0))}
        </Text>
      </Box>

      {/* Data rows */}
      {visibleData.length === 0 ? (
        <Box paddingY={1}>
          <Text color={COLORS.DIM} italic>
            No data available
          </Text>
        </Box>
      ) : (
        visibleData.map((row, rowIndex) => (
          <Box key={rowIndex}>
            {showRank && (
              <Box width={rankWidth}>
                <Text color={COLORS.DIM}>{rowIndex + 1}</Text>
              </Box>
            )}
            {columns.map((col, colIndex) => {
              const width = colWidths[colIndex] ?? 10;
              const value = row[col.key];
              const formatted = formatValue(value, col.type);
              const color = getValueColor(value, col.type);
              const align = col.align ?? getAlign(col.type);

              return (
                <Box
                  key={col.key}
                  width={width}
                  justifyContent={align === "right" ? "flex-end" : "flex-start"}
                >
                  <Text color={color}>{truncateWithEllipsis(formatted, Math.max(4, width - 1))}</Text>
                </Box>
              );
            })}
          </Box>
        ))
      )}

      {/* More indicator */}
      {hasMore && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM} italic>
            ...and {data.length - maxRows} more
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Simple key-value display for details
 */
export interface KeyValuePair {
  label: string;
  value: string | number;
  color?: string;
}

export interface KeyValueListProps {
  items: KeyValuePair[];
  title?: string;
  labelWidth?: number;
}

export const KeyValueList: React.FC<KeyValueListProps> = ({
  items,
  title,
  labelWidth = 16,
}) => {
  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color={COLORS.ACCENT} bold>
            {title}
          </Text>
        </Box>
      )}
      {items.map((item, index) => (
        <Box key={index}>
          <Box width={labelWidth}>
            <Text color={COLORS.DIM}>{item.label}:</Text>
          </Box>
          <Text color={item.color ?? COLORS.WHITE}>{item.value}</Text>
        </Box>
      ))}
    </Box>
  );
};

export default RichTable;
