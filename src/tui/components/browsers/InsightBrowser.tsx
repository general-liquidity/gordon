/**
 * InsightBrowser — Browse accumulated trading insights
 *
 * Filterable by category using Tabs. Each insight shows confidence bar,
 * text, source count, and date. Scrollable list.
 *
 * Pattern: Claude Code knowledge browser with category filtering.
 */

import { useState, useMemo } from "react";
import { Box, Text } from "../../ink-custom";
import { useRoutedInput, FOCUS_PRIORITY } from "../../input/InputRouterContext.tsx";
import { Pane } from "../../design-system/Pane.js";
import { Tabs } from "../../design-system/Tabs.js";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export interface Insight {
  id: string;
  text: string;
  confidence: number;
  sourceTradeIds: string[];
  createdAt: string;
  category: string;
}

interface Props {
  insights: Insight[];
  onClose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_TABS = [
  { key: "all", label: "All" },
  { key: "timing", label: "Timing" },
  { key: "sizing", label: "Sizing" },
  { key: "strategy", label: "Strategy" },
  { key: "risk", label: "Risk" },
];

// ============================================================================
// Helpers
// ============================================================================

function confidenceColor(c: number): string {
  if (c >= 80) return "green";
  if (c >= 50) return "yellow";
  return "red";
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

// ============================================================================
// Component
// ============================================================================

export function InsightBrowser({ insights, onClose }: Props) {
  const [activeTab, setActiveTab] = useState("all");
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo(() => {
    if (activeTab === "all") return insights;
    return insights.filter((ins) => ins.category.toLowerCase() === activeTab);
  }, [insights, activeTab]);

  useRoutedInput(
    (_input, key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(filtered.length - 1, c + 1));
      }
    },
    { id: "insightBrowser", priority: FOCUS_PRIORITY.DIALOG },
  );

  return (
    <Pane title="TRADING INSIGHTS">
      <Tabs
        tabs={CATEGORY_TABS}
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setCursor(0);
        }}
      >
        <Box>
          <Text dimColor>({filtered.length} insights)</Text>
        </Box>
        <Text> </Text>

        {filtered.length === 0 ? (
          <Text dimColor>No insights in this category.</Text>
        ) : (
          <Box flexDirection="column">
            {filtered.map((ins, i) => {
              const isFocused = i === cursor;
              const pointer = isFocused ? "\u25B8 " : "  ";

              return (
                <Box key={ins.id} flexDirection="column">
                  <Box>
                    <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
                    <ProgressBar
                      value={ins.confidence / 100}
                      width={6}
                      fillColor={confidenceColor(ins.confidence)}
                    />
                    <Text color={confidenceColor(ins.confidence)}> {ins.confidence}% </Text>
                    <Text bold={isFocused} wrap="truncate">
                      {ins.text.slice(0, 50)}
                    </Text>
                  </Box>
                  <Box paddingLeft={4}>
                    <Text dimColor>
                      {ins.sourceTradeIds.length} source{ins.sourceTradeIds.length !== 1 ? "s" : ""}{" "}
                      {"\u00b7"} {formatDate(ins.createdAt)} {"\u00b7"} {ins.category}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Tabs>

      <Text> </Text>
      <Text dimColor>
        {"\u2190\u2192"} category {"\u00b7"} {"\u2191\u2193"} navigate {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
