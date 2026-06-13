import type { ToolCallState } from "../components/status/ToolCallInline.tsx";

/**
 * Serialize a tool result into readable text for the inline display.
 *
 * Fixes the `[object Object]` bug: `String(obj)` yields "[object Object]", so
 * objects must be projected. Flat objects (the common shape for trading tool
 * results — `{ rsi: 53.5, macd: "bullish", price: 64086 }`) render as
 * "rsi 53.5 · macd bullish · price 64086"; nested/array shapes fall back to
 * JSON. Strings pass through untouched.
 */
export function stringifyToolResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === "string") return result.trim() || undefined;
  if (typeof result === "number" || typeof result === "boolean") return String(result);
  if (typeof result === "object" && !Array.isArray(result)) {
    const entries = Object.entries(result as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([, v]) => v == null || typeof v !== "object")) {
      return entries.map(([k, v]) => `${k} ${v == null ? "—" : String(v)}`).join(" · ");
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return undefined;
  }
}

export function completeFirstRunningCall(
  calls: ToolCallState[],
  toolName: string | undefined,
  patch: Partial<ToolCallState>,
): ToolCallState[] {
  if (!toolName) return calls;
  const index = calls.findIndex((call) => call.toolName === toolName && call.status === "running");
  if (index === -1) return calls;
  const next = [...calls];
  next[index] = { ...next[index]!, ...patch };
  return next;
}
