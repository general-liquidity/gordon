import React, { useMemo } from "react";
import { Box, Text, useStdout } from "../ink-custom";
import { cachedStringWidth } from "../rendering/lineWidthCache.ts";
import { BOX as SHARED_BOX } from "../rendering/stringPool.ts";

/**
 * InlineTable — terminal-width-aware markdown table renderer.
 *
 * Claude Code pattern: pre-compute the ASCII table as strings using the
 * actual terminal width, then render each row as a single <Text> element.
 * Never use nested row-flexbox Boxes with fixed cell widths — Ink's flexbox
 * engine will word-wrap inside narrow cells and create column-interleave
 * visual glitches.
 *
 * Features:
 *   - Unicode box drawing borders (┌─┬─┐ / ├─┼─┤ / └─┴─┘)
 *   - Alignment parsed from the separator row (|:---|:--:|---:|)
 *   - Headers centered, data cells left/center/right per column
 *   - Vertical key-value fallback when the table is too wide
 *   - Cached string width measurements
 */

const MIN_COLUMN_WIDTH = 3;
const SAFETY_MARGIN = 4;
const LEFT_PADDING = 2;
const BORDER_CHARS_PER_COL = 3; // "│ " + " " for padding inside each cell
const MAX_ROW_LINES = 4;

type CellAlign = "left" | "center" | "right";

// Unicode box drawing characters — shared from the string pool so all
// renderers reference the same frozen strings (V8 interning benefit).
const BOX = SHARED_BOX;

interface Props {
  lines: string[];
}

function parseRows(lines: string[]): {
  rows: string[][];
  headerIdx: number;
  alignments: CellAlign[];
} {
  const rows: string[][] = [];
  let headerIdx = -1;
  let alignments: CellAlign[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Separator row — also carries alignment info via colons
    if (line.match(/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/)) {
      if (headerIdx < 0 && rows.length > 0) headerIdx = rows.length - 1;
      // Parse alignment markers: :---  (left), :---: (center), ---: (right)
      alignments = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .map((c): CellAlign => {
          const left = c.startsWith(":");
          const right = c.endsWith(":");
          if (left && right) return "center";
          if (right) return "right";
          return "left";
        });
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

  return { rows, headerIdx, alignments };
}

function padAligned(text: string, width: number, align: CellAlign): string {
  const actualWidth = cachedStringWidth(text);
  if (actualWidth >= width) return text;
  const pad = width - actualWidth;
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") {
    const leftPad = Math.floor(pad / 2);
    const rightPad = pad - leftPad;
    return " ".repeat(leftPad) + text + " ".repeat(rightPad);
  }
  return text + " ".repeat(pad);
}

/** Split a string into lines of at most `width` visible columns, breaking on
 *  word boundaries when possible and hard-breaking long words.
 *
 *  Cells may contain ANSI escape sequences (table cells embed cyan/bold codes
 *  for inline-markdown formatting). We measure visible width via
 *  cachedStringWidth, and if a cell already contains ANSI we never split it —
 *  slicing through an escape sequence would corrupt the codes. The visible
 *  fit is what determines whether wrap is needed at all. */
function wrapCellText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  if (cachedStringWidth(text) <= width) return [text];
  // Bail on splitting ANSI-bearing cells — leave the text as one line and
  // let the column scaler handle the overflow. Slicing here would break
  // escape sequences and bleed colors into adjacent cells.
  if (text.indexOf("\x1b") >= 0) return [text];

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

  const rendered = useMemo(() => {
    const { rows, headerIdx, alignments } = parseRows(lines);
    if (rows.length === 0) return null;

    const colCount = Math.max(...rows.map((r) => r.length));
    // Pad alignments to colCount with "left" defaults
    const colAlign: CellAlign[] = [];
    for (let c = 0; c < colCount; c++) {
      colAlign.push(alignments[c] ?? "left");
    }

    // Compute natural column widths from content, using cached string width
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

    // Available width inside the table (inside the outer borders) minus
    // the per-column padding + inner separators. Each column costs:
    // "│ content " → 2 chars overhead. Plus 1 for the final "│".
    const borderOverhead = colCount * 2 + 1;
    const availableWidth = Math.max(
      terminalWidth - LEFT_PADDING - SAFETY_MARGIN - borderOverhead,
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

    // Border line builders
    const buildBorder = (left: string, mid: string, right: string): string => {
      let line = left;
      for (let c = 0; c < colCount; c++) {
        // +2 for the padding spaces on either side of content
        line += BOX.horiz.repeat((finalWidths[c] ?? MIN_COLUMN_WIDTH) + 2);
        line += c < colCount - 1 ? mid : right;
      }
      return line;
    };

    const topBorder = buildBorder(BOX.topLeft, BOX.topMid, BOX.topRight);
    const headerBorder = buildBorder(BOX.midLeft, BOX.midMid, BOX.midRight);
    const botBorder = buildBorder(BOX.botLeft, BOX.botMid, BOX.botRight);

    // Pre-compute each row's visible line(s). When a cell wraps to multiple
    // lines, emit that many sub-rows.
    const tableLines: Array<{ text: string; bold: boolean; kind: "border" | "row" }> = [];
    tableLines.push({ text: topBorder, bold: false, kind: "border" });

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]!;
      const isHeader = headerIdx >= 0 && rowIdx <= headerIdx;
      const wrappedCells = row.map((cell, c) =>
        wrapCellText(cell, finalWidths[c] ?? MIN_COLUMN_WIDTH),
      );
      const maxRowLines = Math.max(...wrappedCells.map((w) => w.length), 1);

      for (let lineIdx = 0; lineIdx < maxRowLines; lineIdx++) {
        let rowText = BOX.vert;
        for (let c = 0; c < colCount; c++) {
          const cellLine = wrappedCells[c]?.[lineIdx] ?? "";
          const width = finalWidths[c] ?? MIN_COLUMN_WIDTH;
          // Headers always center, data rows use alignment from separator
          const align: CellAlign = isHeader ? "center" : colAlign[c]!;
          rowText += " " + padAligned(cellLine, width, align) + " " + BOX.vert;
        }
        tableLines.push({ text: rowText, bold: isHeader, kind: "row" });
      }

      // Emit header border after the last header row
      if (isHeader && rowIdx === headerIdx) {
        tableLines.push({ text: headerBorder, bold: false, kind: "border" });
      }
    }

    tableLines.push({ text: botBorder, bold: false, kind: "border" });

    return { mode: "table" as const, tableLines };
  }, [lines, terminalWidth]);

  if (!rendered) return null;

  if (rendered.mode === "vertical") {
    return <VerticalKeyValue rows={rendered.rows} headerIdx={rendered.headerIdx} maxWidth={rendered.maxWidth} />;
  }

  return (
    <Box flexDirection="column" paddingLeft={LEFT_PADDING}>
      {rendered.tableLines.map((line, i) => {
        // Borders stay dim so they recede; headers are bold/cyan; data rows
        // render in default terminal color so chalk/ANSI codes embedded by
        // the caller (or by upstream inline-token formatting) survive.
        const isBorder = line.kind === "border";
        const isHeader = line.bold;
        return (
          <Text key={i} bold={isHeader} color={isHeader ? "cyanBright" : undefined} dimColor={isBorder}>
            {line.text}
          </Text>
        );
      })}
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
