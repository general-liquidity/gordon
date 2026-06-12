/**
 * LivePositions — Auto-updating list of open positions
 *
 * Pattern: Claude Code TaskListV2 — compact rows, no borders, auto-refresh.
 * Subscribes to position:updated and position:closed events via EventBus
 * and re-renders in place without user interaction.
 *
 * SYM      SIDE   QTY      ENTRY      LAST       PNL        STOP       DURATION
 * BTC      LONG   0.25     67,432     68,100     +668.00    66,500     2h 14m
 * ETH      SHORT  5.00     3,821      3,790      +155.00    3,900      45m
 * ─────────────────────────────────────────────────────────────────────────────
 * TOTAL (2)                                       +823.00
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Box, Text } from "../../ink-custom";
import { DataTable, fmtNum, type Column } from "../charts/DataTable.tsx";
import {
  useEventBusSubscriptions,
} from "../../hooks/useEventBusSubscription.js";
import type { EventType, EventData } from "../../../events/index.ts";
import { getMoneyColor, getSignalColor } from "../../design-system/colorMap.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";
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

type PositionRow = Position & {
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
    return "\u2014";
  }
}

// ============================================================================
// Component
// ============================================================================

export function LivePositions({ initialPositions = EMPTY_POSITIONS }: Props) {
  const [positions, setPositions] = useState<Position[]>(initialPositions);
  const theme = useTheme();
  const accountEquity = useAccountEquity();
  const coalescerRef = useRef<Coalescer<PositionEvent> | null>(null);
  const rows = useMemo<PositionRow[]>(
    () => positions.map((position) => ({
      ...position,
      riskPct: stopDistancePct(position),
      acctPct: accountPctAtRisk(position, accountEquity),
    })),
    [positions, accountEquity],
  );
  const columns = useMemo<Column<PositionRow>[]>(() => [
    {
      key: "symbol",
      header: "SYM",
      width: 8,
      format: (v) => String(v),
    },
    {
      key: "side",
      header: "SIDE",
      width: 6,
      format: (v) => String(v).toUpperCase(),
      color: (v) => getSignalColor(v === "long" ? "long" : "short", theme),
    },
    {
      key: "quantity",
      header: "QTY",
      width: 8,
      align: "right",
      format: (v) => fmtNum(Number(v)),
    },
    {
      key: "entryPrice",
      header: "ENTRY",
      width: 10,
      align: "right",
      format: (v) => fmtNum(Number(v)),
    },
    {
      key: "lastPrice",
      header: "LAST",
      width: 10,
      align: "right",
      format: (v) => fmtNum(Number(v)),
    },
    {
      key: "pnl",
      header: "PNL",
      width: 10,
      align: "right",
      format: (v) => {
        const n = Number(v);
        return `${n >= 0 ? "+" : ""}${fmtNum(n)}`;
      },
      color: (v) => getMoneyColor(Number(v), theme),
    },
    {
      key: "stopPrice",
      header: "STOP",
      width: 10,
      align: "right",
      format: (v) => (v != null ? fmtNum(Number(v)) : "\u2014"),
    },
    {
      key: "riskPct",
      header: "RISK",
      width: 8,
      align: "right",
      format: (v) => {
        if (v == null) return "NO STOP";
        const n = Number(v);
        if (n <= 0) return "BREACH";
        return `${(n * 100).toFixed(1)}%`;
      },
      color: (v) => v == null || Number(v) <= 0 ? theme.riskDanger : undefined,
    },
    {
      key: "acctPct",
      header: "ACCT%",
      width: 6,
      align: "right",
      format: (v) => v == null ? "\u2014" : `${(Number(v) * 100).toFixed(1)}%`,
      color: (v) => v != null && Number(v) >= 0.02 ? theme.riskDanger : undefined,
    },
    {
      key: "openedAt",
      header: "DURATION",
      width: 8,
      format: (v) => formatDuration(String(v)),
    },
  ], [theme]);

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
  const handleEvent = useCallback(
    (event: EventData<EventType>) => {
      const eventType = event.type as string;

      if (eventType === "position:updated") {
        const ev = event as unknown as { positionId: string; updates: Partial<Position> };
        coalescerRef.current?.push({ kind: "update", positionId: ev.positionId, updates: ev.updates ?? {} });
      }

      if (eventType === "position:closed") {
        const ev = event as unknown as { positionId: string };
        coalescerRef.current?.push({ kind: "close", positionId: ev.positionId });
      }
    },
    [],
  );

  useEventBusSubscriptions(
    ["position:updated", "position:closed"],
    handleEvent,
  );

  // Build summary row
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const summaryRow: Record<string, string> = {
    symbol: `TOTAL (${positions.length})`,
    pnl: `${totalPnl >= 0 ? "+" : ""}${fmtNum(totalPnl)}`,
  };

  if (positions.length === 0) return null;

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text bold color={theme.uiBrand}>OPEN POSITIONS</Text>
        {positions.length > 0 && (
          <Text dimColor> ({positions.length})</Text>
        )}
      </Box>
      <DataTable
        columns={columns as unknown as Column[]}
        data={rows as unknown as Record<string, unknown>[]}
        summaryRow={positions.length > 0 ? summaryRow : undefined}
      />
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
