import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";

/**
 * MCPManager — Interactive MCP server management
 *
 * /mcp opens this dialog:
 *   - List connected servers with status
 *   - Add new server (name, transport, command)
 *   - Remove server
 *   - Check server health
 */

interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  status: "connected" | "disconnected" | "error";
  toolCount: number;
  endpoint?: string;
}

interface Props {
  servers: MCPServer[];
  onAdd: (config: { name: string; transport: string; command: string }) => void;
  onRemove: (id: string) => void;
  onReconnect: (id: string) => void;
  onCancel: () => void;
}

type Step = "menu" | "list" | "add_name" | "add_transport" | "add_command" | "remove";

const ACTIONS = [
  { label: "List connected servers", value: "list" },
  { label: "Add new MCP server", value: "add" },
  { label: "Remove server", value: "remove" },
  { label: "Reconnect failed server", value: "reconnect" },
];

const TRANSPORTS = [
  { label: "stdio (local process)", value: "stdio" },
  { label: "HTTP (remote server)", value: "http" },
  { label: "SSE (server-sent events)", value: "sse" },
];

const STATUS_ICONS: Record<string, string> = {
  connected: "\u2713",
  disconnected: "\u25CB",
  error: "\u2717",
};

const STATUS_COLORS: Record<string, string> = {
  connected: "green",
  disconnected: "gray",
  error: "red",
};

export function MCPManager({ servers, onAdd, onRemove, onReconnect, onCancel }: Props) {
  const [step, setStep] = useState<Step>("menu");
  const [newName, setNewName] = useState("");
  const [newTransport, setNewTransport] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "menu") onCancel();
      else setStep("menu");
    }
  });

  // ── List view ──
  if (step === "list") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyanBright">MCP SERVERS</Text>
          <Text dimColor>  ({servers.length} configured)</Text>
        </Box>
        {servers.length === 0 && <Text dimColor>  No MCP servers configured. Use "Add new" to connect one.</Text>}
        {servers.map((s) => (
          <Box key={s.id}>
            <Text color={STATUS_COLORS[s.status] as any}> {STATUS_ICONS[s.status]} </Text>
            <Text bold>{s.name.padEnd(25)}</Text>
            <Text dimColor>{s.transport.padEnd(8)}</Text>
            <Text>{s.toolCount} tools</Text>
            {s.endpoint && <Text dimColor>  {s.endpoint}</Text>}
          </Box>
        ))}
        <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
      </Box>
    );
  }

  // ── Add flow ──
  if (step === "add_transport") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">ADD MCP SERVER</Text>
        <Text dimColor>Name: {newName}</Text>
        <Text bold>Select transport:</Text>
        <Box marginTop={1}>
          <Select options={TRANSPORTS} onChange={(v) => { setNewTransport(v); setStep("add_command"); }} />
        </Box>
        <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
      </Box>
    );
  }

  if (step === "add_command") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">ADD MCP SERVER</Text>
        <Text dimColor>Name: {newName} | Transport: {newTransport}</Text>
        <Text bold>Enter command (e.g., npx -y @coingecko/coingecko-mcp):</Text>
        <Box marginTop={1}>
          <Text color="cyanBright">{"\u276F"} </Text>
          <Text dimColor>Type command and press Enter</Text>
        </Box>
        <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
      </Box>
    );
  }

  // ── Remove flow ──
  if (step === "remove") {
    if (servers.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          <Text bold color="cyanBright">REMOVE MCP SERVER</Text>
          <Text dimColor>No servers to remove.</Text>
          <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">REMOVE MCP SERVER</Text>
        <Text dimColor>Select server to remove:</Text>
        <Box marginTop={1}>
          <Select
            options={servers.map((s) => ({ label: `${s.name} (${s.transport}, ${s.toolCount} tools)`, value: s.id }))}
            onChange={(id) => { onRemove(id); setStep("menu"); }}
          />
        </Box>
        <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
      </Box>
    );
  }

  // ── Main menu ──
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">MCP SERVER MANAGEMENT</Text>
        <Text dimColor>  ({servers.filter((s) => s.status === "connected").length}/{servers.length} connected)</Text>
      </Box>
      <Select
        options={ACTIONS}
        onChange={(action) => {
          if (action === "list") setStep("list");
          else if (action === "add") setStep("add_transport");
          else if (action === "remove") setStep("remove");
          else if (action === "reconnect") {
            const failed = servers.find((s) => s.status === "error");
            if (failed) onReconnect(failed.id);
          }
        }}
      />
      <Box marginTop={1}><Text dimColor>Esc to close</Text></Box>
    </Box>
  );
}
