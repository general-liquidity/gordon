/**
 * MCP resources — read-only state exposed via `gordon://` URIs.
 *
 * Per the MCP server-concepts spec, resources are passive data sources
 * that hosts (Cursor, Warp, Claude Code) can `@mention` to pull Gordon's
 * state into the editor's context window.
 *
 * Resources Gordon exposes:
 *
 *   - gordon://trades/recent              → recent trade-ledger entries
 *   - gordon://trades/recent/{symbol}     → recent trades filtered by symbol
 *   - gordon://ledger/today               → today's trade-ledger entries
 *   - gordon://config/exchanges           → operator's configured exchanges
 *   - gordon://skills/list                → bundled-skill catalog
 *
 * All reads are persistence-backed (no live runtime state), so the MCP
 * subprocess can serve them independently of Gordon's TUI.
 *
 * Symbol filtering uses CCXT-style canonical input (BTC/USDT) but also
 * accepts native concat (BTCUSDT) for ergonomic match.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { defaultTradeLedgerPath } from "../../safety/tradeLedger.ts";
import { loadConfig } from "../../storage/config/config.ts";
import { discoverSkillsFromDir } from "../../skills/loader.ts";

// ---------------------------------------------------------------------------
// Resource readers
// ---------------------------------------------------------------------------

interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  ts: number;
  [k: string]: unknown;
}

function readTradeLedger(): TradeRow[] {
  const path = defaultTradeLedgerPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const rows: TradeRow[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as TradeRow;
        rows.push(parsed);
      } catch {
        // Skip malformed lines silently
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function isSameDay(tsMs: number, refMs: number = Date.now()): boolean {
  const a = new Date(tsMs);
  const b = new Date(refMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function matchesSymbol(rowSymbol: string, querySymbol: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\/_\-:]/g, "");
  return norm(rowSymbol) === norm(querySymbol);
}

// ---------------------------------------------------------------------------
// Resource handlers
// ---------------------------------------------------------------------------

function readRecentTrades(limit = 50, symbol?: string): { text: string } {
  const rows = readTradeLedger();
  let filtered = symbol ? rows.filter((r) => matchesSymbol(r.symbol, symbol)) : rows;
  filtered = filtered.slice(-limit).reverse(); // newest first
  return {
    text: JSON.stringify(
      {
        kind: "trade_ledger.recent",
        symbol: symbol ?? null,
        count: filtered.length,
        trades: filtered,
      },
      null,
      2,
    ),
  };
}

function readTodayLedger(): { text: string } {
  const rows = readTradeLedger();
  const today = rows.filter((r) => typeof r.ts === "number" && isSameDay(r.ts));
  return {
    text: JSON.stringify(
      {
        kind: "trade_ledger.today",
        date: new Date().toISOString().slice(0, 10),
        count: today.length,
        trades: today,
      },
      null,
      2,
    ),
  };
}

async function readExchangeConfig(): Promise<{ text: string }> {
  try {
    const config = await loadConfig();
    const exchanges = (config.exchanges ?? []).map((ex) => ({
      id: ex.id,
      type: ex.type,
      sandbox: ex.sandbox ?? false,
      hasPassphrase: Boolean(ex.passphrase),
      hasWallet: Boolean(ex.walletPrivateKey),
      isDefault: ex.isDefault ?? false,
      // Credentials redacted — only metadata
    }));
    return {
      text: JSON.stringify(
        {
          kind: "config.exchanges",
          active: config.activeExchangeId ?? null,
          count: exchanges.length,
          exchanges,
        },
        null,
        2,
      ),
    };
  } catch (err) {
    return {
      text: JSON.stringify({
        kind: "config.exchanges",
        error: err instanceof Error ? err.message : String(err),
        count: 0,
        exchanges: [],
      }),
    };
  }
}

function readSkillsCatalog(): { text: string } {
  try {
    const skills = discoverSkillsFromDir("src/infra/skills/builtin", "builtin");
    const catalog = skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.frontmatter.tags ?? [],
    }));
    return {
      text: JSON.stringify(
        { kind: "skills.catalog", count: catalog.length, skills: catalog },
        null,
        2,
      ),
    };
  } catch (err) {
    return {
      text: JSON.stringify({
        kind: "skills.catalog",
        error: err instanceof Error ? err.message : String(err),
        skills: [],
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all Gordon read-only resources on the MCP server.
 *
 * Resource URIs use `gordon://` scheme to namespace cleanly. JSON
 * content with explicit `kind` discriminator so consumers can route
 * downstream. Returns a summary of what was registered.
 */
export function registerGordonResources(server: McpServer): {
  count: number;
  resources: string[];
} {
  const registered: string[] = [];

  // 1. Recent trades (no filter)
  server.registerResource(
    "trades-recent",
    "gordon://trades/recent",
    {
      title: "Recent trades",
      description: "Latest entries from Gordon's trade ledger (~/.gordon/trade-ledger.jsonl)",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          ...readRecentTrades(50),
        },
      ],
    }),
  );
  registered.push("gordon://trades/recent");

  // 2. Recent trades filtered by symbol — template
  server.registerResource(
    "trades-by-symbol",
    new ResourceTemplate("gordon://trades/recent/{symbol}", { list: undefined }),
    {
      title: "Recent trades by symbol",
      description: "Trade-ledger entries filtered by symbol (e.g., gordon://trades/recent/BTCUSDT or BTC/USDT)",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const symbol = Array.isArray(variables.symbol) ? variables.symbol[0] : variables.symbol;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            ...readRecentTrades(50, symbol),
          },
        ],
      };
    },
  );
  registered.push("gordon://trades/recent/{symbol}");

  // 3. Today's trade ledger
  server.registerResource(
    "ledger-today",
    "gordon://ledger/today",
    {
      title: "Today's trade ledger",
      description: "Trade-ledger entries from the current calendar day",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          ...readTodayLedger(),
        },
      ],
    }),
  );
  registered.push("gordon://ledger/today");

  // 4. Configured exchanges
  server.registerResource(
    "config-exchanges",
    "gordon://config/exchanges",
    {
      title: "Configured exchanges",
      description: "Operator's configured exchanges (credentials redacted, only metadata exposed)",
      mimeType: "application/json",
    },
    async (uri) => {
      const data = await readExchangeConfig();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            ...data,
          },
        ],
      };
    },
  );
  registered.push("gordon://config/exchanges");

  // 5. Bundled-skill catalog
  server.registerResource(
    "skills-catalog",
    "gordon://skills/list",
    {
      title: "Skills catalog",
      description: "Gordon's bundled skills (id, name, description, tags) — agentskills.io format",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          ...readSkillsCatalog(),
        },
      ],
    }),
  );
  registered.push("gordon://skills/list");

  return { count: registered.length, resources: registered };
}

// Exposed for tests
export const _internal = {
  readRecentTrades,
  readTodayLedger,
  readExchangeConfig,
  readSkillsCatalog,
  matchesSymbol,
  isSameDay,
};
