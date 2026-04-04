/**
 * StrategyBrowser -- Browse all strategies from the registry
 *
 * Grouped: Tier 1 (5), Tier 2 (25+), Custom, Playbooks.
 * Each entry shows name, type, win rate, Sharpe, and status badge.
 * Arrow keys to navigate, Enter to deploy, Space for details, Esc to close.
 *
 * Pattern: Claude Code MCP/plugin browser (grouped list with status badges).
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// Types
// ============================================================================

export type StrategyTier = "tier-1" | "tier-2" | "custom" | "playbook";

export type StrategyStatus = "active" | "paused" | "archived";

export interface Strategy {
  id: string;
  name: string;
  type: string;
  tier: StrategyTier;
  winRate: number;
  sharpe: number;
  status: StrategyStatus;
}

interface Props {
  strategies: Strategy[];
  onSelect: (strategy: Strategy) => void;
  onDeploy: (strategy: Strategy) => void;
  onClose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const TIER_ORDER: StrategyTier[] = ["tier-1", "tier-2", "custom", "playbook"];

const TIER_LABEL: Record<StrategyTier, string> = {
  "tier-1": "TIER 1 \u00b7 CORE",
  "tier-2": "TIER 2 \u00b7 EXTENDED",
  custom: "CUSTOM",
  playbook: "PLAYBOOKS",
};

const TIER_COLOR: Record<StrategyTier, string> = {
  "tier-1": "green",
  "tier-2": "yellow",
  custom: "magenta",
  playbook: "cyan",
};

const STATUS_ICON: Record<StrategyStatus, string> = {
  active: "\u25CF",   // ●
  paused: "\u25CB",   // ○
  archived: "\u2500", // ─
};

const STATUS_COLOR: Record<StrategyStatus, string> = {
  active: "green",
  paused: "yellow",
  archived: "gray",
};

const STATUS_LABEL: Record<StrategyStatus, string> = {
  active: "active",
  paused: "paused",
  archived: "archived",
};

// Column widths
const COL_NAME = 22;
const COL_TYPE = 14;
const COL_WIN = 9;
const COL_SHARPE = 9;
const COL_STATUS = 12;

// ============================================================================
// Helpers
// ============================================================================

interface FlatEntry {
  type: "header" | "strategy";
  tier?: StrategyTier;
  count?: number;
  strategy?: Strategy;
}

function buildFlatList(strategies: Strategy[]): FlatEntry[] {
  const grouped = new Map<StrategyTier, Strategy[]>();
  for (const tier of TIER_ORDER) {
    grouped.set(tier, []);
  }
  for (const s of strategies) {
    const list = grouped.get(s.tier);
    if (list) list.push(s);
    else grouped.get("custom")!.push(s);
  }

  const entries: FlatEntry[] = [];
  for (const tier of TIER_ORDER) {
    const items = grouped.get(tier)!;
    if (items.length === 0) continue;
    entries.push({ type: "header", tier, count: items.length });
    for (const s of items) {
      entries.push({ type: "strategy", strategy: s });
    }
  }
  return entries;
}

function selectableIndices(entries: FlatEntry[]): number[] {
  return entries
    .map((e, i) => (e.type === "strategy" ? i : -1))
    .filter((i) => i >= 0);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function StrategyBrowser({
  strategies,
  onSelect,
  onDeploy,
  onClose,
}: Props) {
  const flatList = useMemo(() => buildFlatList(strategies), [strategies]);
  const selectable = useMemo(() => selectableIndices(flatList), [flatList]);
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(selectable.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const idx = selectable[cursor];
      const entry = flatList[idx];
      if (entry?.strategy) onDeploy(entry.strategy);
      return;
    }
    if (input === " ") {
      const idx = selectable[cursor];
      const entry = flatList[idx];
      if (entry?.strategy) onSelect(entry.strategy);
    }
  });

  if (strategies.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="cyan">
          STRATEGY BROWSER
        </Text>
        <Text> </Text>
        <Text dimColor>No strategies in registry.</Text>
        <Text> </Text>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  const selectedFlatIdx = selectable[cursor];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Box>
        <Text bold color="cyan">
          STRATEGY BROWSER
        </Text>
        <Text dimColor> ({strategies.length} strategies)</Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={3}>
        <Box width={COL_NAME}>
          <Text bold dimColor>
            NAME
          </Text>
        </Box>
        <Box width={COL_TYPE}>
          <Text bold dimColor>
            TYPE
          </Text>
        </Box>
        <Box width={COL_WIN}>
          <Text bold dimColor>
            WIN %
          </Text>
        </Box>
        <Box width={COL_SHARPE}>
          <Text bold dimColor>
            SHARPE
          </Text>
        </Box>
        <Box width={COL_STATUS}>
          <Text bold dimColor>
            STATUS
          </Text>
        </Box>
      </Box>

      {flatList.map((entry, i) => {
        if (entry.type === "header") {
          const tier = entry.tier!;
          return (
            <Box key={`hdr-${tier}`} marginTop={i > 0 ? 1 : 0}>
              <Text bold color={TIER_COLOR[tier]}>
                {TIER_LABEL[tier]}
              </Text>
              <Text dimColor> ({entry.count})</Text>
            </Box>
          );
        }

        const s = entry.strategy!;
        const isFocused = i === selectedFlatIdx;
        const pointer = isFocused ? "\u25B8 " : "  ";
        const icon = STATUS_ICON[s.status];
        const sColor = STATUS_COLOR[s.status];

        return (
          <Box key={s.id} paddingLeft={1}>
            <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
            <Box width={COL_NAME}>
              <Text bold={isFocused}>{padRight(s.name, COL_NAME)}</Text>
            </Box>
            <Box width={COL_TYPE}>
              <Text dimColor>{padRight(s.type, COL_TYPE)}</Text>
            </Box>
            <Box width={COL_WIN}>
              <Text
                color={
                  s.winRate >= 60 ? "green" : s.winRate >= 45 ? "yellow" : "red"
                }
              >
                {padRight(fmtPct(s.winRate), COL_WIN)}
              </Text>
            </Box>
            <Box width={COL_SHARPE}>
              <Text
                color={
                  s.sharpe >= 1.5 ? "green" : s.sharpe >= 0.8 ? "yellow" : "red"
                }
              >
                {padRight(s.sharpe.toFixed(2), COL_SHARPE)}
              </Text>
            </Box>
            <Box width={COL_STATUS}>
              <Text color={sColor}>
                {icon} {STATUS_LABEL[s.status]}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Space details {"\u00b7"} Enter
        deploy {"\u00b7"} Esc close
      </Text>
    </Box>
  );
}
