import { describe, expect, test } from "bun:test";
import {
  crossCheckRiskFactorQuotes,
  scoreEarningsSignal,
  summarizeEarningsSignal,
  validateEarningsSignal,
  type EarningsSignal,
} from "./earningsSignal.ts";

const validSignal: EarningsSignal = {
  ticker: "AAPL",
  sentimentScore: 0.6,
  managementConfidence: 0.8,
  guidanceRevision: "raised",
  keyRiskFactors: [
    "supply chain headwinds in the Greater China region",
  ],
  tradingBias: "mild_long",
};

describe("validateEarningsSignal — schema", () => {
  test("accepts a fully-formed valid signal", () => {
    const result = validateEarningsSignal(validSignal);
    expect(result.ok).toBe(true);
    expect(result.signal?.ticker).toBe("AAPL");
  });

  test("rejects sentiment out of range", () => {
    const result = validateEarningsSignal({ ...validSignal, sentimentScore: 1.5 });
    expect(result.ok).toBe(false);
  });

  test("rejects management confidence out of range", () => {
    const result = validateEarningsSignal({ ...validSignal, managementConfidence: -0.1 });
    expect(result.ok).toBe(false);
  });

  test("rejects invalid guidance value", () => {
    const result = validateEarningsSignal({ ...validSignal, guidanceRevision: "skyrocketed" });
    expect(result.ok).toBe(false);
  });

  test("rejects more than 3 risk factors", () => {
    const result = validateEarningsSignal({
      ...validSignal,
      keyRiskFactors: ["a", "b", "c", "d"],
    });
    expect(result.ok).toBe(false);
  });

  test("rejects empty ticker", () => {
    const result = validateEarningsSignal({ ...validSignal, ticker: "" });
    expect(result.ok).toBe(false);
  });

  test("defaults keyRiskFactors when absent", () => {
    const result = validateEarningsSignal({
      ticker: "AAPL",
      sentimentScore: 0.5,
      managementConfidence: 0.7,
      guidanceRevision: "raised",
      tradingBias: "mild_long",
    });
    expect(result.ok).toBe(true);
    expect(result.signal?.keyRiskFactors).toEqual([]);
  });
});

describe("validateEarningsSignal — coherence warnings", () => {
  test("warns when sentiment and bias disagree in sign", () => {
    const result = validateEarningsSignal({
      ...validSignal,
      sentimentScore: 0.7,
      tradingBias: "strong_short",
    });
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === "warning" && i.field === "tradingBias")).toBe(true);
  });

  test("warns on raised guidance + short bias", () => {
    const result = validateEarningsSignal({
      ...validSignal,
      guidanceRevision: "raised",
      tradingBias: "strong_short",
      sentimentScore: -0.6,
    });
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.message.includes("raised guidance"))).toBe(true);
  });

  test("warns on lowered guidance + long bias", () => {
    const result = validateEarningsSignal({
      ...validSignal,
      guidanceRevision: "lowered",
      tradingBias: "strong_long",
      sentimentScore: 0.6,
    });
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.message.includes("lowered guidance"))).toBe(true);
  });

  test("no warning when fields are coherent", () => {
    const result = validateEarningsSignal(validSignal);
    expect(result.issues.length).toBe(0);
  });
});

describe("crossCheckRiskFactorQuotes", () => {
  const transcript = `
    During the quarter we faced supply chain headwinds in the Greater China region.
    Operating margins compressed as a result of currency volatility in emerging
    markets. Looking forward, we remain cautious on macro conditions.
  `;

  test("all real quotes verify", () => {
    const signal: EarningsSignal = {
      ...validSignal,
      keyRiskFactors: ["supply chain headwinds in the Greater China region"],
    };
    const result = crossCheckRiskFactorQuotes(signal, transcript);
    expect(result.hallucinatedCount).toBe(0);
    expect(result.verifiedRate).toBe(1);
  });

  test("hallucinated quote is detected", () => {
    const signal: EarningsSignal = {
      ...validSignal,
      keyRiskFactors: ["impending regulatory ban on all operations"],
    };
    const result = crossCheckRiskFactorQuotes(signal, transcript);
    expect(result.hallucinatedCount).toBe(1);
    expect(result.verifiedRate).toBe(0);
  });

  test("mixed real + hallucinated produces correct rate", () => {
    const signal: EarningsSignal = {
      ...validSignal,
      keyRiskFactors: [
        "supply chain headwinds in the Greater China region",
        "complete loss of customer base",
      ],
    };
    const result = crossCheckRiskFactorQuotes(signal, transcript);
    expect(result.hallucinatedCount).toBe(1);
    expect(result.verifiedRate).toBe(0.5);
  });

  test("empty risk-factor list returns verifiedRate=1 (vacuously true)", () => {
    const signal: EarningsSignal = { ...validSignal, keyRiskFactors: [] };
    const result = crossCheckRiskFactorQuotes(signal, transcript);
    expect(result.verifiedRate).toBe(1);
  });
});

describe("scoreEarningsSignal — composite scoring", () => {
  test("strong bullish signal produces positive composite", () => {
    const score = scoreEarningsSignal({
      ticker: "X",
      sentimentScore: 0.9,
      managementConfidence: 0.9,
      guidanceRevision: "raised",
      keyRiskFactors: [],
      tradingBias: "strong_long",
    });
    expect(score.composite).toBeGreaterThan(0.5);
    expect(score.conviction).toBeGreaterThan(0.7);
  });

  test("strong bearish signal produces negative composite", () => {
    const score = scoreEarningsSignal({
      ticker: "X",
      sentimentScore: -0.8,
      managementConfidence: 0.9,
      guidanceRevision: "lowered",
      keyRiskFactors: [],
      tradingBias: "strong_short",
    });
    expect(score.composite).toBeLessThan(-0.5);
  });

  test("incoherent signal has low conviction", () => {
    const score = scoreEarningsSignal({
      ticker: "X",
      sentimentScore: 0.8,
      managementConfidence: 0.9,
      guidanceRevision: "raised",
      keyRiskFactors: [],
      tradingBias: "strong_short",
    });
    // Incoherent → conviction halved → ~0.45
    expect(score.conviction).toBeLessThan(0.6);
  });

  test("hallucinated quotes reduce conviction", () => {
    const signal: EarningsSignal = {
      ticker: "X",
      sentimentScore: 0.8,
      managementConfidence: 0.9,
      guidanceRevision: "raised",
      keyRiskFactors: ["a", "b"],
      tradingBias: "strong_long",
    };
    const cleanScore = scoreEarningsSignal(signal);
    const halfHallucinated = scoreEarningsSignal(signal, {
      outcomes: [
        { quote: "a", verified: true },
        { quote: "b", verified: false },
      ],
      hallucinatedCount: 1,
      verifiedRate: 0.5,
    });
    expect(halfHallucinated.conviction).toBeLessThan(cleanScore.conviction);
  });
});

describe("summarizeEarningsSignal", () => {
  test("includes ticker, direction, conviction labels", () => {
    const signal = validSignal;
    const score = scoreEarningsSignal(signal);
    const summary = summarizeEarningsSignal(signal, score);
    expect(summary).toContain("AAPL");
    expect(summary).toContain("composite=");
    expect(summary).toContain("guidance");
  });

  test("flags hallucinated quote count", () => {
    const signal: EarningsSignal = { ...validSignal, keyRiskFactors: ["a", "b"] };
    const score = scoreEarningsSignal(signal);
    const qc = {
      outcomes: [
        { quote: "a", verified: true },
        { quote: "b", verified: false },
      ],
      hallucinatedCount: 1,
      verifiedRate: 0.5,
    };
    const summary = summarizeEarningsSignal(signal, score, qc);
    expect(summary).toContain("1/2");
    expect(summary).toContain("unverified");
  });
});
