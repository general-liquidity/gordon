import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isCoherenceEnabled,
  getCoherenceThreshold,
  loadRunningThesis,
  saveRunningThesis,
  clearRunningThesis,
  scoreCoherence,
  gateCoherence,
  _resetThesisCacheForTest,
  type RunningThesis,
} from "./thesisCoherence.ts";

const FRESH_THESIS: RunningThesis = {
  bias: "long",
  marketFocus: ["crypto"],
  timeHorizon: "swing",
  convictionMin: 6,
  note: "Liquidity flush completing, bias up into reclaim of 100k",
  declaredAt: new Date().toISOString(),
};

describe("thesisCoherence", () => {
  let tmpDir: string;
  let tmpPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thesis-"));
    tmpPath = join(tmpDir, "thesis.json");
    _resetThesisCacheForTest();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    _resetThesisCacheForTest();
  });

  describe("isCoherenceEnabled", () => {
    it("respects flag", () => {
      expect(isCoherenceEnabled({})).toBe(false);
      expect(isCoherenceEnabled({ GORDON_THESIS_COHERENCE: "1" })).toBe(true);
      expect(isCoherenceEnabled({ GORDON_THESIS_COHERENCE: "true" })).toBe(true);
    });
  });

  describe("getCoherenceThreshold", () => {
    it("defaults to 0.5", () => {
      expect(getCoherenceThreshold({})).toBe(0.5);
    });
    it("parses valid env override", () => {
      expect(getCoherenceThreshold({ GORDON_THESIS_COHERENCE_THRESHOLD: "0.7" })).toBe(0.7);
    });
    it("falls back to default on invalid input", () => {
      expect(getCoherenceThreshold({ GORDON_THESIS_COHERENCE_THRESHOLD: "huh" })).toBe(0.5);
      expect(getCoherenceThreshold({ GORDON_THESIS_COHERENCE_THRESHOLD: "1.5" })).toBe(0.5);
    });
  });

  describe("save + load roundtrip", () => {
    it("normalizes marketFocus to lowercase and clamps conviction", () => {
      saveRunningThesis(
        { ...FRESH_THESIS, marketFocus: ["Crypto", "US_EQUITY"], convictionMin: 15 },
        tmpPath,
      );
      _resetThesisCacheForTest();
      const t = loadRunningThesis(tmpPath);
      expect(t?.marketFocus).toEqual(["crypto", "us_equity"]);
      expect(t?.convictionMin).toBe(10);
    });

    it("treats expired thesis as missing", () => {
      saveRunningThesis(
        { ...FRESH_THESIS, expiresAt: new Date(Date.now() - 1000).toISOString() },
        tmpPath,
      );
      _resetThesisCacheForTest();
      expect(loadRunningThesis(tmpPath)).toBeNull();
    });

    it("returns null when file missing", () => {
      expect(loadRunningThesis(tmpPath)).toBeNull();
    });

    it("clearRunningThesis truncates the file", () => {
      saveRunningThesis(FRESH_THESIS, tmpPath);
      clearRunningThesis(tmpPath);
      _resetThesisCacheForTest();
      expect(loadRunningThesis(tmpPath)).toBeNull();
    });
  });

  describe("scoreCoherence", () => {
    it("scores 1.0 when plan fully aligns", () => {
      const s = scoreCoherence(
        { direction: "long", assetClass: "crypto", timeHorizon: "swing", conviction: 8 },
        FRESH_THESIS,
      );
      expect(s.score).toBe(1);
      expect(s.failures).toEqual([]);
    });

    it("drops score when direction contradicts bias", () => {
      const s = scoreCoherence(
        { direction: "short", assetClass: "crypto", timeHorizon: "swing", conviction: 8 },
        FRESH_THESIS,
      );
      expect(s.score).toBeLessThan(0.6);
      expect(s.failures[0]).toContain("contradicts");
    });

    it("drops score when asset class is outside focus", () => {
      const s = scoreCoherence(
        { direction: "long", assetClass: "us_equity", timeHorizon: "swing", conviction: 8 },
        FRESH_THESIS,
      );
      expect(s.score).toBeLessThan(1);
      expect(s.failures.some((f) => f.includes("us_equity"))).toBe(true);
    });

    it("drops score when conviction below floor", () => {
      const s = scoreCoherence(
        { direction: "long", assetClass: "crypto", timeHorizon: "swing", conviction: 3 },
        FRESH_THESIS,
      );
      expect(s.score).toBeLessThan(1);
      expect(s.failures.some((f) => f.includes("conviction"))).toBe(true);
    });

    it("neutral bias accepts both directions", () => {
      const t = { ...FRESH_THESIS, bias: "neutral" as const };
      expect(
        scoreCoherence({ direction: "long", assetClass: "crypto" }, t).score,
      ).toBe(1);
      expect(
        scoreCoherence({ direction: "short", assetClass: "crypto" }, t).score,
      ).toBe(1);
    });

    it("scores asset class as aligned when thesis focus is empty", () => {
      const t = { ...FRESH_THESIS, marketFocus: [] };
      const s = scoreCoherence(
        { direction: "long", assetClass: "us_equity" },
        t,
      );
      expect(s.score).toBe(1);
    });
  });

  describe("gateCoherence", () => {
    it("passes through when flag off", () => {
      const r = gateCoherence({ direction: "short" }, {}, FRESH_THESIS);
      expect(r.ok).toBe(true);
    });

    it("blocks when flag on but no thesis", () => {
      const r = gateCoherence(
        { direction: "long" },
        { GORDON_THESIS_COHERENCE: "1" },
        null,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("no running thesis");
    });

    it("blocks when score below threshold", () => {
      const r = gateCoherence(
        { direction: "short", assetClass: "us_equity", conviction: 2 },
        { GORDON_THESIS_COHERENCE: "1" },
        FRESH_THESIS,
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("coherence");
    });

    it("allows when score >= threshold", () => {
      const r = gateCoherence(
        { direction: "long", assetClass: "crypto", timeHorizon: "swing", conviction: 8 },
        { GORDON_THESIS_COHERENCE: "1" },
        FRESH_THESIS,
      );
      expect(r.ok).toBe(true);
    });

    it("respects custom threshold via env", () => {
      const r = gateCoherence(
        { direction: "long", assetClass: "us_equity" },
        { GORDON_THESIS_COHERENCE: "1", GORDON_THESIS_COHERENCE_THRESHOLD: "0.4" },
        FRESH_THESIS,
      );
      expect(r.ok).toBe(true);
    });
  });
});
