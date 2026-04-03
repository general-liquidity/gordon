import React from "react";
import { Box, Text } from "ink";

/**
 * InlineTable -- Pipe-separated markdown tables rendered as aligned columns
 * Phase 15: Parses markdown table syntax and renders with proper alignment
 */

interface Props {
  lines: string[];
}

export function InlineTable({ lines }: Props) {
  // Parse table: split by pipes, trim, filter separator rows
  const rows: string[][] = [];
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip separator rows (---|---|---)
    if (line.match(/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/)) {
      if (headerIdx < 0 && rows.length > 0) headerIdx = rows.length - 1;
      continue;
    }
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return null;

  // Determine column widths
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    const maxLen = Math.max(...rows.map((r) => (r[c] ?? "").length));
    colWidths.push(Math.max(maxLen + 2, 6));
  }

  // Cap total width
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const maxTotal = 76;
  const scale = totalWidth > maxTotal ? maxTotal / totalWidth : 1;
  const finalWidths = colWidths.map((w) => Math.max(4, Math.floor(w * scale)));

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {rows.map((row, rowIdx) => {
        const isHeader = headerIdx >= 0 && rowIdx <= headerIdx;
        return (
          <Box key={rowIdx}>
            {row.map((cell, colIdx) => (
              <Box key={colIdx} width={finalWidths[colIdx]}>
                <Text bold={isHeader} dimColor={isHeader}>
                  {cell}
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
