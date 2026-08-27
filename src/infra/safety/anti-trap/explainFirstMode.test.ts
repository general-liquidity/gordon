import { describe, expect, it, beforeEach } from "bun:test";

import {
  isExplainFirstEnabled,
  recordUserThesis,
  getUserThesis,
  clearUserThesis,
  requiresUserThesis,
  computeThesisDivergence,
  _resetThesisStoreForTest,
} from "./explainFirstMode.ts";

describe("explainFirstMode", () => {
  beforeEach(() => {
    _resetThesisStoreForTest();
  });

  describe("isExplainFirstEnabled", () => {
    it("returns false when env flag is unset", () => {
      expect(isExplainFirstEnabled({})).toBe(false);
    });

    it("returns true for '1' or 'true'", () => {
      expect(isExplainFirstEnabled({ GORDON_EXPLAIN_FIRST: "1" })).toBe(true);
      expect(isExplainFirstEnabled({ GORDON_EXPLAIN_FIRST: "true" })).toBe(true);
    });

    it("returns false for other truthy-looking values", () => {
      expect(isExplainFirstEnabled({ GORDON_EXPLAIN_FIRST: "yes" })).toBe(false);
    });
  });

  describe("recordUserThesis", () => {
    it("stores a thesis and returns the entry", () => {
      const entry = recordUserThesis("plan-1", "BTC reclaiming 100k after the funding flush");
      expect(entry.planId).toBe("plan-1");
      expect(entry.thesis).toBe("BTC reclaiming 100k after the funding flush");
      expect(entry.source).toBe("user_input");
      expect(getUserThesis("plan-1")?.thesis).toBe(entry.thesis);
    });

    it("rejects empty planId", () => {
      expect(() => recordUserThesis("", "BTC reclaiming 100k after flush")).toThrow();
    });

    it("rejects short thesis", () => {
      expect(() => recordUserThesis("plan-1", "yes")).toThrow();
    });
  });

  describe("requiresUserThesis", () => {
    it("never requires when flag is off", () => {
      expect(requiresUserThesis("plan-1", {}).required).toBe(false);
    });

    it("requires when flag is on and no thesis stored", () => {
      const result = requiresUserThesis("plan-1", { GORDON_EXPLAIN_FIRST: "1" });
      expect(result.required).toBe(true);
      expect(result.reason).toContain("recordUserThesis");
    });

    it("does not require once thesis is stored", () => {
      recordUserThesis("plan-1", "Liquidity flush completed, regime flipped bullish");
      expect(requiresUserThesis("plan-1", { GORDON_EXPLAIN_FIRST: "1" }).required).toBe(false);
    });
  });

  describe("clearUserThesis", () => {
    it("removes a stored thesis", () => {
      recordUserThesis("plan-1", "BTC bounce above 100k with strong CVD");
      clearUserThesis("plan-1");
      expect(getUserThesis("plan-1")).toBeUndefined();
    });
  });

  describe("computeThesisDivergence", () => {
    it("returns 0 for identical text", () => {
      const t = "BTC reclaiming 100k after the funding flush completed today";
      expect(computeThesisDivergence(t, t)).toBe(0);
    });

    it("returns ~1 for completely unrelated text", () => {
      const a = "BTC reclaiming 100k after funding flush";
      const b = "lemon tree pollination season arrives";
      expect(computeThesisDivergence(a, b)).toBeGreaterThan(0.9);
    });

    it("returns intermediate for partial overlap", () => {
      const a = "BTC reclaiming 100k after the funding flush completed today";
      const b = "BTC bounce above 100k with strong CVD reclaiming bid";
      const div = computeThesisDivergence(a, b);
      expect(div).toBeGreaterThan(0);
      expect(div).toBeLessThan(1);
    });
  });
});
