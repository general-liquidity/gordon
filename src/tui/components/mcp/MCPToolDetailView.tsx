import type React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// MCPToolDetailView — Full detail for one MCP tool
//
// Shows name, description, input schema fields, last result, and latency.
// Esc to go back.
// ============================================================================

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: object;
}

interface Props {
  tool: MCPTool;
  lastResult?: string;
  latencyMs?: number;
  onClose: () => void;
}

interface SchemaProperty {
  type?: string;
  description?: string;
  [key: string]: unknown;
}

interface SchemaObject {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

function renderSchema(schema: object): React.ReactNode {
  const s = schema as SchemaObject;
  if (!s.properties) {
    return (
      <Box>
        <Text dimColor> (no input parameters)</Text>
      </Box>
    );
  }

  const required = new Set<string>(s.required ?? []);
  const entries = Object.entries(s.properties);

  return (
    <Box flexDirection="column">
      {entries.map(([key, prop]) => {
        const isRequired = required.has(key);
        const typeName = prop.type ?? "any";
        return (
          <Box key={key}>
            <Text dimColor> </Text>
            <Text color="cyanBright">{key}</Text>
            <Text dimColor>: {typeName}</Text>
            {!isRequired && <Text dimColor> (optional)</Text>}
            {prop.description && <Text dimColor> — {prop.description}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}

export function MCPToolDetailView({ tool, lastResult, latencyMs, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">
          TOOL: {tool.name}
        </Text>
      </Box>

      <Divider />

      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text dimColor>Description: </Text>
          <Text>{tool.description ?? "(no description)"}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text bold>Input Schema:</Text>
        </Box>

        {tool.inputSchema ? (
          renderSchema(tool.inputSchema)
        ) : (
          <Box>
            <Text dimColor> (no schema defined)</Text>
          </Box>
        )}

        {lastResult !== undefined && (
          <Box marginTop={1}>
            <Text dimColor>Last result: </Text>
            <Text color="green">{lastResult}</Text>
            {latencyMs !== undefined && <Text dimColor> ({latencyMs}ms)</Text>}
          </Box>
        )}

        {lastResult === undefined && latencyMs !== undefined && (
          <Box marginTop={1}>
            <Text dimColor>Latency: {latencyMs}ms</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[Esc] Back</Text>
      </Box>
    </Box>
  );
}
