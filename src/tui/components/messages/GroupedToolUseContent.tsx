import React from "react";
import { Box, Text } from "../../ink-custom";

// GroupedToolUseContent — shows multiple consecutive tool calls grouped in one line.
// Icons: ✓ green success, ✗ red error, ● cyan running.

export interface ToolEntry {
  name: string;
  status: "success" | "error" | "running";
}

interface Props {
  tools: ToolEntry[];
  onExpand?: () => void;
}

function statusIcon(status: ToolEntry["status"]): { icon: string; color: string } {
  switch (status) {
    case "success":
      return { icon: "✓", color: "green" };
    case "error":
      return { icon: "✗", color: "red" };
    case "running":
      return { icon: "●", color: "cyan" };
  }
}

export const GroupedToolUseContent = React.memo(function GroupedToolUseContent({
  tools,
  onExpand,
}: Props) {
  const n = tools.length;

  return (
    <Box flexDirection="row" marginTop={0}>
      <Text dimColor>{"⎿ "}</Text>
      <Text dimColor>
        {n} tool{n !== 1 ? "s" : ""}
        {": "}
      </Text>
      {tools.map((tool, i) => {
        const { icon, color } = statusIcon(tool.status);
        return (
          <Box key={i} flexDirection="row">
            {i > 0 && <Text dimColor>{", "}</Text>}
            <Text color={color as Parameters<typeof Text>[0]["color"]}>{icon}</Text>
            <Text> </Text>
            <Text dimColor>{tool.name}</Text>
          </Box>
        );
      })}
      {onExpand && <Text dimColor>{" [E] expand"}</Text>}
    </Box>
  );
});
