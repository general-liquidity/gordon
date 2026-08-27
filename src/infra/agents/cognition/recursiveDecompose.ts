/**
 * Recursive Context Decomposition — Gordon's RLM (Recursive Language Model)
 * primitive.
 *
 * From the Hitchhiker's Guide to Agentic AI (pp.345-347):
 *
 *     RLM(q, C) = M(q, RLM(q1, C1), RLM(q2, C2), ...)
 *
 * An oversized input C is partitioned into chunks C1..Cn. A scoped sub-query
 * is run per chunk (each sub-call sees only its chunk, never the whole input),
 * and the partial answers are synthesized into a final answer to q. When the
 * combined partial answers are themselves too large, the aggregation recurses —
 * so no single LLM call ever sees the entire input. This defeats context-rot on
 * long inputs (a 500-page 10-K, a multi-year trade ledger, a full news history)
 * where a single stuffed call degrades.
 *
 * How this differs from Gordon's existing context tools:
 *   - summarizer.ts (compaction) + contextCollapse.ts shrink-in-place — they
 *     project/prune a context that is already loaded. RLM never loads the whole
 *     thing.
 *   - investigation.ts / contextFork.ts sub-agents are synthesis-only over the
 *     PARENT conversation. RLM partitions a NEW oversized input the parent hands
 *     it and runs one scoped sub-call per partition.
 *
 * Safety: this is read-only reasoning over text. It executes no tools, places
 * no orders. The LLM caller is dependency-injected so the primitive is
 * fake-testable (stub the caller) and provider-agnostic.
 */

export interface DecomposeMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Injected LLM caller — one round, messages in, text out. */
export type DecomposeLLM = (messages: DecomposeMessage[]) => Promise<string>;

export interface RecursiveDecomposeRequest {
  /** The question to answer against the (possibly oversized) input. */
  query: string;
  /** The full input to decompose. Passed through untouched when it fits budget. */
  input: string;
  /**
   * Per-chunk size budget in characters (a coarse token proxy — ~4 chars/token).
   * Input at or below this is answered in a single scoped call, no decomposition.
   * Default 8000 (~2000 tokens).
   */
  maxChunkChars?: number;
  /**
   * Max chunks issued concurrently per level. Also the branching cap — keeps
   * fan-out bounded so a huge input can't spawn hundreds of parallel calls.
   * Default 5.
   */
  maxFanOut?: number;
  /** Recursion depth cap on the aggregation tree. Default 3. */
  maxDepth?: number;
  /** Optional override of the scoped-sub-query system prompt. */
  subQuerySystemPrompt?: string;
  /** Optional override of the synthesis system prompt. */
  synthesisSystemPrompt?: string;
}

export interface RecursiveDecomposeResult {
  /** The final answer to the query. */
  answer: string;
  /** True when the input was partitioned; false when it passed through whole. */
  decomposed: boolean;
  /** Leaf chunk count at the top level (1 when not decomposed). */
  chunkCount: number;
  /** Number of scoped per-chunk sub-queries issued across all levels. */
  subQueryCount: number;
  /** Number of synthesis (aggregation) calls issued across all levels. */
  synthesisCount: number;
  /** Deepest aggregation level reached (0 == flat / pass-through). */
  depthReached: number;
  /** Total LLM calls (subQueryCount + synthesisCount). */
  llmCallCount: number;
}

export interface RecursiveDecomposeDeps {
  llm: DecomposeLLM;
}

const DEFAULT_MAX_CHUNK_CHARS = 8000;
const DEFAULT_MAX_FANOUT = 5;
const DEFAULT_MAX_DEPTH = 3;

const DEFAULT_SUBQUERY_SYSTEM =
  "You are a read-only analysis step. You are given ONE section of a larger document " +
  "and a query. Answer the query using ONLY the provided section. Extract the facts, " +
  "figures, and passages relevant to the query. If the section contains nothing relevant, " +
  'reply exactly "No relevant information in this section." Do not speculate about other ' +
  "sections you cannot see. No tool calls.";

const DEFAULT_SYNTHESIS_SYSTEM =
  "You are a read-only synthesis step. You are given a query and several partial answers, " +
  "each derived from a different section of one large document. Merge them into a single " +
  "coherent answer to the query: resolve overlaps, drop sections that reported nothing " +
  "relevant, and preserve concrete figures. Do not invent information not present in the " +
  "partial answers. No tool calls.";

/**
 * Split text into chunks no larger than `maxChars`, preferring paragraph and
 * line boundaries so a chunk is a self-contained span rather than a mid-word
 * cut. A single paragraph larger than the budget is hard-split.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  // Split on blank lines first (paragraphs), then fall back to single newlines.
  const paragraphs = text.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const block = `${para}\n\n`;
    if (block.length > maxChars) {
      // Oversized paragraph — flush what we have, then hard-split the paragraph.
      flush();
      for (let i = 0; i < block.length; i += maxChars) {
        chunks.push(block.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + block.length > maxChars) {
      flush();
    }
    current += block;
  }
  flush();

  return chunks.filter((c) => c.trim().length > 0);
}

/** Run `fn` over `items` in sequential batches of at most `limit`. */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit);
    const settled = await Promise.all(batch.map((item, i) => fn(item, start + i)));
    for (let i = 0; i < settled.length; i++) results[start + i] = settled[i]!;
  }
  return results;
}

/**
 * Recursively decompose an oversized input, answer a scoped sub-query per
 * chunk, and synthesize the partial answers into a final answer.
 *
 * Small inputs (<= maxChunkChars) pass through as a single scoped call with
 * `decomposed: false`.
 */
export async function recursiveDecompose(
  request: RecursiveDecomposeRequest,
  deps: RecursiveDecomposeDeps,
): Promise<RecursiveDecomposeResult> {
  const query = request.query;
  // Floor at 50 so a tiny budget can't produce degenerate single-char chunks
  // (the tool wrapper enforces a larger operator-facing minimum via its schema).
  const maxChunkChars = Math.max(50, request.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS);
  const maxFanOut = Math.max(1, request.maxFanOut ?? DEFAULT_MAX_FANOUT);
  const maxDepth = Math.max(0, request.maxDepth ?? DEFAULT_MAX_DEPTH);
  const subQuerySystem = request.subQuerySystemPrompt ?? DEFAULT_SUBQUERY_SYSTEM;
  const synthesisSystem = request.synthesisSystemPrompt ?? DEFAULT_SYNTHESIS_SYSTEM;

  let subQueryCount = 0;
  let synthesisCount = 0;
  let depthReached = 0;
  let topChunkCount = 1;

  const scopedSubQuery = async (section: string): Promise<string> => {
    subQueryCount += 1;
    return deps.llm([
      { role: "system", content: subQuerySystem },
      {
        role: "user",
        content:
          `QUERY:\n${query}\n\n` +
          `DOCUMENT SECTION:\n${section}\n\n` +
          "Answer the query using only this section.",
      },
    ]);
  };

  const synthesize = async (partials: string[]): Promise<string> => {
    synthesisCount += 1;
    const combined = partials.map((a, i) => `[Part ${i + 1}]\n${a}`).join("\n\n");
    return deps.llm([
      { role: "system", content: synthesisSystem },
      {
        role: "user",
        content:
          `QUERY:\n${query}\n\n` +
          `PARTIAL ANSWERS FROM DOCUMENT SECTIONS:\n${combined}\n\n` +
          "Synthesize a single coherent answer to the query.",
      },
    ]);
  };

  // Aggregate one level: chunk -> scoped sub-query per chunk -> synthesize.
  // Recurses when the joined partial answers still exceed the budget and the
  // depth cap allows another level; otherwise forces a synthesis at the cap.
  const aggregate = async (text: string, depth: number): Promise<string> => {
    depthReached = Math.max(depthReached, depth);
    const chunks = chunkText(text, maxChunkChars);
    if (depth === 0) topChunkCount = chunks.length;

    const partials = await mapBounded(chunks, maxFanOut, (chunk) => scopedSubQuery(chunk));

    const joined = partials.map((a, i) => `[Part ${i + 1}]\n${a}`).join("\n\n");
    if (joined.length > maxChunkChars && depth < maxDepth) {
      return aggregate(joined, depth + 1);
    }
    return synthesize(partials);
  };

  let answer: string;
  let decomposed: boolean;
  if (request.input.length <= maxChunkChars) {
    // Pass-through: fits budget, one scoped call, no decomposition.
    answer = await scopedSubQuery(request.input);
    decomposed = false;
    topChunkCount = 1;
  } else {
    answer = await aggregate(request.input, 0);
    decomposed = true;
  }

  return {
    answer: answer.trim(),
    decomposed,
    chunkCount: topChunkCount,
    subQueryCount,
    synthesisCount,
    depthReached,
    llmCallCount: subQueryCount + synthesisCount,
  };
}
