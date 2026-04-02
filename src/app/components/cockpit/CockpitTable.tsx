import React from "react";
import { Box, Text } from "ink";

import type { CockpitTableRow } from "../../cockpitModels.ts";
import { COLORS } from "../../theme.ts";
import { DeskPanel, getDeskToneColor, type DeskTone } from "../desk/DeskPanel.tsx";

function fitCell(value: string, width: number): string {
  if (width <= 1) {
    return value.slice(0, Math.max(width, 0));
  }
  if (value.length <= width) {
    return value.padEnd(width);
  }
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function getWidths(headers: string[], rows: CockpitTableRow[], targetWidth: number): number[] {
  const columns = Math.max(headers.length, 1);
  const separators = (columns - 1) * 2;
  const perColumn = Math.max(8, Math.floor((targetWidth - separators) / columns));
  return headers.map((header, index) => {
    const rowWidth = Math.max(
      header.length,
      ...rows.map((row) => (row.cells[index] ?? "").length),
    );
    return Math.max(8, Math.min(perColumn, rowWidth));
  });
}

export const CockpitTable: React.FC<{
  eyebrow: string;
  title: string;
  subtitle: string;
  headers: string[];
  rows: CockpitTableRow[];
  activeKey?: string;
  emptyTitle?: string;
  emptyDetail?: string;
  tone?: DeskTone;
}> = ({
  eyebrow,
  title,
  subtitle,
  headers,
  rows,
  activeKey,
  emptyTitle,
  emptyDetail,
  tone = "brand",
}) => {
  const availableWidth = Math.max(48, Math.min(92, (process.stdout.columns ?? 120) - 16));
  const widths = getWidths(headers, rows, availableWidth);

  return (
    <DeskPanel eyebrow={eyebrow} title={title} subtitle={subtitle} tone={tone}>
      {rows.length === 0 ? (
        <>
          <Text color={COLORS.WHITE}>{emptyTitle ?? "No rows yet"}</Text>
          {emptyDetail ? <Text color={COLORS.DIM}>{emptyDetail}</Text> : null}
        </>
      ) : (
        <>
          <Text color={COLORS.BRASS}>
            {headers.map((header, index) => fitCell(header, widths[index] ?? 8)).join("  ")}
          </Text>
          {rows.map((row) => {
            const active = row.key === activeKey;
            const color = active ? COLORS.BRASS : getDeskToneColor(row.tone ?? "neutral");
            return (
              <Text key={row.key} color={color}>
                {active ? ">" : " "}
                {" "}
                {row.cells.map((cell, index) => fitCell(cell, widths[index] ?? 8)).join("  ")}
              </Text>
            );
          })}
        </>
      )}
    </DeskPanel>
  );
};
