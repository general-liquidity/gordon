import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { cachedStringWidth } from "../rendering/lineWidthCache.ts";

/**
 * InlineTable — terminal-width-aware markdown table renderer.
 *
 * Claude Code's pattern: pre-compute the ASCII table as strings using the
 * actual terminal width, then render each row as a single <Text> element.
 * Never use nested row-flexbox Boxes with fixed cell widths — Ink's flexbox
 * engine will word-wrap inside narrow cells and create the column-interleave
 * visual glitch that this component previously produced.
 *
 * Algorithm:
 *   1. Parse pipe-separated rows, strip separator rows (---|---)
 *   2. Compute per-column natural width (longest cell in column)
 *   3. Compute available width from useStdout().columns minus padding
 *   4. If natural widths fit: use them. Otherwise scale proportionally.
 *   5. If scaled widths would be below MIN_COLUMN_WIDTH: fall back to a
 *      vertical key-value format so the content is still readable.
 *   6. Render each row as one <Text> per line (no flexbox-row cells).
 */

const MIN_COLUMN_WIDTH = 6;
const SAFETY_MARGIN = 4;
const LEFT_PADDING = 2;
const BORDER_OVERHEAD_PER_COL = 3; // " | " between cells
const MAX_ROW_LINES = 4;

interface Props {
  lines: string[];
}

function parseRows(lines: string[]): { rows: string[][]; headerIdx: number } {
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

  return { rows, headerIdx };
}

/** Split a string into lines of at most `width` characters, breaking on word
 *  boundaries when possible and hard-breaking long words. */
function wrapCellText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  if (text.length <= width) return [text];

  const out: string[] = [];
  let remaining = text.trim();
  while (remaining.length > width) {
    // Prefer breaking at the last space before `width`
    let breakAt = remaining.lastIndexOf(" ", width);
    if (breakAt <= 0) {
      // No good break — hard-break at width
      breakAt = width;
    }
    out.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

export function InlineTable({ lines }: Props) {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  // Parse + layout + pre-render ALL in one useMemo. Same `lines` array +
  // same terminal width = same output, no re-measurement per frame.
  const rendered = useMemo(() => {
    const { rows, headerIdx } = parseRows(lines);
    if (rows.length === 0) return null;

    // Compute natural column widths from content, using cached string width
    const colCount = Math.max(...rows.map((r) => r.length));
    const naturalWidths: number[] = [];
    for (let c = 0; c < colCount; c++) {
      let maxLen = 0;
      for (const row of rows) {
        const cell = row[c] ?? "";
        const cellLen = cachedStringWidth(cell);
        if (cellLen > maxLen) maxLen = cellLen;
      }
      naturalWidths.push(Math.max(maxLen, MIN_COLUMN_WIDTH));
    }

    // Available width for actual cell contents, minus padding + separators
    const separatorOverhead = (colCount - 1) * BORDER_OVERHEAD_PER_COL;
    const availableWidth = Math.max(
      terminalWidth - LEFT_PADDING - SAFETY_MARGIN - separatorOverhead,
      colCount * MIN_COLUMN_WIDTH,
    );

    // Scale column widths to fit
    const naturalTotal = naturalWidths.reduce((a, b) => a + b, 0);
    let finalWidths: number[];
    if (naturalTotal <= availableWidth) {
      finalWidths = naturalWidths;
    } else {
      const scale = availableWidth / naturalTotal;
      finalWidths = naturalWidths.map((w) => Math.max(MIN_COLUMN_WIDTH, Math.floor(w * scale)));
      let actualTotal = finalWidths.reduce((a, b) => a + b, 0);
      if (actualTotal < availableWidth) {
        let widestIdx = 0;
        for (let i = 1; i < finalWidths.length; i++) {
          if (finalWidths[i]! > finalWidths[widestIdx]!) widestIdx = i;
        }
        finalWidths[widestIdx]! += availableWidth - actualTotal;
      }
    }

    // Vertical fallback when cells would wrap past MAX_ROW_LINES
    const needsVerticalFallback = rows.some((row) =>
      row.some((cell, c) => wrapCellText(cell, finalWidths[c] ?? MIN_COLUMN_WIDTH).length > MAX_ROW_LINES),
    );

    if (needsVerticalFallback && headerIdx >= 0) {
      return {
        mode: "vertical" as const,
        rows,
        headerIdx,
        maxWidth: terminalWidth - LEFT_PADDING - SAFETY_MARGIN,
      };
    }

    // Pre-compute all table lines
    const tableLines: Array<{ text: string; bold: boolean; dim: boolean }> = [];
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]!;
      const isHeader = headerIdx >= 0 && rowIdx <= headerIdx;
      const wrappedCells = row.map((cell, c) =>
        wrapCellText(cell, finalWidths[c] ?? MIN_COLUMN_WIDTH),
      );
      const maxRowLines = Math.max(...wrappedCells.map((w) => w.length), 1);

      for (let lineIdx = 0; lineIdx < maxRowLines; lineIdx++) {
        const parts: string[] = [];
        for (let c = 0; c < colCount; c++) {
          const cellLine = wrappedCells[c]?.[lineIdx] ?? "";
          parts.push(padRight(cellLine, finalWidths[c] ?? MIN_COLUMN_WIDTH));
        }
        tableLines.push({
          text: parts.join("  "),
          bold: isHeader,
          dim: isHeader,
        });
      }
    }

    return { mode: "table" as const, tableLines };
  }, [lines, terminalWidth]);

  if (!rendered) return null;

  if (rendered.mode === "vertical") {
    return <VerticalKeyValue rows={rendered.rows} headerIdx={rendered.headerIdx} maxWidth={rendered.maxWidth} />;
  }

  return (
    <Box flexDirection="column" paddingLeft={LEFT_PADDING}>
      {rendered.tableLines.map((line, i) => (
        <Text key={i} bold={line.bold} dimColor={line.dim}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Vertical key-value fallback when the table is too wide.
 * Takes the first row of headers as labels and renders each data row as a
 * stack of "header: value" pairs with a blank line between rows.
 */
function VerticalKeyValue({
  rows,
  headerIdx,
  maxWidth,
}: {
  rows: string[][];
  headerIdx: number;
  maxWidth: number;
}) {
  const headers = rows[headerIdx] ?? [];
  const dataRows = rows.slice(headerIdx + 1);

  const longestHeader = Math.max(...headers.map((h) => h.length), 0);
  const labelWidth = Math.min(longestHeader, Math.floor(maxWidth / 3));

  return (
    <Box flexDirection="column" paddingLeft={LEFT_PADDING}>
      {dataRows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="column" marginBottom={rowIdx < dataRows.length - 1 ? 1 : 0}>
          {row.map((cell, cellIdx) => {
            const label = headers[cellIdx] ?? "";
            const wrapped = wrapCellText(cell, maxWidth - labelWidth - 2);
            return (
              <React.Fragment key={cellIdx}>
                {wrapped.map((line, lineIdx) => (
                  <Text key={lineIdx}>
                    {lineIdx === 0
                      ? `${padRight(label + ":", labelWidth + 2)}${line}`
                      : `${" ".repeat(labelWidth + 2)}${line}`}
                  </Text>
                ))}
              </React.Fragment>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
