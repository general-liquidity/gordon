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

import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { DataTable, fmtNum, changeColor, type Column } from "./DataTable.js";
import {
  useEventBusSubscriptions,
} from "../hooks/useEventBusSubscription.js";
import type { EventType, EventData } from "../../events/index.ts";

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

// ============================================================================
// Column definitions
// ============================================================================

const COLUMNS: Column<Position>[] = [
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
    color: (v) => (v === "long" ? "green" : "red"),
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
    color: (v) => changeColor(Number(v)),
  },
  {
    key: "stopPrice",
    header: "STOP",
    width: 10,
    align: "right",
    format: (v) => (v != null ? fmtNum(Number(v)) : "\u2014"),
  },
  {
    key: "openedAt",
    header: "DURATION",
    width: 8,
    format: (v) => formatDuration(String(v)),
  },
];

// ============================================================================
// Helpers
// ============================================================================

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

export function LivePositions({ initialPositions = [] }: Props) {
  const [positions, setPositions] = useState<Position[]>(initialPositions);

  // Handle position:updated — upsert position in list
  const handleEvent = useCallback(
    (event: EventData<EventType>) => {
      const eventType = event.type as string;

      if (eventType === "position:updated") {
        const ev = event as unknown as { positionId: string; updates: Partial<Position> };
        const posId = ev.positionId;
        const updates = ev.updates ?? {};
        setPositions((prev) => {
          const idx = prev.findIndex((p) => p.id === posId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx]!, ...updates };
          return updated;
        });
      }

      if (eventType === "position:closed") {
        const ev = event as unknown as { positionId: string };
        const posId = ev.positionId;
        setPositions((prev) => prev.filter((p) => p.id !== posId));
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

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text bold color="cyanBright">OPEN POSITIONS</Text>
        {positions.length > 0 && (
          <Text dimColor> ({positions.length})</Text>
        )}
      </Box>
      <DataTable
        columns={COLUMNS as unknown as Column[]}
        data={positions as unknown as Record<string, unknown>[]}
        summaryRow={positions.length > 0 ? summaryRow : undefined}
      />
    </Box>
  );
}
