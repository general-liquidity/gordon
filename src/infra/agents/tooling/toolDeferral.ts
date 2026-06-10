/**
 * Tool Deferral Registry.
 *
 * Inspired by OpenDev's `core_tools` registry (Rust): mark tools as
 * `core` (always sent to the model in every request) or `deferred`
 * (omitted from the schema until the model explicitly searches for and
 * activates them via a meta-tool). For Gordon's tool surface (~100+
 * tools across crypto / equities / DeFi / news /
 * memory / ops), this can cut schema-token cost meaningfully — paper
 * cites 13K → 6K tokens per request.
 *
 * Design goals:
 *   - Pure registry; doesn't touch Mastra agent construction directly
 *   - Caller (orchestrator / definitions/gordon.ts) decides when to
 *     filter the active tool set
 *   - Default classification can be overridden per-session
 *   - Activation events are recorded so deactivated tools can be
 *     dropped from subsequent turns when no longer in use
 *
 * Wiring into Mastra (follow-up): build the agent with `toolset =
 * filterActiveTools(allTools, registry)`. When the model calls
 * `discover_tools(query)`, look up matching deferred tools, mark them
 * active, and rebuild the toolset on the next turn.
 *
 * For Gordon's first cut, ship the registry + filter + activation
 * tracker. The orchestrator can opt in per agent.
 */

export type DeferralClass = "core" | "deferred";

export interface DeferralEntry {
  toolName: string;
  class: DeferralClass;
  /** Descriptive tag — used for the discover_tools search. */
  description?: string;
  /** Family — used for bulk classification ("market", "memory", …). */
  family?: string;
}

export interface ActivationRecord {
  toolName: string;
  activatedAt: number;
  /** Number of turns since activation that this tool has gone unused. */
  idleTurns: number;
}

export interface ToolDeferralOptions {
  /** Initial classifications. */
  initial?: Iterable<DeferralEntry>;
  /** Auto-deactivate a tool after this many idle turns. Default 5; 0 disables. */
  autoDeactivateAfterIdleTurns?: number;
}

export class ToolDeferralRegistry {
  private readonly entries: Map<string, DeferralEntry> = new Map();
  private readonly activations: Map<string, ActivationRecord> = new Map();
  private readonly idleCap: number;

  constructor(options: ToolDeferralOptions = {}) {
    this.idleCap = options.autoDeactivateAfterIdleTurns ?? 5;
    if (options.initial) {
      for (const e of options.initial) this.entries.set(e.toolName, e);
    }
  }

  /** Register or replace an entry. */
  set(entry: DeferralEntry): void {
    this.entries.set(entry.toolName, entry);
  }

  setMany(entries: Iterable<DeferralEntry>): void {
    for (const e of entries) this.set(e);
  }

  remove(toolName: string): boolean {
    this.activations.delete(toolName);
    return this.entries.delete(toolName);
  }

  classOf(toolName: string): DeferralClass | "unknown" {
    return this.entries.get(toolName)?.class ?? "unknown";
  }

  /** True if the tool should be visible to the model right now. */
  isActive(toolName: string): boolean {
    const entry = this.entries.get(toolName);
    if (!entry) return true; // unknown tools default to active for safety
    if (entry.class === "core") return true;
    return this.activations.has(toolName);
  }

  /** Mark a deferred tool as active (called when discover_tools matches). */
  activate(toolName: string, now: number = Date.now()): void {
    const entry = this.entries.get(toolName);
    if (!entry) return; // unknown tools are already always-active
    if (entry.class === "core") return; // no-op
    this.activations.set(toolName, { toolName, activatedAt: now, idleTurns: 0 });
  }

  /** Manually drop activation (e.g. when a workflow ends). */
  deactivate(toolName: string): boolean {
    return this.activations.delete(toolName);
  }

  /**
   * Tick the idle counter for all active deferred tools. Called once
   * per turn by the orchestrator. Tools that haven't been called this
   * turn get their idleTurns incremented; auto-deactivate when they
   * cross idleCap.
   */
  tick(usedToolNames: ReadonlySet<string>, now: number = Date.now()): { deactivated: string[] } {
    const deactivated: string[] = [];
    for (const [name, rec] of [...this.activations]) {
      if (usedToolNames.has(name)) {
        rec.idleTurns = 0;
        rec.activatedAt = now;
        continue;
      }
      rec.idleTurns += 1;
      if (this.idleCap > 0 && rec.idleTurns >= this.idleCap) {
        this.activations.delete(name);
        deactivated.push(name);
      }
    }
    return { deactivated };
  }

  /** Search deferred tools by substring of name / description / family. */
  search(query: string, limit: number = 10): DeferralEntry[] {
    const q = query.toLowerCase();
    const hits: DeferralEntry[] = [];
    for (const e of this.entries.values()) {
      if (e.class !== "deferred") continue;
      if (
        e.toolName.toLowerCase().includes(q) ||
        (e.description?.toLowerCase().includes(q) ?? false) ||
        (e.family?.toLowerCase().includes(q) ?? false)
      ) {
        hits.push(e);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  /** Snapshot for debug / TUI rendering. */
  snapshot(): {
    entries: DeferralEntry[];
    active: ActivationRecord[];
    coreCount: number;
    deferredCount: number;
    activeDeferredCount: number;
  } {
    const entries = [...this.entries.values()];
    const coreCount = entries.filter((e) => e.class === "core").length;
    const deferredCount = entries.length - coreCount;
    return {
      entries,
      active: [...this.activations.values()],
      coreCount,
      deferredCount,
      activeDeferredCount: this.activations.size,
    };
  }

  /**
   * Filter a tools record (Mastra-shaped: `Record<string, ToolDef>`)
   * down to the active set. Tools not in the registry are passed
   * through (safe default — unknown = active). Core tools always
   * pass; deferred tools only if currently activated.
   */
  filterActive<T>(allTools: Record<string, T>): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [name, def] of Object.entries(allTools)) {
      if (this.isActive(name)) out[name] = def;
    }
    return out;
  }
}

// ============================================================================
// Default classification for Gordon's known tool surface
// ============================================================================

/**
 * The "core" set — always visible. Picked to cover the canonical user
 * journeys (ask a question, scan markets, check positions, get
 * portfolio, place a trade) without needing to discover tools first.
 * Anything outside this set defaults to deferred.
 *
 * The thresholds: keep ~25 tools in core. Larger than this and the
 * deferral savings vanish; smaller and the model has to discover
 * basics like get_price.
 */
export const DEFAULT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Conversation / system
  "ask_user", "explain", "search_memory", "memory_get", "record_insight",
  // Market basics
  "get_price", "get_prices", "get_ticker", "get_candles", "get_orderbook",
  "scan_market", "scan_top_movers", "detect_market_regime",
  // Account
  "get_portfolio", "get_account_snapshot", "get_balance",
  "get_open_orders", "get_trade_history",
  // Risk / preview
  "check_risk", "preview_market_order",
  // News / context
  "get_crypto_news_headlines",
  // Permission / runtime
  "describe_runtime",
]);

/**
 * Build a classification for any tool name. If it's in the core set,
 * `core`. Otherwise `deferred` with a family inferred from a prefix
 * heuristic. Pass into `ToolDeferralRegistry.setMany()` at startup.
 */
export function classifyToolNames(allToolNames: Iterable<string>): DeferralEntry[] {
  const out: DeferralEntry[] = [];
  for (const name of allToolNames) {
    const isCore = DEFAULT_CORE_TOOL_NAMES.has(name);
    out.push({
      toolName: name,
      class: isCore ? "core" : "deferred",
      family: inferFamily(name),
    });
  }
  return out;
}

function inferFamily(name: string): string {
  if (name.startsWith("defillama_")) return "defi";
  if (name.startsWith("finnhub_")) return "finnhub";
  if (name.startsWith("get_") || name.includes("scan") || name.includes("ticker")) return "market";
  if (name.includes("order") || name.includes("trade") || name.includes("close")) return "trading";
  if (name.includes("backtest")) return "backtest";
  if (name.includes("news") || name.includes("sentiment")) return "news";
  if (name.includes("regime") || name.includes("indicator")) return "analysis";
  if (name.includes("memory") || name.includes("insight")) return "memory";
  return "other";
}
