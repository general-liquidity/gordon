/**
 * Quick Actions Component
 * Shows clickable/selectable buttons for frequent commands
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";

interface QuickAction {
  icon: string;
  label: string;
  command: string;
}

/**
 * Terminal-safe Unicode symbols for quick actions
 * These work across all terminal emulators without emoji support issues
 * Each action includes both icon and label for accessibility
 */
const QUICK_ACTIONS: QuickAction[] = [
  { icon: "◆", label: "Scan", command: "/scan" },         // Diamond - analysis/data
  { icon: "▲", label: "Trending", command: "/trending" }, // Up arrow - movement
  { icon: "■", label: "Portfolio", command: "/portfolio" }, // Square - holdings
  { icon: "≡", label: "Positions", command: "/positions" }, // Menu - list
  { icon: "●", label: "Status", command: "/status" },     // Circle - status indicator
];

/**
 * Text descriptions for icons (for screen readers and accessibility)
 * Maps icon to descriptive text that conveys the same meaning
 */
const ICON_DESCRIPTIONS: Record<string, string> = {
  "◆": "scan",      // Diamond represents data/analysis
  "▲": "up",        // Arrow represents trending/movement
  "■": "view",      // Square represents holdings/portfolio
  "≡": "list",      // Menu represents positions list
  "●": "check",     // Circle represents status check
};

interface QuickActionsProps {
  onSelect: (command: string) => void;
  selectedIndex: number;
  visible: boolean;
}

export function QuickActions({
  onSelect,
  selectedIndex,
  visible,
}: QuickActionsProps): React.ReactElement | null {
  if (!visible) {
    return null;
  }

  return (
    <Box marginBottom={1} marginX={1} paddingX={1}>
      <Text color={COLORS.DIM}>Quick Actions: </Text>
      {QUICK_ACTIONS.map((action, i) => {
        const isSelected = i === selectedIndex;
        // Include both icon and full label text for accessibility
        // The label provides meaning when icons cannot be seen
        return (
          <Box key={action.command} marginRight={2}>
            <Text
              color={isSelected ? COLORS.HIGHLIGHT : COLORS.WHITE}
              inverse={isSelected}
            >
              {" "}{action.icon} {action.label}{" "}
            </Text>
            <Text color={COLORS.DIM} dimColor>
              [{i + 1}]
            </Text>
            {isSelected && (
              <Text color={COLORS.DIM}> ({action.command})</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function getQuickActionCommand(index: number): string | null {
  const action = QUICK_ACTIONS[index];
  return action ? action.command : null;
}

export function getQuickActionsCount(): number {
  return QUICK_ACTIONS.length;
}

export { QUICK_ACTIONS };
