import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Divider } from "../Divider.js";

// ============================================================================
// MCPToolListView — Scrollable list of tools available from one MCP server
//
// Arrow keys navigate, Enter to view detail, Esc closes.
// ============================================================================

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: object;
}

interface Props {
  serverName: string;
  tools: MCPTool[];
  onSelect: (tool: MCPTool) => void;
  onClose: () => void;
}

const PAGE_SIZE = 12;

export function MCPToolListView({ serverName, tools, onSelect, onClose }: Props) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setFocusIdx((i) => {
        const next = Math.max(0, i - 1);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
    } else if (key.downArrow) {
      setFocusIdx((i) => {
        const next = Math.min(tools.length - 1, i + 1);
        if (next >= scrollOffset + PAGE_SIZE) setScrollOffset(next - PAGE_SIZE + 1);
        return next;
      });
    } else if (key.return) {
      const selected = tools[focusIdx];
      if (selected) onSelect(selected);
    }
  });

  const visible = tools.slice(scrollOffset, scrollOffset + PAGE_SIZE);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">TOOLS: {serverName}</Text>
        <Text dimColor>  ({tools.length} tools)</Text>
      </Box>

      <Divider />

      {tools.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>  No tools available from this server.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {visible.map((tool, i) => {
            const absIdx = scrollOffset + i;
            const isFocused = absIdx === focusIdx;
            const desc = tool.description ?? "";
            const truncatedDesc = desc.length > 45 ? desc.slice(0, 42) + "..." : desc;
            return (
              <Box key={tool.name}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? "▸ " : "  "}
                </Text>
                <Text
                  bold={isFocused}
                  color={isFocused ? "cyanBright" : undefined}
                >
                  {tool.name.padEnd(28)}
                </Text>
                <Text dimColor>{truncatedDesc}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {tools.length > PAGE_SIZE && (
        <Box marginTop={1}>
          <Text dimColor>
            {scrollOffset + 1}–{Math.min(scrollOffset + PAGE_SIZE, tools.length)} of {tools.length}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate  Enter view detail  Esc back</Text>
      </Box>
    </Box>
  );
}
