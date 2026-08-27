import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// ToolExecutionDetailDialog — Full detail view for a single tool execution
//
//   TOOL EXECUTION: get_price
//   ─────────────────────────────────
//   Args:
//     symbol: "BTC/USDT"
//     exchange: "binance"
//
//   Status: ✓ success  (234ms)
//
//   Result:
//     68432.50
//
//   [Esc] Close
// ============================================================================

export interface ToolExecution {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "success" | "error" | "canceled";
}

interface Props {
  execution: ToolExecution;
  onClose: () => void;
}

const STATUS_ICONS: Record<ToolExecution["status"], string> = {
  running: "●",
  success: "✓",
  error: "✗",
  canceled: "‒",
};

const STATUS_COLORS: Record<ToolExecution["status"], string> = {
  running: "cyanBright",
  success: "green",
  error: "red",
  canceled: "gray",
};

const RESULT_MAX_CHARS = 500;
const DIVIDER = "─".repeat(40);

function formatDuration(startedAt: number, endedAt?: number): string {
  if (!endedAt) return "";
  const ms = endedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatArgValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function ToolExecutionDetailDialog({ execution, onClose }: Props) {
  useInput((_, key) => {
    if (key.escape) onClose();
  });

  const icon = STATUS_ICONS[execution.status];
  const color = STATUS_COLORS[execution.status];
  const duration = formatDuration(execution.startedAt, execution.endedAt);
  const argEntries = Object.entries(execution.args);

  const truncatedResult =
    execution.result && execution.result.length > RESULT_MAX_CHARS
      ? `${execution.result.slice(0, RESULT_MAX_CHARS)}...`
      : execution.result;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyanBright"
      paddingX={2}
      paddingY={1}
    >
      {/* Title */}
      <Box marginBottom={0}>
        <Text bold color="cyanBright">
          TOOL EXECUTION:{" "}
        </Text>
        <Text bold>{execution.toolName}</Text>
      </Box>
      <Text dimColor>{DIVIDER}</Text>

      {/* Args */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Args:</Text>
        {argEntries.length === 0 ? (
          <Box paddingLeft={2}>
            <Text dimColor>(none)</Text>
          </Box>
        ) : (
          argEntries.map(([key, val]) => (
            <Box key={key} paddingLeft={2}>
              <Text dimColor>{key}: </Text>
              <Text>{formatArgValue(val)}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* Status */}
      <Box marginTop={1}>
        <Text bold>Status: </Text>
        <Text color={color}>
          {icon} {execution.status}
        </Text>
        {duration && <Text dimColor> ({duration})</Text>}
      </Box>

      {/* Result */}
      {truncatedResult && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Result:</Text>
          <Box paddingLeft={2}>
            <Text>{truncatedResult}</Text>
          </Box>
        </Box>
      )}

      {/* Error */}
      {execution.error && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="red">
            Error:
          </Text>
          <Box paddingLeft={2}>
            <Text color="red">{execution.error}</Text>
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>[Esc] Close</Text>
      </Box>
    </Box>
  );
}
