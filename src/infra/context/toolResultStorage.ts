/**
 * Disk Spill for Large Tool Results
 *
 * Problem: Gordon tools like backtests, historical candle fetches, full
 * orderbook dumps, or cross-venue scans can return 100KB+ of JSON. Dumping
 * these directly into the agent's context window burns through budget and
 * crashes long sessions.
 *
 * Solution: When a tool result exceeds MAX_TOOL_RESULT_CHARS, write it to
 * ~/.gordon/tool-results/ and replace the in-context content with a compact
 * preview + file path. The agent can read the full result via the read_file
 * tool if it actually needs the full payload.
 *
 * Per-turn budget (MAX_TURN_RESULT_CHARS) caps the total across all parallel
 * tool calls — spills the largest results first until the turn fits.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

/** Per-result cap: anything larger gets spilled to disk. */
export const MAX_TOOL_RESULT_CHARS = 50_000;

/** Per-turn cap across all parallel tool results. */
export const MAX_TURN_RESULT_CHARS = 200_000;

/** Characters retained as in-context preview after spill. */
export const PREVIEW_CHARS = 2_000;

const RESULTS_DIR = join(GORDON_DIR, "tool-results");

function ensureDir(): void {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

export interface PersistedResult {
  preview: string;
  filePath: string;
  originalSize: number;
}

/** Write a large tool result to disk; return preview + path. */
export function persistLargeResult(
  toolName: string,
  toolCallId: string,
  result: string,
): PersistedResult {
  ensureDir();
  const sanitized = `${toolName}_${toolCallId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = join(RESULTS_DIR, `${sanitized}.txt`);
  writeFileSync(filePath, result, { encoding: "utf-8", mode: 0o600 });

  return {
    preview: result.slice(0, PREVIEW_CHARS),
    filePath,
    originalSize: result.length,
  };
}

/** Build the in-context replacement content for a spilled result. */
export function buildPersistedContent(
  filePath: string,
  preview: string,
  originalSizeBytes: number,
): string {
  const sizeKB = Math.round(originalSizeBytes / 1024);
  return (
    `[Large tool result spilled to disk: ${filePath} (${sizeKB} KB)]\n\n` +
    `Preview:\n${preview}\n\n` +
    `Use read_file on the path above to load the full result if needed.`
  );
}

export function exceedsSizeCap(content: string): boolean {
  return content.length > MAX_TOOL_RESULT_CHARS;
}

export interface ToolResultEntry {
  toolName: string;
  toolCallId: string;
  content: string;
}

export interface SpillDecision {
  entry: ToolResultEntry;
  spilled: boolean;
  replacementContent?: string;
  filePath?: string;
}

/**
 * Apply per-turn budget: while total exceeds MAX_TURN_RESULT_CHARS, spill the
 * largest result to disk. Returns the full set with spilled entries replaced
 * by their preview+path content.
 */
export function enforceResultBudget(entries: ToolResultEntry[]): SpillDecision[] {
  const totalChars = entries.reduce((sum, e) => sum + e.content.length, 0);

  if (totalChars <= MAX_TURN_RESULT_CHARS) {
    return entries.map((entry) => ({ entry, spilled: false }));
  }

  // Sort by size (largest first) to choose spill candidates.
  const indexed = entries.map((entry, index) => ({ entry, index }));
  const bySize = [...indexed].sort(
    (a, b) => b.entry.content.length - a.entry.content.length,
  );

  let remaining = totalChars;
  const spillIdx = new Set<number>();
  for (const { index, entry } of bySize) {
    if (remaining <= MAX_TURN_RESULT_CHARS) break;
    spillIdx.add(index);
    remaining -= entry.content.length;
    remaining += PREVIEW_CHARS + 500; // replacement approximate size
  }

  return entries.map((entry, index): SpillDecision => {
    if (!spillIdx.has(index)) return { entry, spilled: false };
    const { preview, filePath, originalSize } = persistLargeResult(
      entry.toolName,
      entry.toolCallId,
      entry.content,
    );
    return {
      entry,
      spilled: true,
      replacementContent: buildPersistedContent(filePath, preview, originalSize),
      filePath,
    };
  });
}

/**
 * Convenience: apply both per-result and per-turn spills in a single pass.
 * Returns the list of {entry, spilled, replacementContent} decisions.
 */
export function spillOversized(entries: ToolResultEntry[]): SpillDecision[] {
  // First pass: single-result oversize spill.
  const afterSingle: ToolResultEntry[] = entries.map((e) => {
    if (!exceedsSizeCap(e.content)) return e;
    const { preview, filePath, originalSize } = persistLargeResult(
      e.toolName,
      e.toolCallId,
      e.content,
    );
    return {
      ...e,
      content: buildPersistedContent(filePath, preview, originalSize),
    };
  });
  // Second pass: per-turn budget.
  return enforceResultBudget(afterSingle);
}
