import { Box, Text } from "../../ink-custom";

// ============================================================================
// ToolActivityList — Inline tool call activity renderer (no borders)
//
//   ⎿ ✓ get_price BTC/USDT → $68,432  (234ms)
//   ⎿ ● place_market_order SELL 0.5 BTC...
//   ⎿ ✗ get_order_status  error: timeout
//
// ● cyan for running, ✓ green for success, ✗ red for error
// ============================================================================

export interface ToolActivity {
  toolName: string;
  status: "running" | "success" | "error";
  args?: Record<string, unknown>;
  result?: string;
  durationMs?: number;
}

interface Props {
  activities: ToolActivity[];
  maxVisible?: number;
}

const STATUS_ICONS: Record<ToolActivity["status"], string> = {
  running: "●",
  success: "✓",
  error: "✗",
};

const STATUS_COLORS: Record<ToolActivity["status"], string> = {
  running: "cyanBright",
  success: "green",
  error: "red",
};

const BRANCH = "⎿";

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const entries = Object.values(args);
  if (entries.length === 0) return "";
  const parts = entries.map((v) => {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  });
  return parts.join(" ");
}

function formatResult(result?: string): string {
  if (!result) return "";
  const trimmed = result.trim();
  // Keep result compact — max 40 chars inline
  if (trimmed.length > 40) return `${trimmed.slice(0, 40)}...`;
  return trimmed;
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolActivityList({ activities, maxVisible }: Props) {
  const visible = maxVisible != null ? activities.slice(0, maxVisible) : activities;
  const hiddenCount = activities.length - visible.length;

  if (visible.length === 0) return null;

  return (
    <Box flexDirection="column">
      {visible.map((activity, i) => {
        const icon = STATUS_ICONS[activity.status];
        const color = STATUS_COLORS[activity.status];
        const argsStr = formatArgs(activity.args);
        const resultStr = formatResult(activity.result);
        const durationStr = formatDuration(activity.durationMs);

        return (
          <Box key={i} flexDirection="row">
            <Text dimColor>{BRANCH} </Text>
            <Text color={color}>{icon} </Text>
            <Text bold>{activity.toolName}</Text>
            {argsStr && (
              <>
                <Text> </Text>
                <Text dimColor>{argsStr}</Text>
              </>
            )}
            {activity.status === "success" && resultStr && (
              <>
                <Text dimColor> {"→"} </Text>
                <Text color="green">{resultStr}</Text>
              </>
            )}
            {activity.status === "error" && activity.result && (
              <>
                <Text dimColor> error: </Text>
                <Text color="red">{formatResult(activity.result)}</Text>
              </>
            )}
            {durationStr && <Text dimColor> ({durationStr})</Text>}
          </Box>
        );
      })}
      {hiddenCount > 0 && (
        <Box>
          <Text dimColor>{BRANCH} </Text>
          <Text dimColor>...{hiddenCount} more</Text>
        </Box>
      )}
    </Box>
  );
}
