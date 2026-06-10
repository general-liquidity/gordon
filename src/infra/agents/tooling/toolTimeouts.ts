/**
 * Per-family tool execution timeouts.
 *
 * Different trading tools have wildly different latency profiles:
 *   - market reads (price, ticker, candles) typically <1s
 *   - account reads (positions, balances) <2s
 *   - order placement / cancellation should complete in <10s, but
 *     can stretch on busy venues
 *   - backtests can take 30-120s depending on dataset
 *
 * A single global timeout would either kill backtests or let a
 * hanging price call burn the whole turn. This module declares
 * per-family caps and a helper that wraps any promise with a
 * deadline + AbortController.
 *
 * Inspired by Goose's per-extension timeouts. Pure utility — no
 * global state.
 */

/**
 * Family identifiers matched as case-insensitive *prefixes* against
 * tool names. The first match wins, so order matters; specific
 * patterns sit before generic ones.
 */
const TOOL_TIMEOUT_FAMILIES: ReadonlyArray<{ pattern: string; timeoutMs: number; family: string }> = [
  // Long-running, expected-slow tools.
  { pattern: "backtest", timeoutMs: 120_000, family: "backtest" },
  { pattern: "playbook_backtest", timeoutMs: 120_000, family: "backtest" },
  { pattern: "evaluate_strategy", timeoutMs: 60_000, family: "evaluation" },
  { pattern: "scan_market", timeoutMs: 30_000, family: "scan" },
  { pattern: "scan_top_movers", timeoutMs: 30_000, family: "scan" },
  { pattern: "screen_stocks", timeoutMs: 30_000, family: "scan" },
  // Trade execution paths — moderate cap.
  { pattern: "place_order", timeoutMs: 15_000, family: "trading" },
  { pattern: "execute_plan", timeoutMs: 30_000, family: "trading" },
  { pattern: "execute_trade", timeoutMs: 15_000, family: "trading" },
  { pattern: "cancel_order", timeoutMs: 10_000, family: "trading" },
  { pattern: "close_trade", timeoutMs: 15_000, family: "trading" },
  // News fetch — single-flight TTL'd cache, but the underlying RSS
  // pulls can stall.
  { pattern: "get_crypto_news_headlines", timeoutMs: 15_000, family: "news" },
  { pattern: "get_stock_news_headlines", timeoutMs: 15_000, family: "news" },
  // Memory / system reads — fast.
  { pattern: "memory_", timeoutMs: 3_000, family: "memory" },
  { pattern: "search_memory", timeoutMs: 3_000, family: "memory" },
  { pattern: "describe_runtime", timeoutMs: 3_000, family: "system" },
  // Market reads — fast paths.
  { pattern: "get_price", timeoutMs: 5_000, family: "market" },
  { pattern: "get_prices", timeoutMs: 8_000, family: "market" },
  { pattern: "get_ticker", timeoutMs: 5_000, family: "market" },
  { pattern: "get_candles", timeoutMs: 8_000, family: "market" },
  { pattern: "get_orderbook", timeoutMs: 5_000, family: "market" },
  { pattern: "get_book_ticker", timeoutMs: 5_000, family: "market" },
  // Account reads — moderate.
  { pattern: "get_portfolio", timeoutMs: 8_000, family: "account" },
  { pattern: "get_balance", timeoutMs: 5_000, family: "account" },
  { pattern: "get_open_orders", timeoutMs: 5_000, family: "account" },
  { pattern: "get_account_snapshot", timeoutMs: 8_000, family: "account" },
];

const DEFAULT_TIMEOUT_MS = 10_000;

export interface TimeoutLookup {
  timeoutMs: number;
  family: string;
}

/**
 * Resolve the timeout for a tool by name. Returns the default when
 * no family pattern matches.
 */
export function getTimeoutForToolName(name: string): TimeoutLookup {
  const lower = name.toLowerCase();
  for (const entry of TOOL_TIMEOUT_FAMILIES) {
    if (lower.startsWith(entry.pattern.toLowerCase()) || lower.includes(`_${entry.pattern.toLowerCase()}`)) {
      return { timeoutMs: entry.timeoutMs, family: entry.family };
    }
  }
  return { timeoutMs: DEFAULT_TIMEOUT_MS, family: "default" };
}

export class ToolTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;
  readonly family: string;

  constructor(toolName: string, timeoutMs: number, family: string) {
    super(`Tool "${toolName}" exceeded the ${family} timeout of ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
    this.family = family;
  }
}

/**
 * Race a promise against a per-family timeout. If the timeout fires,
 * the AbortSignal returned to the executor flips, and the wrapper
 * rejects with `ToolTimeoutError` so the caller can normalize via
 * `toolErrorNormalizer.ts`.
 *
 * The executor receives an AbortSignal — fetch / agent / SDK calls
 * that respect AbortSignal will cancel cleanly. Executors that ignore
 * it will still keep running in the background; the timeout just
 * ensures the *caller* unblocks promptly.
 */
export async function runWithToolTimeout<T>(
  toolName: string,
  executor: (signal: AbortSignal) => Promise<T>,
  options: { override?: number } = {},
): Promise<T> {
  const { timeoutMs: defaultTimeoutMs, family } = getTimeoutForToolName(toolName);
  const timeoutMs = options.override ?? defaultTimeoutMs;
  const ctrl = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new ToolTimeoutError(toolName, timeoutMs, family));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    return await Promise.race([executor(ctrl.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
