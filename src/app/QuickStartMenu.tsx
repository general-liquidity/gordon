import React from "react";
import { Box, Text } from "ink";
import { Select, Badge } from "@inkjs/ui";
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

interface QuickStartMenuProps {
  onSelect: (option: MenuOption) => void;
  mode?: Mode;
}

export const QuickStartMenu: React.FC<QuickStartMenuProps> = ({
  onSelect,
  mode = "SAFE",
}) => {
  const menuOptions = [
    { label: "Chat with Gordon", value: "chat" as MenuOption },
    { label: "Scan for opportunities", value: "scan" as MenuOption },
    { label: "View portfolio", value: "portfolio" as MenuOption },
    { label: "Trending tokens", value: "trending" as MenuOption },
    { label: "Deep analysis", value: "analyze" as MenuOption },
    { label: "Settings & API keys", value: "setup" as MenuOption },
    { label: "Help & commands", value: "help" as MenuOption },
  ];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header with Mode Badge - includes descriptive text for accessibility */}
      <Box marginBottom={1} gap={2}>
        <Text color={COLORS.ACCENT} bold>
          Quick Actions
        </Text>
        <Badge color={mode === "ARMED" ? "red" : "green"}>
          {mode === "ARMED" ? "ARMED - Live Trading" : "SAFE - Analysis Only"}
        </Badge>
      </Box>

      {/* Select Menu */}
      <Box marginBottom={1}>
        <Select
          options={menuOptions}
          onChange={(value) => onSelect(value as MenuOption)}
        />
      </Box>

      {/* Trading Mode Info - text description provides meaning beyond border color */}
      <Box
        borderStyle="single"
        borderColor={mode === "ARMED" ? COLORS.RED : COLORS.GREEN}
        paddingX={2}
        paddingY={1}
        marginTop={1}
      >
        <Box flexDirection="column">
          <Text color={COLORS.WHITE} bold>
            {mode === "SAFE" ? "[SAFE MODE]" : "[ARMED MODE]"}
          </Text>
          <Text color={COLORS.DIM}>
            {mode === "SAFE"
              ? "Analysis only - no trades will execute"
              : "Live trading enabled - trades will execute on approval"}
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Type <Text color={COLORS.ACCENT}>/arm</Text> to enable trading or{" "}
              <Text color={COLORS.ACCENT}>/disarm</Text> for safe mode
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
        marginTop={1}
      >
        <Box flexDirection="column">
          <Text color={COLORS.WHITE}>
            Chat naturally or use <Text color={COLORS.ACCENT}>/commands</Text> for quick access
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Try: "What's pumping today?" or <Text color={COLORS.ACCENT}>/trending</Text>
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default QuickStartMenu;
