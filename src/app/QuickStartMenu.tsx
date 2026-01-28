import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
  HIGHLIGHT: "#fbbf24",
} as const;

export type MenuOption =
  | "chat"
  | "scan"
  | "portfolio"
  | "setup"
  | "help";

interface MenuItem {
  key: string;
  label: string;
  description: string;
  value: MenuOption;
}

const MENU_ITEMS: MenuItem[] = [
  {
    key: "1",
    label: "Start chatting",
    description: "Talk to Gordon about trades",
    value: "chat",
  },
  {
    key: "2",
    label: "Scan market",
    description: "Find trading opportunities",
    value: "scan",
  },
  {
    key: "3",
    label: "Check portfolio",
    description: "View positions & P/L",
    value: "portfolio",
  },
  {
    key: "4",
    label: "Run setup",
    description: "Configure exchange API",
    value: "setup",
  },
  {
    key: "5",
    label: "Help",
    description: "Learn how to use Gordon",
    value: "help",
  },
];

interface QuickStartMenuProps {
  onSelect: (option: MenuOption) => void;
}

export const QuickStartMenu: React.FC<QuickStartMenuProps> = ({ onSelect }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Handle keyboard input
  useInput((input, key) => {
    // Number key selection
    const numKey = parseInt(input, 10);
    if (numKey >= 1 && numKey <= MENU_ITEMS.length) {
      const item = MENU_ITEMS[numKey - 1];
      if (item) {
        onSelect(item.value);
      }
      return;
    }

    // Arrow key navigation
    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : MENU_ITEMS.length - 1
      );
    } else if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev < MENU_ITEMS.length - 1 ? prev + 1 : 0
      );
    }

    // Enter to select
    if (key.return) {
      const item = MENU_ITEMS[selectedIndex];
      if (item) {
        onSelect(item.value);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Quick Start
        </Text>
      </Box>

      {/* Menu items */}
      <Box flexDirection="column">
        {MENU_ITEMS.map((item, index) => {
          const isSelected = index === selectedIndex;

          return (
            <Box key={item.key} paddingY={0}>
              {/* Selection indicator */}
              <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.DIM}>
                {isSelected ? ">" : " "}
              </Text>

              {/* Key shortcut */}
              <Box width={4}>
                <Text color={COLORS.TAN_DIM}>[{item.key}]</Text>
              </Box>

              {/* Label */}
              <Box width={18}>
                <Text
                  color={isSelected ? COLORS.HIGHLIGHT : COLORS.WHITE}
                  bold={isSelected}
                >
                  {item.label}
                </Text>
              </Box>

              {/* Description */}
              <Text color={COLORS.DIM}>{item.description}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Use [1-5] or arrow keys + Enter to select
        </Text>
      </Box>
    </Box>
  );
};

export default QuickStartMenu;
