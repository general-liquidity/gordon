import { describe, expect, it } from "bun:test";

import {
  isRiskAckEnabled,
  topWeightedDimensions,
  verifyRiskAcknowledgement,
} from "./riskAcknowledgement.ts";
import type { RiskAssessment } from "../trading/riskClassifier.ts";

function buildAssessment(
  tier: RiskAssessment["tier"],
  dims: Array<{ name: string; score: number; weight: number }>,
): RiskAssessment {
  return {
    compositeScore: 60,
    tier,
    dimensions: dims.map((d) => ({ ...d, reason: `${d.name} reason` })),
    topFactors: dims.map((d) => d.name),
    recommendation: "prompt_user",
    summary: `synthetic ${tier} assessment`,
  };
}

describe("riskAcknowledgement", () => {
  describe("isRiskAckEnabled", () => {
    it("returns true for '1' and 'true'", () => {
      expect(isRiskAckEnabled({ GORDON_RISK_ACK: "1" })).toBe(true);
      expect(isRiskAckEnabled({ GORDON_RISK_ACK: "true" })).toBe(true);
    });

    it("returns false otherwise", () => {
      expect(isRiskAckEnabled({})).toBe(false);
      expect(isRiskAckEnabled({ GORDON_RISK_ACK: "yes" })).toBe(false);
    });
  });

  describe("topWeightedDimensions", () => {
    it("orders by weighted score descending", () => {
      const a = buildAssessment("medium", [
        { name: "position_size", score: 40, weight: 1 },
        { name: "concentration", score: 80, weight: 2 }, // weighted 160
        { name: "volatility", score: 60, weight: 1.5 }, // weighted 90
        { name: "time_of_day", score: 20, weight: 1 },
      ]);
      const top = topWeightedDimensions(a, 2);
      expect(top.map((d) => d.name)).toEqual(["concentration", "volatility"]);
    });
  });

  describe("verifyRiskAcknowledgement", () => {
    const dims = [
      { name: "concentration", score: 80, weight: 2 },
      { name: "volatility", score: 60, weight: 1.5 },
      { name: "drawdown_proximity", score: 50, weight: 1.5 },
    ];

    it("passes through when flag off", () => {
      const a = buildAssessment("high", dims);
      const r = verifyRiskAcknowledgement([], a, {});
      expect(r.ok).toBe(true);
      expect(r.required).toEqual([]);
    });

    it("passes through when tier is low even with flag on", () => {
      const a = buildAssessment("low", dims);
      const r = verifyRiskAcknowledgement([], a, { GORDON_RISK_ACK: "1" });
      expect(r.ok).toBe(true);
    });

    it("rejects when required acks are missing", () => {
      const a = buildAssessment("medium", dims);
      const r = verifyRiskAcknowledgement(
        ["Some unrelated text about the market"],
        a,
        { GORDON_RISK_ACK: "1" },
      );
      expect(r.ok).toBe(false);
      expect(r.missing.length).toBeGreaterThan(0);
      expect(r.reason).toContain("acknowledgedRisks");
    });

    it("accepts when all required dimensions are mentioned", () => {
      const a = buildAssessment("medium", dims);
      const r = verifyRiskAcknowledgement(
        [
          "Concentration is 18% — acceptable given conviction",
          "Volatility regime is elevated but trade is sized to fit",
          "Drawdown_proximity is 60% of daily limit, still tradeable",
        ],
        a,
        { GORDON_RISK_ACK: "1" },
      );
      expect(r.ok).toBe(true);
    });

    it("matches dimension names case-insensitively", () => {
      const a = buildAssessment("high", dims);
      const r = verifyRiskAcknowledgement(
        [
          "CONCENTRATION analysis complete",
          "Volatility looks fine",
          "drawdown_proximity room exists",
        ],
        a,
        { GORDON_RISK_ACK: "1" },
      );
      expect(r.ok).toBe(true);
    });
  });
});

import { verifyAcksFromWarnings } from "./riskAcknowledgement.ts";

describe("verifyAcksFromWarnings", () => {
  it("passes through when flag off", () => {
    const r = verifyAcksFromWarnings([], ["w1", "w2"], {});
    expect(r.ok).toBe(true);
  });

  it("passes when no warnings", () => {
    const r = verifyAcksFromWarnings([], [], { GORDON_RISK_ACK: "1" });
    expect(r.ok).toBe(true);
  });

  it("rejects when ack count is below warning count", () => {
    const r = verifyAcksFromWarnings(
      ["Concentration is acceptable here"],
      ["concentration high", "volatility elevated"],
      { GORDON_RISK_ACK: "1" },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("2 substantive");
  });

  it("rejects boilerplate (<20 chars)", () => {
    const r = verifyAcksFromWarnings(
      ["ok", "yes"],
      ["concentration high", "volatility elevated"],
      { GORDON_RISK_ACK: "1" },
    );
    expect(r.ok).toBe(false);
  });

  it("accepts when enough substantive acks are provided", () => {
    const r = verifyAcksFromWarnings(
      [
        "Concentration is 18% — within mandate",
        "Volatility is elevated but plan sizes for ATR",
      ],
      ["concentration approaching cap", "vol regime elevated"],
      { GORDON_RISK_ACK: "1" },
    );
    expect(r.ok).toBe(true);
  });
});
