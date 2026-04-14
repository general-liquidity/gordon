// ============================================================================
// Context Snipping — Rule-based Layer 0 compression before AI summarization
//
// No LLM cost — pure text manipulation. Runs BEFORE auto-compact.
//
// Rules:
// 1. Tool results older than N turns get truncated to first 500 chars
//    + "... (snipped N chars)"
// 2. Repeated read operations on same file: keep only latest
// 3. Large JSON responses (>2000 chars): collapse to schema summary
// 4. Stack traces: keep first 5 lines + last 2 lines
// 5. Duplicate consecutive system messages: fold into one
// ============================================================================

export interface SnipResult {
  snipped: boolean;
  originalTokens: number;
  snippedTokens: number;
  tokensSaved: number;
  rulesApplied: string[];
}

interface Message {
  role: string;
  content: string;
  toolName?: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Rule implementations
// ============================================================================

/** Rule 1: Truncate old tool results beyond the preserve window. */
function snipOldToolResults(
  messages: Message[],
  preserveLastN: number,
  maxAge: number,
  maxLen: number,
): { messages: Message[]; applied: boolean } {
  let applied = false;
  const cutoff = messages.length - preserveLastN;

  const result = messages.map((msg, i) => {
    if (i >= cutoff) return msg;
    if (msg.role !== "tool" && msg.role !== "assistant") return msg;
    if (!msg.toolName) return msg;

    // Check if this message is "old enough" — approximate by position
    const age = messages.length - i;
    if (age < maxAge) return msg;
    if (msg.content.length <= maxLen) return msg;

    applied = true;
    const snippedChars = msg.content.length - maxLen;
    return {
      ...msg,
      content: msg.content.slice(0, maxLen) + `\n... (snipped ${snippedChars} chars)`,
    };
  });

  return { messages: result, applied };
}

/** Rule 2: Deduplicate repeated reads — keep only the latest per file. */
function deduplicateReads(
  messages: Message[],
  preserveLastN: number,
): { messages: Message[]; applied: boolean } {
  let applied = false;
  const cutoff = messages.length - preserveLastN;

  // Find file read tool results by scanning for file path patterns
  const readPattern = /^(Read|cat|read_file)\b/i;
  const filePathPattern = /(?:\/[\w./-]+|[A-Z]:\\[\w.\\-]+)/;

  // Track latest read index per file path
  const latestReadIndex = new Map<string, number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !msg.toolName || !readPattern.test(msg.toolName)) continue;

    const match = msg.content.match(filePathPattern);
    if (match) {
      latestReadIndex.set(match[0]!, i);
    }
  }

  const result = messages.filter((msg, i) => {
    if (i >= cutoff) return true;
    if (!msg.toolName || !readPattern.test(msg.toolName)) return true;

    const match = msg.content.match(filePathPattern);
    if (!match) return true;

    const latest = latestReadIndex.get(match[0]);
    if (latest !== undefined && latest !== i) {
      applied = true;
      return false;
    }
    return true;
  });

  return { messages: result, applied };
}

/** Rule 3: Collapse large JSON to schema summary. */
function collapseJsonResponses(
  messages: Message[],
  preserveLastN: number,
  maxJsonLen: number,
): { messages: Message[]; applied: boolean } {
  let applied = false;
  const cutoff = messages.length - preserveLastN;

  const result = messages.map((msg, i) => {
    if (i >= cutoff) return msg;
    if (msg.content.length <= maxJsonLen) return msg;

    // Check if content looks like JSON
    const trimmed = msg.content.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return msg;

    try {
      const parsed = JSON.parse(trimmed);
      const schema = extractJsonSchema(parsed);
      applied = true;
      return {
        ...msg,
        content: `[JSON collapsed — schema: ${JSON.stringify(schema)}] (original ${msg.content.length} chars)`,
      };
    } catch {
      return msg;
    }
  });

  return { messages: result, applied };
}

/** Extract a rough schema from a JSON value (keys + types, no values). */
function extractJsonSchema(value: any, depth = 0): any {
  if (depth > 3) return "...";

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return [extractJsonSchema(value[0], depth + 1), `...(${value.length} items)`];
  }

  if (value !== null && typeof value === "object") {
    const schema: Record<string, string> = {};
    for (const key of Object.keys(value).slice(0, 10)) {
      const v = value[key];
      if (Array.isArray(v)) {
        schema[key] = `array(${v.length})`;
      } else if (v !== null && typeof v === "object") {
        schema[key] = `object(${Object.keys(v).length} keys)`;
      } else {
        schema[key] = typeof v;
      }
    }
    const totalKeys = Object.keys(value).length;
    if (totalKeys > 10) {
      schema["..."] = `+${totalKeys - 10} more keys`;
    }
    return schema;
  }

  return typeof value;
}

/** Rule 4: Compact stack traces — keep first 5 lines + last 2. */
function snipStackTraces(
  messages: Message[],
  preserveLastN: number,
): { messages: Message[]; applied: boolean } {
  let applied = false;
  const cutoff = messages.length - preserveLastN;

  const stackPattern = /(?:^\s+at\s.+$\n?){6,}/gm;

  const result = messages.map((msg, i) => {
    if (i >= cutoff) return msg;

    const match = stackPattern.exec(msg.content);
    if (!match) return msg;

    const newContent = msg.content.replace(stackPattern, (block) => {
      const lines = block.trim().split("\n");
      if (lines.length <= 7) return block;

      applied = true;
      const head = lines.slice(0, 5).join("\n");
      const tail = lines.slice(-2).join("\n");
      const snippedCount = lines.length - 7;
      return `${head}\n    ... (${snippedCount} frames snipped)\n${tail}`;
    });

    return { ...msg, content: newContent };
  });

  return { messages: result, applied };
}

/** Rule 5: Fold duplicate consecutive system messages. */
function foldDuplicateSystemMessages(
  messages: Message[],
  preserveLastN: number,
): { messages: Message[]; applied: boolean } {
  let applied = false;
  const cutoff = messages.length - preserveLastN;
  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (i >= cutoff) {
      result.push(msg);
      continue;
    }

    const prev = result[result.length - 1];

    if (
      prev &&
      msg.role === "system" &&
      prev.role === "system" &&
      msg.content === prev.content
    ) {
      applied = true;
      continue; // skip duplicate
    }

    result.push(msg);
  }

  return { messages: result, applied };
}

// ============================================================================
// Main entry point
// ============================================================================

export function snipContext(
  messages: Message[],
  options?: {
    maxToolResultAge?: number;
    maxToolResultLength?: number;
    maxJsonLength?: number;
    preserveLastN?: number;
  },
): { messages: Message[]; result: SnipResult } {
  const maxAge = options?.maxToolResultAge ?? 10;
  const maxLen = options?.maxToolResultLength ?? 500;
  const maxJsonLen = options?.maxJsonLength ?? 2000;
  const preserveLastN = options?.preserveLastN ?? 6;

  const originalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const rulesApplied: string[] = [];

  let current = messages.map((m) => ({ ...m }));

  // Rule 1: Truncate old tool results
  const r1 = snipOldToolResults(current, preserveLastN, maxAge, maxLen);
  current = r1.messages;
  if (r1.applied) rulesApplied.push("truncate_old_tool_results");

  // Rule 2: Deduplicate repeated reads
  const r2 = deduplicateReads(current, preserveLastN);
  current = r2.messages;
  if (r2.applied) rulesApplied.push("deduplicate_reads");

  // Rule 3: Collapse large JSON
  const r3 = collapseJsonResponses(current, preserveLastN, maxJsonLen);
  current = r3.messages;
  if (r3.applied) rulesApplied.push("collapse_json");

  // Rule 4: Compact stack traces
  const r4 = snipStackTraces(current, preserveLastN);
  current = r4.messages;
  if (r4.applied) rulesApplied.push("snip_stack_traces");

  // Rule 5: Fold duplicate system messages
  const r5 = foldDuplicateSystemMessages(current, preserveLastN);
  current = r5.messages;
  if (r5.applied) rulesApplied.push("fold_duplicate_system");

  const snippedTokens = current.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    messages: current,
    result: {
      snipped: rulesApplied.length > 0,
      originalTokens,
      snippedTokens,
      tokensSaved: originalTokens - snippedTokens,
      rulesApplied,
    },
  };
}
