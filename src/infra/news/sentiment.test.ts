import { describe, it, expect } from "bun:test";
import { scoreSentiment, aggregateSentiment } from "./sentiment.ts";

describe("scoreSentiment", () => {
  it("returns neutral on a headline with no keyword hits", () => {
    const r = scoreSentiment("Bitcoin trades sideways into the weekend");
    expect(r.sentiment).toBe("neutral");
    expect(r.confidence).toBe(0);
    expect(r.matchedKeywords).toEqual([]);
  });

  it("scores a clearly bullish headline", () => {
    const r = scoreSentiment("Bitcoin surges to new all-time high after ETF approval");
    expect(r.sentiment).toBe("bullish");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("scores a clearly bearish headline", () => {
    const r = scoreSentiment("Crypto exchange hacked, $200M in losses, SEC opens investigation");
    expect(r.sentiment).toBe("bearish");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("calls a mixed-signal headline neutral so we don't fire a misleading card", () => {
    const r = scoreSentiment("Token rallies after lawsuit dismissed");
    // 'rallies' bullish, 'lawsuit' bearish — diff <= 1 → neutral
    expect(r.sentiment).toBe("neutral");
  });

  it("caps confidence at 0.95", () => {
    const headline =
      "Bitcoin surges, soars, rallies, jumps to new ATH after partnership and adoption milestone";
    const r = scoreSentiment(headline);
    expect(r.sentiment).toBe("bullish");
    expect(r.confidence).toBeLessThanOrEqual(0.95);
  });

  it("is case-insensitive", () => {
    const r = scoreSentiment("BITCOIN CRASHES 20%");
    expect(r.sentiment).toBe("bearish");
  });
});

describe("aggregateSentiment", () => {
  it("counts each bucket and computes a netScore", () => {
    const agg = aggregateSentiment([
      { title: "BTC surges", sentiment: "bullish", confidence: 0.8 },
      { title: "ETH rallies", sentiment: "bullish", confidence: 0.65 },
      { title: "SOL crashes", sentiment: "bearish", confidence: 0.7 },
      { title: "XRP sideways", sentiment: "neutral", confidence: 0 },
    ]);
    expect(agg.bullishCount).toBe(2);
    expect(agg.bearishCount).toBe(1);
    expect(agg.neutralCount).toBe(1);
    // (2 - 1) / 3
    expect(agg.netScore).toBeCloseTo(1 / 3, 5);
    expect(agg.topBullish?.title).toBe("BTC surges");
    expect(agg.topBearish?.title).toBe("SOL crashes");
  });

  it("returns netScore=0 when there are no directional headlines", () => {
    const agg = aggregateSentiment([{ title: "x", sentiment: "neutral", confidence: 0 }]);
    expect(agg.netScore).toBe(0);
    expect(agg.topBullish).toBeUndefined();
    expect(agg.topBearish).toBeUndefined();
  });
});
