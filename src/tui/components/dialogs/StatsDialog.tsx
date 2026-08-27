import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// StatsDialog — 4-tab trading statistics dashboard
//
// Overview | Daily Returns | Activity Heatmap | Per-Strategy
// ============================================================================

interface SessionStats {
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  streak: number;
  bestDay: number;
  worstDay: number;
  sharpe: number;
  dailyReturns: number[];
  strategyStats: StrategyRow[];
}

interface StrategyRow {
  name: string;
  trades: number;
  winPct: number;
  pnl: number;
  sharpe: number;
}

interface Props {
  stats: SessionStats;
  onClose: () => void;
}

const TABS = ["Overview", "Daily Returns", "Activity Heatmap", "Per-Strategy"];

export function StatsDialog({ stats, onClose }: Props) {
  const [tab, setTab] = useState(0);

  useInput((_input, key) => {
    if (key.escape) onClose();
    if (key.tab || key.rightArrow) setTab((p) => (p + 1) % TABS.length);
    if (key.leftArrow) setTab((p) => (p - 1 + TABS.length) % TABS.length);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Box>
        {TABS.map((t, i) => (
          <Text
            key={i}
            bold={i === tab}
            color={i === tab ? "cyanBright" : undefined}
            dimColor={i !== tab}
          >
            {i > 0 ? " | " : ""}
            {t}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {tab === 0 && (
          <>
            <Box>
              <Text color={stats.totalPnl >= 0 ? "green" : "red"} bold>
                P&L: {stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}
              </Text>
            </Box>
            <Box>
              <Text>Win Rate: </Text>
              <ProgressBar value={stats.winRate / 100} width={20} />
              <Text> {stats.winRate.toFixed(1)}%</Text>
            </Box>
            <Box>
              <Text>
                Trades: {stats.totalTrades} {"\u00B7"} Streak: {stats.streak} {"\u00B7"} Sharpe:{" "}
                {stats.sharpe.toFixed(2)}
              </Text>
            </Box>
            <Box>
              <Text>Best Day: </Text>
              <Text color="green">+${stats.bestDay.toFixed(2)}</Text>
              <Text> {"\u00B7"} Worst: </Text>
              <Text color="red">-${Math.abs(stats.worstDay).toFixed(2)}</Text>
            </Box>
          </>
        )}
        {tab === 1 && (
          <Box>
            <Text dimColor>Daily P&L sparkline (last 30 days):{"\n"}</Text>
            <Text color="cyan">
              {stats.dailyReturns.map((v) => (v >= 0 ? "\u2588" : "\u2581")).join("")}
            </Text>
          </Box>
        )}
        {tab === 2 && <Text dimColor>Activity heatmap — 52 weeks of trading activity</Text>}
        {tab === 3 &&
          stats.strategyStats.map((s, i) => (
            <Box key={i}>
              <Text>{s.name.padEnd(20)}</Text>
              <Text>{String(s.trades).padStart(6)}</Text>
              <Text>{`${s.winPct}%`.padStart(8)}</Text>
              <Text color={s.pnl >= 0 ? "green" : "red"}>
                {(s.pnl >= 0 ? "+" : "") + s.pnl.toFixed(2).padStart(10)}
              </Text>
            </Box>
          ))}
      </Box>
      <Text dimColor>Tab to switch {"\u00B7"} Esc to close</Text>
    </Box>
  );
}
