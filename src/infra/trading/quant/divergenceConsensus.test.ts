import { describe, it, expect } from "bun:test";
import {
  computeDivergenceConsensus,
  divergenceConsensusToPayload,
  type IndicatorDivergence,
} from "./divergenceConsensus.ts";

describe("computeDivergenceConsensus", () => {
  it("all none → direction none", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "none", strength: 0 },
      { indicator: "MACD", verdict: "none", strength: 0 },
    ];
    const r = computeDivergenceConsensus({ indicators });
    expect(r.direction).toBe("none");
    expect(r.flavor).toBe("none");
  });

  it("strong unanimous bullish → bullish consensus", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "regular_bullish", strength: 0.9 },
      { indicator: "MACD", verdict: "regular_bullish", strength: 0.8 },
      { indicator: "Stoch", verdict: "regular_bullish", strength: 0.7 },
      { indicator: "CCI", verdict: "regular_bullish", strength: 0.6 },
    ];
    const r = computeDivergenceConsensus({ indicators });
    expect(r.direction).toBe("bullish");
    expect(r.flavor).toBe("regular");
    expect(r.agreement).toBeCloseTo(1, 9);
    expect(r.contributingIndicators).toHaveLength(4);
  });

  it("strong bearish consensus", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "regular_bearish", strength: 0.8 },
      { indicator: "MACD", verdict: "regular_bearish", strength: 0.8 },
      { indicator: "Stoch", verdict: "regular_bearish", strength: 0.7 },
    ];
    const r = computeDivergenceConsensus({ indicators });
    expect(r.direction).toBe("bearish");
  });

  it("hidden divergences flavor as 'hidden' when majority", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "hidden_bullish", strength: 0.8 },
      { indicator: "MACD", verdict: "hidden_bullish", strength: 0.7 },
      { indicator: "Stoch", verdict: "regular_bullish", strength: 0.6 },
    ];
    const r = computeDivergenceConsensus({ indicators });
    expect(r.direction).toBe("bullish");
    expect(r.flavor).toBe("hidden");
  });

  it("split verdicts below threshold → mixed", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "regular_bullish", strength: 0.8 },
      { indicator: "MACD", verdict: "regular_bullish", strength: 0.7 },
      { indicator: "Stoch", verdict: "regular_bearish", strength: 0.8 },
      { indicator: "CCI", verdict: "regular_bearish", strength: 0.7 },
    ];
    const r = computeDivergenceConsensus({ indicators });
    expect(r.direction).toBe("mixed");
    expect(r.flavor).toBe("mixed");
  });

  it("respects minAgreeingCount even when share crosses threshold", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "regular_bullish", strength: 0.9 },
      { indicator: "MACD", verdict: "none", strength: 0 },
    ];
    const r = computeDivergenceConsensus({ indicators, minAgreeingCount: 2 });
    // Only 1 bullish, doesn't meet min agreeing → mixed (not bullish)
    expect(r.direction).not.toBe("bullish");
  });

  it("respects custom consensus threshold", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "regular_bullish", strength: 0.8 },
      { indicator: "MACD", verdict: "regular_bullish", strength: 0.7 },
      { indicator: "Stoch", verdict: "regular_bearish", strength: 0.5 },
    ];
    // Bullish share ≈ 0.75 — with default threshold 0.6 → bullish
    let r = computeDivergenceConsensus({ indicators });
    expect(r.direction).toBe("bullish");

    // With threshold 0.85 → no winner → mixed
    r = computeDivergenceConsensus({ indicators, consensusThreshold: 0.85 });
    expect(r.direction).toBe("mixed");
  });

  it("weights indicators differently", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "regular_bullish", strength: 1.0, weight: 0.1 },
      { indicator: "MACD", verdict: "regular_bearish", strength: 1.0, weight: 5.0 },
    ];
    const r = computeDivergenceConsensus({ indicators, minAgreeingCount: 1 });
    expect(r.direction).toBe("bearish");
  });

  it("agreement reflects winning share", () => {
    const indicators: IndicatorDivergence[] = [
      { indicator: "RSI", verdict: "regular_bullish", strength: 1.0 },
      { indicator: "MACD", verdict: "regular_bullish", strength: 1.0 },
      { indicator: "Stoch", verdict: "regular_bullish", strength: 1.0 },
      { indicator: "CCI", verdict: "regular_bearish", strength: 1.0 },
    ];
    const r = computeDivergenceConsensus({ indicators });
    expect(r.agreement).toBeCloseTo(0.75, 6);
  });
});

describe("divergenceConsensusToPayload", () => {
  it("emits stable shape", () => {
    const r = computeDivergenceConsensus({
      indicators: [
        { indicator: "RSI", verdict: "regular_bullish", strength: 0.8 },
        { indicator: "MACD", verdict: "regular_bullish", strength: 0.7 },
      ],
    });
    const p = divergenceConsensusToPayload(r) as { kind: string; direction: string };
    expect(p.kind).toBe("divergence_consensus.computed");
    expect(["bullish", "bearish", "mixed", "none"]).toContain(p.direction);
  });
});
