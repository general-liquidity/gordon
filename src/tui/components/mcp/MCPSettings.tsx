import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Button } from "../../design-system/Button.js";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// MCPSettings — View and light-edit settings for one MCP server
//
// Shows current config values with hints to edit in config file.
// Fields: name, endpoint, timeout, enabled.
// [S] Save  [Esc] Cancel
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
  server: MCPServer;
  onSave: (config: Partial<MCPServer>) => void;
  onClose: () => void;
}

type Field = "name" | "endpoint" | "timeout" | "enabled" | "save" | "cancel";

const FIELD_ORDER: Field[] = ["name", "endpoint", "timeout", "enabled", "save", "cancel"];

const FIELD_LABEL: Record<Field, string> = {
  name: "Name",
  endpoint: "Endpoint",
  timeout: "Timeout (ms)",
  enabled: "Enabled",
  save: "",
  cancel: "",
};

export function MCPSettings({ server, onSave, onClose }: Props) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [enabled, setEnabled] = useState(server.status !== "disconnected");

  const focusedField = FIELD_ORDER[focusIdx] ?? "name";

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFocusIdx((i) => Math.min(FIELD_ORDER.length - 1, i + 1));
    } else if (key.return || input === "s" || input === "S") {
      if (focusedField === "cancel") {
        onClose();
        return;
      }
      if (focusedField === "save" || input === "s" || input === "S") {
        onSave({ enabled } as Partial<MCPServer>);
        return;
      }
      if (focusedField === "enabled") {
        setEnabled((e) => !e);
      }
    } else if (input === " " && focusedField === "enabled") {
      setEnabled((e) => !e);
    }
  });

  const renderField = (field: Field, value: string, hint?: string) => {
    const isFocused = focusedField === field;
    return (
      <Box key={field} marginBottom={0}>
        <Text color={isFocused ? "cyanBright" : undefined}>{isFocused ? "▸ " : "  "}</Text>
        <Text dimColor bold={false}>
          {FIELD_LABEL[field].padEnd(14)}
        </Text>
        <Text bold={isFocused} color={isFocused ? "cyanBright" : undefined}>
          {value}
        </Text>
        {hint && (
          <Text dimColor>
            {"  "}
            {hint}
          </Text>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">
          MCP SETTINGS
        </Text>
        <Text dimColor> {server.name}</Text>
      </Box>

      <Divider />

      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {renderField("name", server.name, "(edit in config file)")}
        {renderField(
          "endpoint",
          server.endpoint ?? "(stdio — no endpoint)",
          server.transport !== "stdio" ? "(edit in config file)" : undefined,
        )}
        {renderField(
          "timeout",
          server.latencyMs !== undefined ? `${server.latencyMs}ms` : "30000ms (default)",
          "(edit in config file)",
        )}

        <Box marginBottom={0}>
          <Text color={focusedField === "enabled" ? "cyanBright" : undefined}>
            {focusedField === "enabled" ? "▸ " : "  "}
          </Text>
          <Text dimColor bold={false}>
            {"Enabled".padEnd(14)}
          </Text>
          <Text
            bold={focusedField === "enabled"}
            color={focusedField === "enabled" ? "cyanBright" : enabled ? "green" : "red"}
          >
            {enabled ? "[x] Yes" : "[ ] No"}
          </Text>
          <Text dimColor>{"  Space to toggle"}</Text>
        </Box>
      </Box>

      <Divider />

      <Box marginTop={1} gap={3}>
        <Button
          label="Save"
          onPress={() => onSave({ enabled } as Partial<MCPServer>)}
          focused={focusedField === "save"}
          variant="success"
        />
        <Button
          label="Cancel"
          onPress={onClose}
          focused={focusedField === "cancel"}
          variant="danger"
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate S save Esc cancel</Text>
      </Box>
    </Box>
  );
}
