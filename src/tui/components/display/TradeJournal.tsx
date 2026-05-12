/**
 * TradeJournal — Auto-generates a journal entry after a trade
 *
 * Accepts trade data (symbol, side, entry/exit prices, P&L, reasoning),
 * formats it as structured markdown, and persists via MemoryProvider
 * as a feedback-type memory entry. Shows a brief confirmation after save.
 *
 * Phase 18 of the TUI rebuild plan.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text } from "../../ink-custom";
import { useMemory } from "../../state/MemoryProvider.js";

// ============================================================================
// Types
// ============================================================================

export interface TradeData {
  /** Trading pair or ticker, e.g. "BTC/USDT" */
  symbol: string;
  /** Trade direction */
  side: "long" | "short";
  /** Entry price */
  entry: number;
  /** Exit price */
  exit: number;
  /** Realised profit/loss */
  pnl: number;
  /** Strategy or rationale for the trade */
  reasoning: string;
  /** Optional timestamp override (defaults to now) */
  timestamp?: string;
  /** Optional additional notes */
  notes?: string;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmtPrice(n: number): string {
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtPnl(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmtPrice(n)}`;
}

function pnlPct(entry: number, exit: number, side: "long" | "short"): string {
  if (entry === 0) return "N/A";
  const raw = side === "long"
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100;
  const sign = raw >= 0 ? "+" : "";
  return `${sign}${raw.toFixed(2)}%`;
}

function formatTimestamp(ts?: string): string {
  const d = ts ? new Date(ts) : new Date();
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

/**
 * Build the markdown journal entry.
 */
function buildJournalMarkdown(trade: TradeData): string {
  const ts = formatTimestamp(trade.timestamp);
  const outcome = trade.pnl >= 0 ? "WIN" : "LOSS";
  const pct = pnlPct(trade.entry, trade.exit, trade.side);

  const lines: string[] = [
    `## Trade Summary`,
    "",
    `- **Symbol:** ${trade.symbol}`,
    `- **Side:** ${trade.side.toUpperCase()}`,
    `- **Outcome:** ${outcome}  (${fmtPnl(trade.pnl)} / ${pct})`,
    `- **Date:** ${ts}`,
    "",
    `### Entry`,
    "",
    `- Price: ${fmtPrice(trade.entry)}`,
    `- Reasoning: ${trade.reasoning}`,
    "",
    `### Exit`,
    "",
    `- Price: ${fmtPrice(trade.exit)}`,
    `- P&L: ${fmtPnl(trade.pnl)}  (${pct})`,
    "",
    `### Outcome`,
    "",
    trade.pnl >= 0
      ? `Trade closed in profit. The thesis played out as expected.`
      : `Trade closed at a loss. Review entry conditions and risk management.`,
    "",
    `### Notes`,
    "",
    trade.notes ?? "No additional notes.",
  ];

  return lines.join("\n");
}

// ============================================================================
// Component
// ============================================================================

interface Props {
  /** Trade data to journal */
  trade: TradeData;
  /** Called after the entry has been saved */
  onSaved?: () => void;
}

export function TradeJournal({ trade, onSaved }: Props) {
  const { saveMemory } = useMemory();
  const [status, setStatus] = useState<"saving" | "saved" | "error">("saving");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const save = useCallback(async () => {
    try {
      const ts = trade.timestamp ?? new Date().toISOString();
      const dateSlug = ts.slice(0, 10);
      const name = `${trade.symbol.replace(/\//g, "-")}-${trade.side}-${dateSlug}`;
      const description = `${trade.side.toUpperCase()} ${trade.symbol} — ${trade.pnl >= 0 ? "WIN" : "LOSS"} ${fmtPnl(trade.pnl)}`;
      const content = buildJournalMarkdown(trade);

      await saveMemory("feedback", name, content, description);
      setStatus("saved");
      onSaved?.();
    } catch (err) {
      setStatus("error");
      setErrMsg(err instanceof Error ? err.message : String(err));
    }
  }, [trade, saveMemory, onSaved]);

  useEffect(() => {
    void save();
  }, [save]);

  // ── Saving ──
  if (status === "saving") {
    return (
      <Box paddingLeft={2}>
        <Text dimColor>Saving trade journal entry...</Text>
      </Box>
    );
  }

  // ── Error ──
  if (status === "error") {
    return (
      <Box paddingLeft={2}>
        <Text color="red">Failed to save journal: {errMsg}</Text>
      </Box>
    );
  }

  // ── Saved confirmation ──
  const outcome = trade.pnl >= 0 ? "WIN" : "LOSS";
  const pct = pnlPct(trade.entry, trade.exit, trade.side);

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Box>
        <Text color="green" bold>Journal saved </Text>
        <Text>
          {trade.side.toUpperCase()} {trade.symbol}
        </Text>
        <Text color={trade.pnl >= 0 ? "green" : "red"}>
          {" "}{outcome} {fmtPnl(trade.pnl)} ({pct})
        </Text>
      </Box>
      <Text dimColor>  Stored as feedback memory in ~/.gordon/memory/</Text>
    </Box>
  );
}
