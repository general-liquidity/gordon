/**
 * Per-Turn Summary primitive.
 *
 * Distills a single conversation turn (one user message + the assistant
 * response, including any embedded tool calls) into a one-line digest.
 * Stored in a small ring buffer so the TUI can render a "what happened
 * recently" navigation strip without re-summarizing the whole session.
 *
 * Different from the existing 4-stage compaction pipeline:
 *   - compaction operates on the *full* conversation when pressure
 *     crosses a threshold; it's a destructive (or projected) reshape
 *   - turnSummary operates on each turn as it completes; it's an
 *     append-only digest, never replaces the original message
 *
 * Use cases:
 *   - Long-session navigation ("jump to the turn where I asked about ETH")
 *   - /history rendering without paging the whole transcript
 *   - feeding a lightweight memory layer with recent context
 *
 * No LLM call — the digest is rule-based: extracts the user prompt's
 * first ~80 chars, counts tool calls in the assistant response, picks
 * the dominant tool family, and tags any obvious outcomes (long /
 * short / none for trading turns).
 */

import type { Message } from "../../ai/llm/types.ts";

export interface TurnSummary {
  /** Wall-clock when the turn completed. */
  completedAt: number;
  /** First ~80 chars of the user message (decoded). */
  userPrompt: string;
  /** Number of tool calls observed in the assistant response. */
  toolCallCount: number;
  /** Most-frequent tool name in the response, if any. */
  dominantTool?: string;
  /** Detected trade-action tag — long / short / scan / question / other. */
  intent: TurnIntent;
  /** First ~120 chars of the assistant's final visible reply. */
  assistantHead: string;
  /** Approximate char total of all messages in the turn (cheap budget hint). */
  charTotal: number;
}

export type TurnIntent = "long" | "short" | "scan" | "question" | "other";

const TOOL_CALL_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // Common Mastra-rendered patterns.
  { name: "tool", re: /<tool[^>]*name="([^"]+)"/g },
  { name: "tool", re: /\[tool:([^\]]+)\]/g },
  // Tool-call markers Gordon embeds in transcripts.
  { name: "tool", re: /\bcall_([a-z0-9_]+)\b/gi },
];

const INTENT_RULES: ReadonlyArray<{ intent: TurnIntent; re: RegExp }> = [
  { intent: "long", re: /\b(buy|long|enter\s+long|go\s+long|accumulate|bid)\b/i },
  { intent: "short", re: /\b(sell|short|exit|close|dump|liquidate)\b/i },
  { intent: "scan", re: /\b(scan|screen|find|hunt|sweep|movers?|trending)\b/i },
  { intent: "question", re: /\b(what|why|how|when|where|explain|tell me|status|regime)\b/i },
];

function head(s: string, cap: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= cap) return trimmed;
  return `${trimmed.slice(0, cap - 1)}…`;
}

function detectIntent(userPrompt: string): TurnIntent {
  for (const r of INTENT_RULES) {
    if (r.re.test(userPrompt)) return r.intent;
  }
  return "other";
}

function detectDominantTool(assistantContent: string): { count: number; dominant?: string } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const pattern of TOOL_CALL_PATTERNS) {
    for (const m of assistantContent.matchAll(pattern.re)) {
      const name = m[1];
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return { count: 0 };
  let dominant: string | undefined;
  let max = 0;
  for (const [name, c] of counts) {
    if (c > max) {
      max = c;
      dominant = name;
    }
  }
  return { count: total, dominant };
}

/**
 * Distill one turn into a TurnSummary. Both messages are required —
 * use this only for completed turns, not for in-flight streams.
 */
export function buildTurnSummary(
  userMessage: Message,
  assistantMessage: Message,
  options: { now?: () => number } = {},
): TurnSummary {
  const now = (options.now ?? Date.now)();
  const userPrompt = head(userMessage.content, 80);
  const tools = detectDominantTool(assistantMessage.content);
  const assistantHead = head(assistantMessage.content, 120);
  const charTotal = userMessage.content.length + assistantMessage.content.length;
  return {
    completedAt: now,
    userPrompt,
    toolCallCount: tools.count,
    ...(tools.dominant !== undefined ? { dominantTool: tools.dominant } : {}),
    intent: detectIntent(userMessage.content),
    assistantHead,
    charTotal,
  };
}

// ============================================================================
// Ring buffer — bounded store the TUI can subscribe to
// ============================================================================

export class TurnSummaryRingBuffer {
  private readonly capacity: number;
  private readonly buffer: TurnSummary[] = [];

  constructor(capacity: number = 50) {
    this.capacity = Math.max(1, capacity);
  }

  push(summary: TurnSummary): void {
    this.buffer.push(summary);
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  /** Newest-first listing. */
  list(limit?: number): TurnSummary[] {
    const reversed = [...this.buffer].reverse();
    if (limit === undefined) return reversed;
    return reversed.slice(0, Math.max(0, limit));
  }

  /** Find the most recent turn matching a substring filter on prompt or reply. */
  find(needle: string): TurnSummary | undefined {
    const lower = needle.toLowerCase();
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const t = this.buffer[i]!;
      if (
        t.userPrompt.toLowerCase().includes(lower) ||
        t.assistantHead.toLowerCase().includes(lower)
      ) {
        return t;
      }
    }
    return undefined;
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}
