import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EMPTY_UNIVERSE,
  isUniverseEnabled,
  loadUniverse,
  saveUniverse,
  checkUniverse,
  _resetUniverseCacheForTest,
} from "./tradingUniverse.ts";

describe("tradingUniverse", () => {
  let tmpDir: string;
  let tmpPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "universe-"));
    tmpPath = join(tmpDir, "universe.json");
    _resetUniverseCacheForTest();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    _resetUniverseCacheForTest();
  });

  describe("isUniverseEnabled", () => {
    it("returns false when unset", () => {
      expect(isUniverseEnabled({})).toBe(false);
    });
    it("returns true for '1' or 'true'", () => {
      expect(isUniverseEnabled({ GORDON_TRADING_UNIVERSE: "1" })).toBe(true);
      expect(isUniverseEnabled({ GORDON_TRADING_UNIVERSE: "true" })).toBe(true);
    });
  });

  describe("save + load roundtrip", () => {
    it("normalizes case on save", () => {
      saveUniverse(
        {
          symbols: ["btcusdt", "ETHUSDT"],
          assetClasses: ["Crypto"],
          venues: ["BINANCE"],
          declaredAt: "2026-05-12T00:00:00.000Z",
          note: "swing only",
        },
        tmpPath,
      );
      _resetUniverseCacheForTest();
      const u = loadUniverse(tmpPath);
      expect(u.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
      expect(u.assetClasses).toEqual(["crypto"]);
      expect(u.venues).toEqual(["binance"]);
      expect(u.note).toBe("swing only");
    });

    it("returns EMPTY_UNIVERSE when file missing", () => {
      const u = loadUniverse(tmpPath);
      expect(u).toEqual(EMPTY_UNIVERSE);
    });

    it("returns EMPTY_UNIVERSE for malformed JSON", () => {
      require("node:fs").writeFileSync(tmpPath, "not json");
      _resetUniverseCacheForTest();
      expect(loadUniverse(tmpPath)).toEqual(EMPTY_UNIVERSE);
    });
  });

  describe("checkUniverse", () => {
    it("passes through when flag off", () => {
      const r = checkUniverse(
        { symbol: "DOGE", assetClass: "crypto", venue: "binance" },
        {},
        { symbols: ["BTCUSDT"], assetClasses: [], venues: [], declaredAt: "" },
      );
      expect(r.allowed).toBe(true);
    });

    it("warns but allows when flag on and universe is empty", () => {
      const r = checkUniverse(
        { symbol: "DOGE", assetClass: "crypto", venue: "binance" },
        { GORDON_TRADING_UNIVERSE: "1" },
        EMPTY_UNIVERSE,
      );
      expect(r.allowed).toBe(true);
      expect(r.reason).toContain("empty");
    });

    it("blocks symbol not in declared symbols list", () => {
      const r = checkUniverse(
        { symbol: "DOGE", assetClass: "crypto", venue: "binance" },
        { GORDON_TRADING_UNIVERSE: "1" },
        { symbols: ["BTCUSDT", "ETHUSDT"], assetClasses: [], venues: [], declaredAt: "" },
      );
      expect(r.allowed).toBe(false);
      expect(r.violations[0]).toContain("DOGE");
    });

    it("allows symbol that is in the list", () => {
      const r = checkUniverse(
        { symbol: "btcusdt" },
        { GORDON_TRADING_UNIVERSE: "1" },
        { symbols: ["BTCUSDT"], assetClasses: [], venues: [], declaredAt: "" },
      );
      expect(r.allowed).toBe(true);
      expect(r.matchedOn).toContain("symbol");
    });

    it("blocks asset class outside list", () => {
      const r = checkUniverse(
        { symbol: "AAPL", assetClass: "us_equity" },
        { GORDON_TRADING_UNIVERSE: "1" },
        { symbols: [], assetClasses: ["crypto"], venues: [], declaredAt: "" },
      );
      expect(r.allowed).toBe(false);
      expect(r.violations[0]).toContain("us_equity");
    });

    it("blocks venue outside list", () => {
      const r = checkUniverse(
        { symbol: "BTCUSDT", venue: "kraken" },
        { GORDON_TRADING_UNIVERSE: "1" },
        { symbols: [], assetClasses: [], venues: ["binance"], declaredAt: "" },
      );
      expect(r.allowed).toBe(false);
      expect(r.violations[0]).toContain("kraken");
    });

    it("combines multiple axis restrictions", () => {
      const u = {
        symbols: ["BTCUSDT", "ETHUSDT"],
        assetClasses: ["crypto"],
        venues: ["binance", "coinbase"],
        declaredAt: "",
      };
      expect(
        checkUniverse(
          { symbol: "BTCUSDT", assetClass: "crypto", venue: "binance" },
          { GORDON_TRADING_UNIVERSE: "1" },
          u,
        ).allowed,
      ).toBe(true);
      expect(
        checkUniverse(
          { symbol: "BTCUSDT", assetClass: "crypto", venue: "kraken" },
          { GORDON_TRADING_UNIVERSE: "1" },
          u,
        ).allowed,
      ).toBe(false);
    });
  });
});
