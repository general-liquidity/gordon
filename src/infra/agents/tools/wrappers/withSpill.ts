/**
 * withSpill — HOF that wraps Mastra tools to spill oversized results to disk.
 *
 * When a tool's result serializes to more than MAX_TOOL_RESULT_CHARS, the full
 * result is written to ~/.gordon/tool-results/ and the return value is mutated
 * to include a `_spilledTo` path + a compact preview. The agent can read the
 * full result via the read_file tool if the preview is insufficient.
 *
 * Wraps an entire tool bundle at registration time — tools themselves are
 * untouched. Wrapping is transparent: small results pass through unchanged.
 */

import type { ToolResultEntry } from "../../../context/toolResultStorage.ts";
import {
  exceedsSizeCap,
  persistLargeResult,
  PREVIEW_CHARS,
} from "../../../context/toolResultStorage.ts";

interface ToolLike {
  id?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

/** Replace a large tool result payload with a preview + spill path. */
function spillIfNeeded(toolId: string, callId: string, result: unknown): unknown {
  let serialized: string;
  try {
    serialized = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    return result; // non-serializable — leave alone
  }
  if (!exceedsSizeCap(serialized)) return result;

  const { filePath, originalSize } = persistLargeResult(toolId, callId, serialized);
  const preview = serialized.slice(0, PREVIEW_CHARS);
  const sizeKB = Math.round(originalSize / 1024);

  // If the result was an object, add spill metadata; otherwise return a string.
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      _spilledTo: filePath,
      _originalSizeKB: sizeKB,
      _preview: preview,
      _note: `Result spilled to disk (${sizeKB} KB). Use read_file on _spilledTo for full content.`,
    };
  }
  return (
    `[Large tool result spilled to disk: ${filePath} (${sizeKB} KB)]\n\n` +
    `Preview:\n${preview}\n\n` +
    `Use read_file on the path above for the full result.`
  );
}

/** Wrap a single Mastra tool with spill logic. */
export function withSpill<T extends ToolLike>(tool: T): T {
  if (typeof tool.execute !== "function") return tool;
  const originalExecute = tool.execute.bind(tool);
  const toolId = String(tool.id ?? "unknown-tool");

  const wrapped = async (...args: unknown[]): Promise<unknown> => {
    const result = await originalExecute(...args);
    // Mastra passes context as second arg; try to extract a correlation ID.
    const ctx = args[1] as { toolCallId?: string; runId?: string } | undefined;
    const callId = ctx?.toolCallId ?? ctx?.runId ?? `${Date.now()}`;
    return spillIfNeeded(toolId, callId, result);
  };

  return { ...tool, execute: wrapped } as T;
}

/** Wrap every tool in a tools-bundle object with the spill HOF. */
export function withSpillAll<T extends Record<string, unknown>>(bundle: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(bundle)) {
    out[name] = withSpill(tool as ToolLike);
  }
  return out as T;
}

export type { ToolResultEntry };
