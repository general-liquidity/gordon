import type { ToolCallState } from "../components/status/ToolCallInline.tsx";

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
