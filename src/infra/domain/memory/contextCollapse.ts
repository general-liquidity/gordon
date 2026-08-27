/**
 * Context Collapse — non-destructive read-time projection.
 *
 * Inspired by Claude Code's 5-stage compaction pipeline (the missing
 * stage in Gordon's existing 4-stage masking → pruning → aggressive →
 * full pipeline). This stage produces a *virtual* view of the
 * conversation history with stale large content blocks replaced by
 * short summary placeholders. The underlying transcript on disk is
 * untouched; only what reaches the model is projected.
 *
 * When to use vs full summarization:
 *   - Collapse is cheap (zero LLM calls) and reversible — safe to apply
 *     aggressively before a model call
 *   - Full summarization is expensive but produces a much denser
 *     representation — reserve for high pressure
 *
 * Pipeline placement: between `aggressive` (destructive trim) and
 * `full` (LLM summary). When pressure crosses the collapse threshold
 * but a full summary is overkill, run collapse first; if pressure
 * persists, escalate to full.
 *
 * Reversibility: callers can keep the side-store map and reinflate
 * specific blocks on demand (e.g. when the user asks "what was in
 * that tool result?"). The map is keyed by a stable hash of the
 * original content.
 */

import type { Message } from "../../ai/llm/types.ts";

export interface CollapseOptions {
  /** Number of trailing messages to leave untouched. Default 6. */
  recentMessagesToKeep?: number;
  /** Minimum content length (chars) to be eligible for collapse. Default 1500. */
  minLengthToCollapse?: number;
  /** Hard cap for the projected summary placeholder. Default 240 chars. */
  placeholderMaxChars?: number;
  /** Collapse user messages too? Default false (only assistant + system). */
  collapseUserMessages?: boolean;
}

export interface CollapsedBlock {
  /** Stable hash of the original content. */
  hash: string;
  /** Index of the message in the original input. */
  messageIndex: number;
  /** Original character length. */
  originalLength: number;
  /** Original content — kept in memory so callers can reinflate. */
  originalContent: string;
  /** The placeholder line that replaced it. */
  placeholder: string;
}

export interface CollapseResult {
  projected: Message[];
  /** Records of every block that was collapsed, in order. */
  collapsedBlocks: CollapsedBlock[];
  /** Total chars before collapse. */
  originalChars: number;
  /** Total chars after collapse. */
  projectedChars: number;
  /** Convenience: chars saved. */
  bytesReduced: number;
}

/** Cheap content-stable hash (FNV-1a 32-bit). Not crypto. */
function fnv1aHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** First non-empty line of the content, trimmed and length-capped. */
function firstMeaningfulLine(content: string, cap: number): string {
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
  }
  return "";
}

/**
 * Heuristic: does this content look like a tool-result-ish payload?
 * Used to bias collapse toward bulky JSON / structured output rather
 * than free-form prose where nuance matters more.
 */
function looksToolResultish(content: string): boolean {
  if (content.length < 1500) return false;
  if (/^\s*[[{]/.test(content)) return true; // starts JSON-ish
  if (/```(json|csv|tsv|xml|yaml)/i.test(content)) return true;
  if (/Tool result:|tool_result|\[GORDON_TOOL_CONTEXT\]/.test(content)) return true;
  return false;
}

/**
 * Project a message list into a collapsed view. Original messages are
 * not mutated; the result is a new array. Untouched messages share
 * references with the input so this is cheap to call.
 */
export function collapseContext(
  messages: Message[],
  options: CollapseOptions = {},
): CollapseResult {
  const recentToKeep = options.recentMessagesToKeep ?? 6;
  const minLength = options.minLengthToCollapse ?? 1500;
  const placeholderCap = options.placeholderMaxChars ?? 240;
  const collapseUser = options.collapseUserMessages ?? false;

  const projected: Message[] = new Array(messages.length);
  const collapsed: CollapsedBlock[] = [];
  let originalChars = 0;
  let projectedChars = 0;

  // Threshold index: messages at or after this index are kept verbatim.
  const verbatimThreshold = Math.max(0, messages.length - recentToKeep);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    originalChars += msg.content.length;

    const isCollapseEligible =
      i < verbatimThreshold &&
      msg.content.length >= minLength &&
      (collapseUser || msg.role !== "user") &&
      looksToolResultish(msg.content);

    if (!isCollapseEligible) {
      projected[i] = msg;
      projectedChars += msg.content.length;
      continue;
    }

    const hash = fnv1aHash(msg.content);
    const summary = firstMeaningfulLine(msg.content, placeholderCap - 60);
    const placeholder = `[CONTEXT_COLLAPSED hash=${hash} originalLen=${msg.content.length}] ${summary}`;
    projected[i] = { role: msg.role, content: placeholder };
    projectedChars += placeholder.length;
    collapsed.push({
      hash,
      messageIndex: i,
      originalLength: msg.content.length,
      originalContent: msg.content,
      placeholder,
    });
  }

  return {
    projected,
    collapsedBlocks: collapsed,
    originalChars,
    projectedChars,
    bytesReduced: originalChars - projectedChars,
  };
}

/**
 * Reinflate a specific collapsed block by hash. Returns the original
 * content if the hash matches a record in `collapsedBlocks`. Used by
 * callers that need to recover a specific tool result on demand
 * (e.g. when the user asks "what was in that response?").
 */
export function reinflateBlock(
  collapsedBlocks: CollapsedBlock[],
  hash: string,
): string | undefined {
  return collapsedBlocks.find((b) => b.hash === hash)?.originalContent;
}
