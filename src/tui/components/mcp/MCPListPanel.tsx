import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Divider } from "../Divider.js";

// ============================================================================
// MCPListPanel — Scrollable list of all MCP servers with status indicators
//
// ✓ = connected (green)
// ● = reconnecting (yellow)
// ✗ = error (red)
// ○ = disconnected (gray)
//
// Arrow keys to navigate, Enter to select, Esc to close.
// ============================================================================

interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  status: "connected" | "disconnected" | "error" | "reconnecting";
  toolCount: number;
  resourceCount?: number;
  latencyMs?: number;
  endpoint?: string;
  description?: string;
}

interface Props {
  servers: MCPServer[];
  onSelect: (server: MCPServer) => void;
  onClose: () => void;
}

const STATUS_ICON: Record<MCPServer["status"], string> = {
  connected: "✓",
  reconnecting: "●",
  error: "✗",
  disconnected: "○",
};

const STATUS_COLOR: Record<MCPServer["status"], string> = {
  connected: "green",
  reconnecting: "yellow",
  error: "red",
  disconnected: "gray",
};

function statusSummary(servers: MCPServer[]): string {
  const connected = servers.filter((s) => s.status === "connected").length;
  const errors = servers.filter((s) => s.status === "error").length;
  const parts: string[] = [];
  if (connected > 0) parts.push(`${connected} connected`);
  if (errors > 0) parts.push(`${errors} error`);
  return parts.length > 0 ? `(${parts.join(", ")})` : `(${servers.length} servers)`;
}

export function MCPListPanel({ servers, onSelect, onClose }: Props) {
  const [focusIdx, setFocusIdx] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFocusIdx((i) => Math.min(servers.length - 1, i + 1));
    } else if (key.return) {
      const selected = servers[focusIdx];
      if (selected) onSelect(selected);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">MCP SERVERS</Text>
        <Text dimColor>  {statusSummary(servers)}</Text>
      </Box>

      <Divider />

      {servers.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>  No MCP servers configured.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {servers.map((s, i) => {
            const isFocused = i === focusIdx;
            const isReconnecting = s.status === "reconnecting";
            return (
              <Box key={s.id}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? "▸ " : "  "}
                </Text>
                <Text color={STATUS_COLOR[s.status] as any}>
                  {STATUS_ICON[s.status]}
                </Text>
                <Text> </Text>
                {isReconnecting ? (
                  <Text color="yellow" bold={isFocused}>
                    {"Reconnecting...".padEnd(24)}
                  </Text>
                ) : (
                  <Text bold={isFocused} color={isFocused ? "cyanBright" : undefined}>
                    {s.name.padEnd(24)}
                  </Text>
                )}
                <Text dimColor>{s.transport.padEnd(8)}</Text>
                {isReconnecting ? (
                  <Text dimColor>{"  -"}</Text>
                ) : (
                  <>
                    <Text dimColor>{String(s.toolCount).padStart(3)} tools</Text>
                    {s.latencyMs !== undefined && (
                      <Text dimColor>{"  "}{s.latencyMs}ms</Text>
                    )}
                  </>
                )}
                {s.status === "error" && !isReconnecting && (
                  <Text color="red">{"  error"}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate  Enter select  Esc close</Text>
      </Box>
    </Box>
  );
}
