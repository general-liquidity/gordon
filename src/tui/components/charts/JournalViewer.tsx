import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";

/**
 * JournalViewer — Filterable trade journal
 */

interface TradeEntry {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  pnl?: number;
  timestamp: string;
  status: "open" | "closed" | "cancelled";
}

interface Props {
  trades: TradeEntry[];
  onCancel: () => void;
}

export function JournalViewer({ trades, onCancel }: Props) {
  const [filter, setFilter] = useState<"all" | "open" | "closed" | "winners" | "losers">("all");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = trades.filter((t) => {
    if (filter === "all") return true;
    if (filter === "open") return t.status === "open";
    if (filter === "closed") return t.status === "closed";
    if (filter === "winners") return (t.pnl ?? 0) > 0;
    if (filter === "losers") return (t.pnl ?? 0) < 0;
    return true;
  });

  const filters: Array<"all" | "open" | "closed" | "winners" | "losers"> = ["all", "open", "closed", "winners", "losers"];

  useInput((_input, key) => {
    if (key.escape) onCancel();
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    if (key.tab) {
      const idx = filters.indexOf(filter);
      setFilter(filters[(idx + 1) % filters.length]!);
      setSelectedIdx(0);
    }
  });

  const totalPnl = filtered.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const winRate = filtered.filter((t) => (t.pnl ?? 0) > 0).length / Math.max(1, filtered.filter((t) => t.status === "closed").length);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">TRADE JOURNAL</Text>
        <Text dimColor>  ({filtered.length} trades, P&L: </Text>
        <Text color={totalPnl >= 0 ? "green" : "red"}>${totalPnl.toFixed(2)}</Text>
        <Text dimColor>, WR: {(winRate * 100).toFixed(0)}%)</Text>
      </Box>

      <Box>
        {filters.map((f) => (
          <Text key={f} color={f === filter ? "cyanBright" : undefined} dimColor={f !== filter}>
            {" "}{f}{" "}
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {filtered.slice(0, 15).map((trade, i) => {
          const isFocused = i === selectedIdx;
          const pnlColor = (trade.pnl ?? 0) >= 0 ? "green" : "red";
          return (
            <Box key={trade.id}>
              <Text color={isFocused ? "cyanBright" : undefined}>{isFocused ? " \u25B8" : "  "}</Text>
              <Text color={trade.side === "BUY" ? "green" : "red"} bold={isFocused}> {trade.side.padEnd(4)}</Text>
              <Text bold={isFocused}> {trade.symbol.padEnd(10)}</Text>
              <Text dimColor={!isFocused}> {String(trade.quantity).padEnd(10)} @ ${trade.price.toFixed(2).padEnd(10)}</Text>
              {trade.pnl !== undefined && <Text color={pnlColor}> {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}</Text>}
              <Text dimColor> {trade.status}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} scroll {"\u00B7"} Tab filter {"\u00B7"} Esc close</Text>
      </Box>
    </Box>
  );
}
