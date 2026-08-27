import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// MCPServerMultiselectDialog — Toggle which MCP servers are enabled/disabled
//
// Space to toggle, Enter to confirm, Esc to cancel.
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
  enabled: string[];
  onChange: (enabled: string[]) => void;
  onClose: () => void;
}

const STATUS_COLOR: Record<MCPServer["status"], string> = {
  connected: "green",
  reconnecting: "yellow",
  error: "red",
  disconnected: "gray",
};

export function MCPServerMultiselectDialog({ servers, enabled, onChange, onClose }: Props) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [localEnabled, setLocalEnabled] = useState<Set<string>>(new Set(enabled));

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setFocusIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setFocusIdx((i) => Math.min(servers.length - 1, i + 1));
      return;
    }

    if (input === " ") {
      const server = servers[focusIdx];
      if (!server) return;
      setLocalEnabled((prev) => {
        const next = new Set(prev);
        if (next.has(server.id)) {
          next.delete(server.id);
        } else {
          next.add(server.id);
        }
        return next;
      });
      return;
    }

    if (key.return) {
      onChange([...localEnabled]);
      onClose();
      return;
    }

    // Quick shortcuts: a = select all, n = select none
    if (input === "a" || input === "A") {
      setLocalEnabled(new Set(servers.map((s) => s.id)));
      return;
    }
    if (input === "n" || input === "N") {
      setLocalEnabled(new Set());
      return;
    }
  });

  const enabledCount = localEnabled.size;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">
          ENABLE / DISABLE MCP SERVERS
        </Text>
        <Text dimColor>
          {" "}
          ({enabledCount}/{servers.length} enabled)
        </Text>
      </Box>

      <Divider />

      {servers.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor> No MCP servers configured.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {servers.map((s, i) => {
            const isFocused = i === focusIdx;
            const isEnabled = localEnabled.has(s.id);
            return (
              <Box key={s.id}>
                <Text color={isFocused ? "cyanBright" : undefined}>{isFocused ? "▸ " : "  "}</Text>
                <Text color={isEnabled ? "green" : "gray"}>{isEnabled ? "[x]" : "[ ]"}</Text>
                <Text> </Text>
                <Text
                  bold={isFocused}
                  color={isFocused ? "cyanBright" : isEnabled ? undefined : "gray"}
                >
                  {s.name.padEnd(24)}
                </Text>
                <Text dimColor>{s.transport.padEnd(6)}</Text>
                <Text color={STATUS_COLOR[s.status] as any} dimColor={!isEnabled}>
                  {s.status}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate Space toggle Enter confirm A all N none Esc cancel</Text>
      </Box>
    </Box>
  );
}
