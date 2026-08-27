/**
 * LivePositions — Auto-updating list of open positions
 *
 * Pattern: Claude Code TaskListV2 — compact rows, no borders, auto-refresh.
 * Subscribes to position:updated and position:closed events via EventBus
 * and re-renders in place without user interaction.
 *
 * SYM        SIDE  QTY      ENTRY      LAST       PNL        STOP       DURATION
 * BTC        LONG  0.25     67,432     68,100     +668.00    66,500     2h 14m
 * ETH        SHORT 5.00     3,821      3,790      +155.00    3,900      45m
 * ────────────────────────────────────────────────────────────────────────────
 * TOTAL (2 positions)                             +823.00
 *
 * Layout invariants (regression-guarded in LivePositions.test.ts):
 * - Every cell is truncated WITH an ellipsis at width-1, never sliced flush,
 *   and columns are joined with a guaranteed 1-space gap (headers included).
 * - Narrow terminals degrade by dropping DURATION, then ACCT%, then RISK —
 *   headers are never merged.
 * - Rows with quantity <= 0 are never displayed (defense in depth vs the
 *   position store); if everything is filtered, the component renders nothing.
 * - At most MAX_VISIBLE_ROWS rows render, sorted by |P&L| descending, with a
 *   dim "+N more" overflow line so boot output stays bounded.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Box, Text, useStdout } from "../../ink-custom";
import { fmtNum } from "../charts/DataTable.tsx";
import { useEventBusSubscriptions } from "../../hooks/useEventBusSubscription.js";
import type { EventType, EventData } from "../../../events/index.ts";
import { getMoneyColor, getSignalColor } from "../../design-system/colorMap.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";
import type { GordonTheme } from "../../themes/themes.ts";
import { stopDistancePct, accountPctAtRisk } from "./positionRisk.ts";
import { useAccountEquity } from "../../hooks/useAccountEquity.ts";
import { createCoalescer, type Coalescer } from "../../utils/coalescer.ts";
import { getPositionStore } from "../../../core/positions/store.ts";
import type { PositionRecord } from "../../../core/positions/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  lastPrice: number;
  pnl: number;
  stopPrice?: number;
  openedAt: string;
}

interface Props {
  /** Initial positions to display (e.g. from runtime snapshot) */
  initialPositions?: Position[];
}

const EMPTY_POSITIONS: Position[] = [];

export type PositionEvent =
  | { kind: "update"; positionId: string; updates: Partial<Position> }
  | { kind: "close"; positionId: string };

export type PositionRow = Position & {
  riskPct: number | null;
  acctPct: number | null;
};

function formatDuration(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60_000) return "<1m";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hours < 24) return `${hours}h ${remainMins}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  } catch {
    return "—";
  }
}

// ============================================================================
// Layout (pure — unit-tested)
// ============================================================================

export interface ColumnSpec {
  key: keyof PositionRow;
  header: string;
  width: number;
  align: "left" | "right";
}

/** Full column set, widest-terminal order. Every width >= header length. */
export const POSITION_COLUMNS: ColumnSpec[] = [
  { key: "symbol", header: "SYM", width: 10, align: "left" },
  { key: "side", header: "SIDE", width: 5, align: "left" },
  { key: "quantity", header: "QTY", width: 8, align: "right" },
  { key: "entryPrice", header: "ENTRY", width: 10, align: "right" },
  { key: "lastPrice", header: "LAST", width: 10, align: "right" },
  { key: "pnl", header: "PNL", width: 10, align: "right" },
  { key: "stopPrice", header: "STOP", width: 10, align: "right" },
  { key: "riskPct", header: "RISK", width: 8, align: "right" },
  { key: "acctPct", header: "ACCT%", width: 6, align: "right" },
  { key: "openedAt", header: "DURATION", width: 8, align: "left" },
];

/** Boot viewport budget — overflow goes to the "+N more" line. */
export const MAX_VISIBLE_ROWS = 8;

const COLUMN_GAP = 1;
const LEFT_PADDING = 2;
const ELLIPSIS = "…";

/** Degradation order for narrow terminals. PNL/SYM/core columns never drop. */
const DROP_ORDER: Array<keyof PositionRow> = ["openedAt", "acctPct", "riskPct"];

/** Printed line width (cells + gaps), excluding left padding. */
export function tableLineWidth(cols: ColumnSpec[]): number {
  return cols.reduce((sum, c) => sum + c.width, 0) + (cols.length - 1) * COLUMN_GAP;
}

/**
 * Fit text into exactly `width` chars: too-long text truncates at width-1
 * with an ellipsis (never a flush slice that eats the inter-column gap),
 * shorter text pads per alignment.
 */
export function fitCell(text: string, width: number, align: "left" | "right" = "left"): string {
  if (width <= 0) return "";
  const t = text.length > width ? text.slice(0, width - 1) + ELLIPSIS : text;
  if (t.length >= width) return t;
  const pad = " ".repeat(width - t.length);
  return align === "right" ? pad + t : t + pad;
}

/**
 * Pick the columns that fit the terminal. Drops DURATION first, then ACCT%,
 * then RISK; never merges headers or drops core/PNL columns.
 */
export function selectVisibleColumns(terminalWidth: number): ColumnSpec[] {
  let cols = POSITION_COLUMNS;
  for (const key of DROP_ORDER) {
    if (tableLineWidth(cols) + LEFT_PADDING <= terminalWidth) break;
    cols = cols.filter((c) => c.key !== key);
  }
  return cols;
}

export interface DisplayRows {
  /** Rows to render, |pnl| desc, capped at maxRows. */
  rows: Position[];
  /** Count of real (qty > 0) positions, including capped-out ones. */
  total: number;
  /** P&L summed over ALL real positions, not just visible ones. */
  totalPnl: number;
  /** How many real positions were capped out of the table. */
  hiddenCount: number;
}

/**
 * Display pipeline: drop phantom rows (qty <= 0 — store is being fixed
 * upstream, but the display must never show them), sort by absolute P&L
 * so the largest exposure is always visible, cap at maxRows.
 */
export function prepareDisplayRows(
  positions: Position[],
  maxRows: number = MAX_VISIBLE_ROWS,
): DisplayRows {
  const real = positions.filter((p) => p.quantity > 0);
  const sorted = [...real].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const rows = sorted.slice(0, maxRows);
  return {
    rows,
    total: real.length,
    totalPnl: real.reduce((sum, p) => sum + p.pnl, 0),
    hiddenCount: real.length - rows.length,
  };
}

function formatColumnValue(col: ColumnSpec, row: PositionRow): string {
  switch (col.key) {
    case "symbol":
      return row.symbol;
    case "side":
      return row.side.toUpperCase();
    case "quantity":
      return fmtNum(row.quantity);
    case "entryPrice":
      return fmtNum(row.entryPrice);
    case "lastPrice":
      return fmtNum(row.lastPrice);
    case "pnl":
      return `${row.pnl >= 0 ? "+" : ""}${fmtNum(row.pnl)}`;
    case "stopPrice":
      return row.stopPrice != null ? fmtNum(row.stopPrice) : "—";
    case "riskPct": {
      if (row.riskPct == null) return "NO STOP";
      if (row.riskPct <= 0) return "BREACH";
      return `${(row.riskPct * 100).toFixed(1)}%`;
    }
    case "acctPct":
      return row.acctPct == null ? "—" : `${(row.acctPct * 100).toFixed(1)}%`;
    case "openedAt":
      return formatDuration(row.openedAt);
    default:
      return "";
  }
}

/** One fitted cell per visible column — every cell is exactly col.width wide. */
export function buildRowCells(row: PositionRow, cols: ColumnSpec[]): string[] {
  return cols.map((col) => fitCell(formatColumnValue(col, row), col.width, col.align));
}

export function buildHeaderCells(cols: ColumnSpec[]): string[] {
  return cols.map((col) => fitCell(col.header, col.width, col.align));
}

/**
 * Footer: full "TOTAL (N positions)" label spanning the columns left of PNL
 * (so it never truncates mid-text inside the 10-char SYM cell), plus the
 * summed P&L right-aligned under the PNL column.
 */
export function buildFooterLine(
  cols: ColumnSpec[],
  count: number,
  totalPnl: number,
): { label: string; pnl: string } {
  const pnlIdx = cols.findIndex((c) => c.key === "pnl");
  const labelWidth = cols.slice(0, pnlIdx).reduce((sum, c) => sum + c.width + COLUMN_GAP, 0);
  const noun = count === 1 ? "position" : "positions";
  return {
    label: fitCell(`TOTAL (${count} ${noun})`, labelWidth, "left"),
    pnl: fitCell(`${totalPnl >= 0 ? "+" : ""}${fmtNum(totalPnl)}`, cols[pnlIdx]!.width, "right"),
  };
}

function cellColor(col: ColumnSpec, row: PositionRow, theme: GordonTheme): string | undefined {
  switch (col.key) {
    case "side":
      return getSignalColor(row.side === "long" ? "long" : "short", theme);
    case "pnl":
      return getMoneyColor(row.pnl, theme);
    case "riskPct":
      return row.riskPct == null || row.riskPct <= 0 ? theme.riskDanger : undefined;
    case "acctPct":
      return row.acctPct != null && row.acctPct >= 0.02 ? theme.riskDanger : undefined;
    default:
      return undefined;
  }
}

// ============================================================================
// Component
// ============================================================================

const DEFAULT_TERMINAL_WIDTH = 80;

export function LivePositions({ initialPositions = EMPTY_POSITIONS }: Props) {
  const [positions, setPositions] = useState<Position[]>(initialPositions);
  const theme = useTheme();
  const accountEquity = useAccountEquity();
  const { stdout } = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(
    () => stdout?.columns ?? DEFAULT_TERMINAL_WIDTH,
  );
  const coalescerRef = useRef<Coalescer<PositionEvent> | null>(null);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTerminalWidth(stdout.columns ?? DEFAULT_TERMINAL_WIDTH);
    onResize();
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const columns = useMemo(() => selectVisibleColumns(terminalWidth), [terminalWidth]);
  const {
    rows: visible,
    total,
    totalPnl,
    hiddenCount,
  } = useMemo(() => prepareDisplayRows(positions), [positions]);
  const visibleRows = useMemo<PositionRow[]>(
    () =>
      visible.map((position) => ({
        ...position,
        riskPct: stopDistancePct(position),
        acctPct: accountPctAtRisk(position, accountEquity),
      })),
    [visible, accountEquity],
  );

  useEffect(() => {
    let disposed = false;
    void getPositionStore()
      .then((store) => store.getActive())
      .then((records) => {
        if (!disposed) setPositions(records.map(positionRecordToPosition));
      })
      .catch(() => {
        if (!disposed) setPositions(initialPositions);
      });
    return () => {
      disposed = true;
    };
  }, [initialPositions]);

  useEffect(() => {
    coalescerRef.current = createCoalescer<PositionEvent>((events) => {
      setPositions((prev) => applyPositionEvents(prev, events));
    });
    return () => {
      coalescerRef.current?.dispose();
      coalescerRef.current = null;
    };
  }, []);

  // Handle position:updated — upsert position in list
  const handleEvent = useCallback((event: EventData<EventType>) => {
    const eventType = event.type as string;

    if (eventType === "position:updated") {
      const ev = event as unknown as { positionId: string; updates: Partial<Position> };
      coalescerRef.current?.push({
        kind: "update",
        positionId: ev.positionId,
        updates: ev.updates ?? {},
      });
    }

    if (eventType === "position:closed") {
      const ev = event as unknown as { positionId: string };
      coalescerRef.current?.push({ kind: "close", positionId: ev.positionId });
    }
  }, []);

  useEventBusSubscriptions(["position:updated", "position:closed"], handleEvent);

  if (total === 0) return null;

  const headerCells = buildHeaderCells(columns);
  const footer = buildFooterLine(columns, total, totalPnl);
  const lineWidth = tableLineWidth(columns);
  const gap = " ".repeat(COLUMN_GAP);

  return (
    <Box flexDirection="column">
      <Box paddingLeft={LEFT_PADDING}>
        <Text bold color={theme.uiBrand}>
          OPEN POSITIONS
        </Text>
        <Text dimColor> ({total})</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} paddingLeft={LEFT_PADDING}>
        <Text bold dimColor>
          {headerCells.join(gap)}
        </Text>
        {visibleRows.map((row) => (
          <Box key={row.id}>
            {buildRowCells(row, columns).map((cell, idx) => (
              <Text key={columns[idx]!.key} color={cellColor(columns[idx]!, row, theme)}>
                {idx > 0 ? gap : ""}
                {cell}
              </Text>
            ))}
          </Box>
        ))}
        {hiddenCount > 0 && <Text dimColor>{`+${hiddenCount} more — /positions for all`}</Text>}
        <Text dimColor>{"─".repeat(lineWidth)}</Text>
        <Box>
          <Text bold>{footer.label}</Text>
          <Text bold color={getMoneyColor(totalPnl, theme)}>
            {footer.pnl}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function applyPositionEvents(prev: Position[], events: PositionEvent[]): Position[] {
  let next = prev;
  for (const event of events) {
    if (event.kind === "close") {
      const filtered = next.filter((position) => position.id !== event.positionId);
      if (filtered.length !== next.length) next = filtered;
      continue;
    }
    const idx = next.findIndex((position) => position.id === event.positionId);
    if (idx === -1) continue;
    const updated = [...next];
    updated[idx] = { ...updated[idx]!, ...event.updates };
    next = updated;
  }
  return next;
}

function positionRecordToPosition(record: PositionRecord): Position {
  return {
    id: record.id,
    symbol: record.symbol,
    side: record.side,
    quantity: Number(record.quantity ?? 0),
    entryPrice: Number(record.entryPrice ?? 0),
    lastPrice: Number(record.currentPrice ?? record.entryPrice ?? 0),
    pnl: Number(record.unrealizedPnL ?? record.realizedPnL ?? 0),
    stopPrice: record.stopLoss,
    openedAt: record.createdAt,
  };
}
