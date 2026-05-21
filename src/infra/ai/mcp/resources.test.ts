import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _internal } from "./resources.ts";
import { TRADE_LEDGER_PATH_ENV } from "../../safety/tradeLedger.ts";

const { readRecentTrades, readTodayLedger, readSkillsCatalog, matchesSymbol, isSameDay } = _internal;

let tempDir: string;
let originalLedgerPath: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-mcp-resources-"));
  originalLedgerPath = process.env[TRADE_LEDGER_PATH_ENV];
  process.env[TRADE_LEDGER_PATH_ENV] = join(tempDir, "trade-ledger.jsonl");
});

afterEach(() => {
  if (originalLedgerPath === undefined) delete process.env[TRADE_LEDGER_PATH_ENV];
  else process.env[TRADE_LEDGER_PATH_ENV] = originalLedgerPath;
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
});

function writeLedger(rows: unknown[]): void {
  const path = process.env[TRADE_LEDGER_PATH_ENV]!;
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

// =================== helpers ===================

describe("matchesSymbol", () => {
  it("matches identical symbols", () => {
    expect(matchesSymbol("BTCUSDT", "BTCUSDT")).toBe(true);
    expect(matchesSymbol("BTC/USDT", "BTC/USDT")).toBe(true);
  });

  it("matches across separator normalization", () => {
    expect(matchesSymbol("BTCUSDT", "BTC/USDT")).toBe(true);
    expect(matchesSymbol("BTC-USDT", "BTC_USDT")).toBe(true);
    expect(matchesSymbol("BTC:USDT", "BTCUSDT")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesSymbol("btcusdt", "BTCUSDT")).toBe(true);
    expect(matchesSymbol("Btc/Usdt", "BTC/USDT")).toBe(true);
  });

  it("does not match different symbols", () => {
    expect(matchesSymbol("BTCUSDT", "ETHUSDT")).toBe(false);
    expect(matchesSymbol("BTC/USDT", "BTC/USDC")).toBe(false);
  });
});

describe("isSameDay", () => {
  it("returns true for today's timestamp", () => {
    expect(isSameDay(Date.now())).toBe(true);
  });

  it("returns false for yesterday's timestamp", () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000 - 60_000;
    expect(isSameDay(yesterday)).toBe(false);
  });
});

// =================== readers ===================

describe("readRecentTrades", () => {
  it("returns empty array when ledger is absent", () => {
    const result = JSON.parse(readRecentTrades(50).text);
    expect(result.count).toBe(0);
    expect(result.trades).toEqual([]);
  });

  it("returns recent trades newest-first", () => {
    writeLedger([
      { id: "1", symbol: "BTCUSDT", side: "BUY", qty: 0.1, price: 50000, ts: 1000 },
      { id: "2", symbol: "BTCUSDT", side: "SELL", qty: 0.1, price: 51000, ts: 2000 },
      { id: "3", symbol: "ETHUSDT", side: "BUY", qty: 1, price: 3000, ts: 3000 },
    ]);
    const result = JSON.parse(readRecentTrades(10).text);
    expect(result.count).toBe(3);
    expect(result.trades[0].id).toBe("3");
    expect(result.trades[2].id).toBe("1");
  });

  it("filters by symbol", () => {
    writeLedger([
      { id: "1", symbol: "BTCUSDT", side: "BUY", qty: 0.1, price: 50000, ts: 1000 },
      { id: "2", symbol: "ETHUSDT", side: "BUY", qty: 1, price: 3000, ts: 2000 },
      { id: "3", symbol: "BTCUSDT", side: "SELL", qty: 0.1, price: 51000, ts: 3000 },
    ]);
    const result = JSON.parse(readRecentTrades(50, "BTCUSDT").text);
    expect(result.count).toBe(2);
    expect(result.trades.every((t: { symbol: string }) => t.symbol === "BTCUSDT")).toBe(true);
  });

  it("honors limit", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `${i}`,
      symbol: "BTCUSDT",
      side: "BUY",
      qty: 0.1,
      price: 50000 + i,
      ts: 1000 + i,
    }));
    writeLedger(rows);
    const result = JSON.parse(readRecentTrades(10).text);
    expect(result.count).toBe(10);
  });

  it("skips malformed JSONL lines silently", () => {
    const path = process.env[TRADE_LEDGER_PATH_ENV]!;
    writeFileSync(path, [
      JSON.stringify({ id: "1", symbol: "BTCUSDT", side: "BUY", qty: 0.1, price: 50000, ts: 1000 }),
      "not json",
      JSON.stringify({ id: "2", symbol: "BTCUSDT", side: "SELL", qty: 0.1, price: 51000, ts: 2000 }),
    ].join("\n") + "\n");
    const result = JSON.parse(readRecentTrades(50).text);
    expect(result.count).toBe(2);
  });
});

describe("readTodayLedger", () => {
  it("returns only today's entries", () => {
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000 - 60_000;
    writeLedger([
      { id: "old", symbol: "BTC", side: "BUY", qty: 1, price: 1, ts: yesterdayMs },
      { id: "new", symbol: "BTC", side: "BUY", qty: 1, price: 1, ts: Date.now() },
    ]);
    const result = JSON.parse(readTodayLedger().text);
    expect(result.count).toBe(1);
    expect(result.trades[0].id).toBe("new");
  });
});

describe("readSkillsCatalog", () => {
  it("returns the bundled-skill catalog with required fields", () => {
    const result = JSON.parse(readSkillsCatalog().text);
    expect(result.count).toBeGreaterThanOrEqual(33);
    for (const skill of result.skills) {
      expect(typeof skill.id).toBe("string");
      expect(typeof skill.name).toBe("string");
      expect(typeof skill.description).toBe("string");
      expect(Array.isArray(skill.tags)).toBe(true);
    }
  });
});
