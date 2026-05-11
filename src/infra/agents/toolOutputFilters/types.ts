/**
 * Tool Output Filter types — semantic compression contracts.
 *
 * A `ToolOutputFilter` is a pure function: takes a tool's raw response,
 * returns a compressed equivalent that preserves decision-bearing
 * signal. Filters MUST:
 *
 *   1. Pass through unchanged when the shape doesn't match expectations
 *      (default is identity — never lie about what happened).
 *   2. Preserve error envelopes verbatim.
 *   3. Be deterministic — same input → same output.
 *   4. Tag the result with `filterTag` so the LLM knows it's compressed
 *      and roughly what was dropped.
 */

export interface FilterResult {
  /** The compressed (or pass-through) value the orchestrator emits. */
  filtered: unknown;
  /** Char length of JSON-stringified original. */
  bytesBefore: number;
  /** Char length of JSON-stringified filtered. */
  bytesAfter: number;
  /** Short tag explaining what the filter did. Set to "passthrough" when no transform applied. */
  filterTag: string;
}

export type ToolOutputFilter = (raw: unknown) => FilterResult;

/** Helper for filters that decide to pass through. */
export function passthrough(raw: unknown): FilterResult {
  const json = safeStringifyLength(raw);
  return { filtered: raw, bytesBefore: json, bytesAfter: json, filterTag: "passthrough" };
}

export function safeStringifyLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

/** Returns true when the value looks like a tool-error envelope. */
export function looksLikeError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as { status?: unknown; error?: unknown };
  if (obj.status === "error") return true;
  if (typeof obj.error === "string" && obj.error.length > 0) return true;
  return false;
}
