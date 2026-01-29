import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS } from "./theme.ts";
import type { Mode } from "../types/index.ts";

export type MenuOption =
  | "chat"
  | "scan"
  | "portfolio"
  | "trending"
  | "analyze"
  | "setup"
  | "help";

interface MenuItem {
  key: string;
  label: string;
  description: string;
  value: MenuOption;
}

const QUICK_ACTIONS: MenuItem[] = [
  {
    key: "S",
    label: "Scan",
    description: "Find opportunities",
    value: "scan",
  },
  {
    key: "P",
    label: "Portfolio",
    description: "View balances",
    value: "portfolio",
  },
  {
    key: "T",
    label: "Trending",
    description: "Hot movers",
    value: "trending",
  },
  {
    key: "A",
    label: "Analyze",
    description: "Deep analysis",
    value: "analyze",
  },
  {
    key: "H",
    label: "Help",
    description: "Learn trading",
    value: "help",
  },
];

interface QuickStartMenuProps {
  onSelect: (option: MenuOption) => void;
  mode?: Mode;
}

export const QuickStartMenu: React.FC<QuickStartMenuProps> = ({
  onSelect,
  mode = "SAFE",
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Handle keyboard input
  useInput((input, key) => {
    // Letter key selection (case-insensitive)
    const upperInput = input.toUpperCase();
    const matchedItem = QUICK_ACTIONS.find((item) => item.key === upperInput);
    if (matchedItem) {
      onSelect(matchedItem.value);
      return;
    }

    // Number key selection (legacy support)
    const numKey = parseInt(input, 10);
    if (numKey >= 1 && numKey <= QUICK_ACTIONS.length) {
      const item = QUICK_ACTIONS[numKey - 1];
      if (item) {
        onSelect(item.value);
      }
      return;
    }

    // Arrow key navigation
    if (key.leftArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : QUICK_ACTIONS.length - 1
      );
    } else if (key.rightArrow) {
      setSelectedIndex((prev) =>
        prev < QUICK_ACTIONS.length - 1 ? prev + 1 : 0
      );
    } else if (key.upArrow || key.downArrow) {
      // Up/down also navigate in case user expects vertical
      if (key.upArrow) {
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : QUICK_ACTIONS.length - 1
        );
      } else {
        setSelectedIndex((prev) =>
          prev < QUICK_ACTIONS.length - 1 ? prev + 1 : 0
        );
      }
    }

    // Enter to select
    if (key.return) {
      const item = QUICK_ACTIONS[selectedIndex];
      if (item) {
        onSelect(item.value);
      }
    }

    // C to start chatting
    if (upperInput === "C") {
      onSelect("chat");
    }
  });

  const modeColor = mode === "ARMED" ? COLORS.RED : COLORS.GREEN;
  const modeIcon = mode === "ARMED" ? "!" : "o";
  const modeLabel = mode === "ARMED" ? "ARMED" : "SAFE";

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Quick Actions Header */}
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          Quick Actions
        </Text>
      </Box>

      {/* Action buttons in a row */}
      <Box flexDirection="row" marginBottom={1}>
        {QUICK_ACTIONS.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box key={item.key} marginRight={2}>
              <Text
                color={isSelected ? COLORS.HIGHLIGHT : COLORS.ACCENT_DIM}
                bold={isSelected}
              >
                [{item.key}]
              </Text>
              <Text color={isSelected ? COLORS.WHITE : COLORS.DIM}>
                {" "}{item.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Selected item description */}
      <Box marginBottom={2}>
        <Text color={COLORS.DIM}>
          {QUICK_ACTIONS[selectedIndex]?.description ?? ""}
        </Text>
      </Box>

      {/* Trading Mode Section */}
      <Box
        borderStyle="single"
        borderColor={modeColor}
        paddingX={2}
        paddingY={1}
        marginBottom={1}
      >
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.DIM}>Trading Mode: </Text>
            <Text color={modeColor} bold>
              [{modeIcon}] {modeLabel}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              {mode === "SAFE"
                ? "Analysis only - no trades will execute"
                : "Live trading enabled - trades will execute on approval"}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Type{" "}
              <Text color={COLORS.ACCENT}>/arm</Text>
              {" "}to enable trading or{" "}
              <Text color={COLORS.ACCENT}>/disarm</Text>
              {" "}for safe mode
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Tip */}
      <Box
        borderStyle="round"
        borderColor={COLORS.DIM}
        paddingX={2}
        paddingY={1}
      >
        <Box flexDirection="column">
          <Text color={COLORS.WHITE}>
            Chat naturally or use <Text color={COLORS.ACCENT}>/commands</Text> for quick access
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Try: "What's pumping today?" or{" "}
              <Text color={COLORS.ACCENT}>/trending</Text>
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Press [C] to start chatting | Arrow keys + Enter to select | [S/P/T/A/H] for quick actions
        </Text>
      </Box>
    </Box>
  );
};

export default QuickStartMenu;
