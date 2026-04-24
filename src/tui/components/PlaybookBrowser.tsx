/**
 * PlaybookBrowser -- Browse available strategy playbooks
 *
 * Grouped by category: Tier-1 Conservative, Tier-2 Intermediate, Custom.
 * Each entry shows name, description, indicators, timeframes, and risk level.
 * Arrow keys to navigate, Enter to deploy, Esc to close.
 *
 * Pattern: Claude Code agent definitions view (grouped list, no borders on items).
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// Types
// ============================================================================

export type RiskLevel = "low" | "medium" | "high" | "extreme";

export type PlaybookCategory =
  | "tier-1-conservative"
  | "tier-2-intermediate"
  | "custom";

export interface Playbook {
  id: string;
  name: string;
  description: string;
  category: PlaybookCategory;
  indicators: string[];
  timeframes: string[];
  riskLevel: RiskLevel;
}

interface Props {
  playbooks: Playbook[];
  onSelect: (playbook: Playbook) => void;
  onDeploy: (playbook: Playbook) => void;
  onClose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_ORDER: PlaybookCategory[] = [
  "tier-1-conservative",
  "tier-2-intermediate",
  "custom",
];

const CATEGORY_LABEL: Record<PlaybookCategory, string> = {
  "tier-1-conservative": "TIER 1 \u00b7 CONSERVATIVE",
  "tier-2-intermediate": "TIER 2 \u00b7 INTERMEDIATE",
  custom: "CUSTOM",
};

const CATEGORY_COLOR: Record<PlaybookCategory, string> = {
  "tier-1-conservative": "green",
  "tier-2-intermediate": "yellow",
  custom: "magenta",
};

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "green",
  medium: "yellow",
  high: "red",
  extreme: "redBright",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  extreme: "EXTREME",
};

// ============================================================================
// Helpers
// ============================================================================

interface FlatEntry {
  type: "header" | "playbook";
  category?: PlaybookCategory;
  playbook?: Playbook;
}

function buildFlatList(playbooks: Playbook[]): FlatEntry[] {
  const grouped = new Map<PlaybookCategory, Playbook[]>();
  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, []);
  }
  for (const pb of playbooks) {
    const list = grouped.get(pb.category);
    if (list) list.push(pb);
    else grouped.get("custom")!.push(pb);
  }

  const entries: FlatEntry[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = grouped.get(cat)!;
    if (items.length === 0) continue;
    entries.push({ type: "header", category: cat });
    for (const pb of items) {
      entries.push({ type: "playbook", playbook: pb });
    }
  }
  return entries;
}

function selectableIndices(entries: FlatEntry[]): number[] {
  return entries
    .map((e, i) => (e.type === "playbook" ? i : -1))
    .filter((i) => i >= 0);
}

// ============================================================================
// Component
// ============================================================================

export function PlaybookBrowser({
  playbooks,
  onSelect,
  onDeploy,
  onClose,
}: Props) {
  const flatList = useMemo(() => buildFlatList(playbooks), [playbooks]);
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
      if (idx === undefined) return;
      const entry = flatList[idx];
      if (entry?.playbook) onDeploy(entry.playbook);
      return;
    }
    if (input === " ") {
      const idx = selectable[cursor];
      if (idx === undefined) return;
      const entry = flatList[idx];
      if (entry?.playbook) onSelect(entry.playbook);
    }
  });

  if (playbooks.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="cyan">
          PLAYBOOK BROWSER
        </Text>
        <Text> </Text>
        <Text dimColor>No playbooks available.</Text>
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
          PLAYBOOK BROWSER
        </Text>
        <Text dimColor> ({playbooks.length} playbooks)</Text>
      </Box>
      <Text> </Text>

      {flatList.map((entry, i) => {
        if (entry.type === "header") {
          const cat = entry.category!;
          return (
            <Box key={`hdr-${cat}`} marginTop={i > 0 ? 1 : 0}>
              <Text bold color={CATEGORY_COLOR[cat]}>
                {CATEGORY_LABEL[cat]}
              </Text>
            </Box>
          );
        }

        const pb = entry.playbook!;
        const isFocused = i === selectedFlatIdx;
        const pointer = isFocused ? "\u25B8 " : "  ";

        return (
          <Box key={pb.id} flexDirection="column">
            <Box>
              <Text color={isFocused ? "cyanBright" : undefined}>
                {pointer}
              </Text>
              <Text bold={isFocused}>{pb.name}</Text>
              <Text> </Text>
              <Text color={RISK_COLOR[pb.riskLevel]}>
                [{RISK_LABEL[pb.riskLevel]}]
              </Text>
            </Box>
            <Box paddingLeft={4}>
              <Text dimColor>{pb.description}</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text dimColor>
                indicators: {pb.indicators.join(", ")} {"\u00b7"} tf:{" "}
                {pb.timeframes.join(", ")}
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
