import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isStrategyMandatesEnabled,
  loadMandates,
  saveMandates,
  selectMandateForPlan,
  gateAgainstMandate,
  _resetMandatesCacheForTest,
  type StrategyMandate,
} from "./strategyMandates.ts";

const swingCrypto: StrategyMandate = {
  id: "swing-crypto",
  name: "Swing Crypto",
  assetClasses: ["crypto"],
  venues: [],
  strategyTags: ["swing"],
  maxPositionPct: 5,
  maxAllocationPct: 50,
  maxOpenPositions: 4,
  declaredAt: "",
};

const incomeOptions: StrategyMandate = {
  id: "income-options",
  name: "Income Options",
  assetClasses: ["options"],
  venues: ["ibkr"],
  strategyTags: [],
  maxPositionPct: 2,
  maxAllocationPct: 20,
  maxOpenPositions: 3,
  declaredAt: "",
};

const wildcard: StrategyMandate = {
  id: "global",
  name: "Global Fallback",
  assetClasses: [],
  venues: [],
  strategyTags: [],
  maxPositionPct: 1,
  maxAllocationPct: 10,
  maxOpenPositions: 2,
  declaredAt: "",
};

describe("strategyMandates", () => {
  let tmpDir: string;
  let tmpPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mandates-"));
    tmpPath = join(tmpDir, "mandates.json");
    _resetMandatesCacheForTest();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    _resetMandatesCacheForTest();
  });

  describe("isStrategyMandatesEnabled", () => {
    it("respects flag", () => {
      expect(isStrategyMandatesEnabled({})).toBe(false);
      expect(isStrategyMandatesEnabled({ GORDON_STRATEGY_MANDATES: "1" })).toBe(true);
    });
  });

  describe("save + load roundtrip", () => {
    it("normalizes case and persists", () => {
      saveMandates(
        [
          { ...swingCrypto, assetClasses: ["Crypto"], venues: ["BINANCE"], strategyTags: ["SWING"] },
        ],
        tmpPath,
      );
      _resetMandatesCacheForTest();
      const loaded = loadMandates(tmpPath);
      expect(loaded[0]?.assetClasses).toEqual(["crypto"]);
      expect(loaded[0]?.venues).toEqual(["binance"]);
      expect(loaded[0]?.strategyTags).toEqual(["swing"]);
    });

    it("returns empty array when file missing", () => {
      expect(loadMandates(tmpPath)).toEqual([]);
    });
  });

  describe("selectMandateForPlan", () => {
    it("picks the most specific mandate", () => {
      const m = selectMandateForPlan(
        { assetClass: "crypto", strategyTag: "swing" },
        [wildcard, swingCrypto],
      );
      expect(m?.id).toBe("swing-crypto");
    });

    it("falls back to wildcard when no specific match", () => {
      const m = selectMandateForPlan(
        { assetClass: "fx" },
        [wildcard, swingCrypto, incomeOptions],
      );
      expect(m?.id).toBe("global");
    });

    it("rejects mandates whose declared scope mismatches", () => {
      const m = selectMandateForPlan(
        { assetClass: "crypto", venue: "kraken", strategyTag: "income" },
        [incomeOptions, swingCrypto],
      );
      // incomeOptions: venue ibkr only — rejected
      // swingCrypto: strategyTag swing only — rejected
      expect(m).toBeNull();
    });

    it("returns null when registry is empty", () => {
      expect(selectMandateForPlan({ assetClass: "crypto" }, [])).toBeNull();
    });
  });

  describe("gateAgainstMandate", () => {
    const budget = { currentOpenPositions: 0, currentAllocationPct: 0 };

    it("passes through when flag off", () => {
      const r = gateAgainstMandate(
        { assetClass: "crypto", proposedPositionPct: 5 },
        budget,
        {},
        [swingCrypto],
      );
      expect(r.ok).toBe(true);
    });

    it("passes through when no mandates declared", () => {
      const r = gateAgainstMandate(
        { assetClass: "crypto", proposedPositionPct: 100 },
        budget,
        { GORDON_STRATEGY_MANDATES: "1" },
        [],
      );
      expect(r.ok).toBe(true);
    });

    it("blocks when no mandate matches", () => {
      const r = gateAgainstMandate(
        { assetClass: "fx", proposedPositionPct: 1 },
        budget,
        { GORDON_STRATEGY_MANDATES: "1" },
        [swingCrypto, incomeOptions],
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("no mandate matches");
    });

    it("blocks when position size exceeds mandate cap", () => {
      const r = gateAgainstMandate(
        { assetClass: "crypto", strategyTag: "swing", proposedPositionPct: 10 },
        budget,
        { GORDON_STRATEGY_MANDATES: "1" },
        [swingCrypto],
      );
      expect(r.ok).toBe(false);
      expect(r.violations[0]).toContain("exceeds mandate");
    });

    it("blocks when allocation would exceed mandate budget", () => {
      const r = gateAgainstMandate(
        { assetClass: "crypto", strategyTag: "swing", proposedPositionPct: 5 },
        { currentOpenPositions: 0, currentAllocationPct: 48 },
        { GORDON_STRATEGY_MANDATES: "1" },
        [swingCrypto],
      );
      expect(r.ok).toBe(false);
      expect(r.violations[0]).toContain("allocation");
    });

    it("blocks when open positions cap is reached", () => {
      const r = gateAgainstMandate(
        { assetClass: "crypto", strategyTag: "swing", proposedPositionPct: 1 },
        { currentOpenPositions: 4, currentAllocationPct: 10 },
        { GORDON_STRATEGY_MANDATES: "1" },
        [swingCrypto],
      );
      expect(r.ok).toBe(false);
      expect(r.violations[0]).toContain("open positions");
    });

    it("allows when plan fits the mandate", () => {
      const r = gateAgainstMandate(
        { assetClass: "crypto", strategyTag: "swing", proposedPositionPct: 3 },
        budget,
        { GORDON_STRATEGY_MANDATES: "1" },
        [swingCrypto],
      );
      expect(r.ok).toBe(true);
      expect(r.mandate?.id).toBe("swing-crypto");
    });
  });
});
