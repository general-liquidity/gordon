/**
 * Microcompact: Lightweight Per-Turn Context Trimming
 *
 * Unlike full LLM summarization (which burns tokens every compaction),
 * microcompact replaces the CONTENT of old read-only tool results with
 * a short marker. Tool_call_id and name stay intact so the conversation
 * structure is preserved — only the data payload is cleared.
 *
 * Triggers:
 *   - count: more than COUNT_TRIGGER compactable results accumulated
 *   - token: total compactable content exceeds TOKEN_TRIGGER (catches
 *            few-but-large results like full orderbook dumps)
 *
 * Keeps the COUNT_KEEP_RECENT most recent results verbatim — the agent
 * almost always only needs the last few tool outputs in full.
 *
 * Only READ-ONLY trading tool results are compactable. State-changing
 * actions (place_order, cancel_order, fund_wallet) are NEVER compacted
 * because their output is the ground truth of what actually happened.
 */

export const MC_CLEARED_MARKER = "[Old tool result content cleared — use read_file or re-invoke if needed]";

export const COUNT_TRIGGER_THRESHOLD = 8;
export const COUNT_KEEP_RECENT = 4;
export const TOKEN_TRIGGER_THRESHOLD = 80_000;

/**
 * Read-only trading tools whose results can be safely discarded.
 * Keep in sync with tool definitions in src/infra/agents/tools/.
 */
const COMPACTABLE_TOOLS = new Set([
  // Market data (re-fetchable)
  "get_price",
  "get_prices",
  "get_ticker",
  "get_candles",
  "get_orderbook",
  "get_book_ticker",
  "get_spread",
  "get_24hr_tickers",
  "get_top_symbols",
  "get_exchange_info",
  // Scanning / discovery
  "scan_market",
  "scan_top_movers",
  "scan_trending",
  "check_regime",
  // Analysis (re-computable)
  "analyze_symbol",
  "analyze_indicators",
  "analyze_sentiment",
  "analyze_fundamentals",
  "analyze_news",
  // Account reads (re-fetchable)
  "get_balances",
  "get_positions",
  "get_open_orders",
  "get_order_history",
  "get_portfolio",
  "get_health",
  // Research
  "web_search",
  "web_fetch",
  "read_news",
  "get_fundamentals",
  "get_earnings",
  // Backtest outputs — large and reproducible
  "backtest_strategy",
  "compare_backtests",
  // Memory/context
  "memory_search",
  "memory_get",
  "read_file",
  "heartbeat",
]);

/**
 * Structural shape of a tool message — both Mastra and plain objects
 * conform. Gordon agents normalize to this.
 */
export interface CompactableToolMessage {
  role: "tool";
  toolName?: string;
  name?: string;
  toolCallId?: string;
  tool_call_id?: string;
  content: string | unknown;
}

export interface MicrocompactResult<T> {
  messages: T[];
  cleared: number;
  estimatedTokensSaved: number;
  trigger: "count" | "token" | null;
}

function isCompactable(msg: unknown): msg is CompactableToolMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as CompactableToolMessage;
  if (m.role !== "tool") return false;
  const name = m.toolName ?? m.name ?? "";
  if (!COMPACTABLE_TOOLS.has(name)) return false;
  return true;
}

function getContentString(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Trim old compactable tool results in-place (returns a new array).
 * Pass your typed message array; returns same type with cleared contents.
 */
export function microcompactMessages<T>(messages: T[]): MicrocompactResult<T> {
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (isCompactable(msg)) {
      const content = getContentString((msg as CompactableToolMessage).content);
      if (content !== MC_CLEARED_MARKER) indices.push(i);
    }
  }

  const countTriggered = indices.length > COUNT_TRIGGER_THRESHOLD;
  let totalTokens = 0;
  if (!countTriggered) {
    for (const idx of indices) {
      const content = getContentString((messages[idx] as CompactableToolMessage).content);
      totalTokens += Math.ceil(content.length / 3.5);
    }
  }
  const tokenTriggered = !countTriggered && totalTokens > TOKEN_TRIGGER_THRESHOLD;

  if (!countTriggered && !tokenTriggered) {
    return { messages, cleared: 0, estimatedTokensSaved: 0, trigger: null };
  }

  const keepSet = new Set(indices.slice(-COUNT_KEEP_RECENT));
  const clearIndices = indices.filter((i) => !keepSet.has(i));
  if (clearIndices.length === 0) {
    return { messages, cleared: 0, estimatedTokensSaved: 0, trigger: null };
  }

  let tokensSaved = 0;
  const clearSet = new Set(clearIndices);
  const newMessages = messages.map((msg, i) => {
    if (!clearSet.has(i)) return msg;
    const m = msg as CompactableToolMessage;
    const content = getContentString(m.content);
    tokensSaved += Math.ceil(content.length / 3.5);
    return { ...m, content: MC_CLEARED_MARKER } as unknown as T;
  });

  return {
    messages: newMessages,
    cleared: clearIndices.length,
    estimatedTokensSaved: tokensSaved,
    trigger: countTriggered ? "count" : "token",
  };
}

/** Allow callers to register additional compactable tools at runtime. */
export function registerCompactableTool(name: string): void {
  COMPACTABLE_TOOLS.add(name);
}

export function isToolCompactable(toolName: string): boolean {
  return COMPACTABLE_TOOLS.has(toolName);
}
