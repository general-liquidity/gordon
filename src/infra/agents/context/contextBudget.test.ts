import { describe, it, expect } from "bun:test";
import { estimateTokens } from "./contextBudget.ts";

describe("estimateTokens — JSON-aware estimation", () => {
  it("returns 0 for empty / whitespace", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   \n  ")).toBe(0);
  });

  it("keeps the ~4 chars/token ratio for prose (default behavior unchanged)", () => {
    const prose = "The user is asking about their open positions and recent fills.";
    // Prose does not start with { or [ → auto-detects as prose → /4 (unchanged).
    expect(estimateTokens(prose)).toBe(Math.ceil(prose.trim().length / 4));
  });

  it("prose estimate is byte-identical to the legacy /4 heuristic", () => {
    const samples = [
      "- Permission mode: auto",
      "[GORDON_PROJECT_TRUTH]\n- Gordon is a trading agent.",
      "Plain sentence with no JSON braces at all.",
    ];
    for (const s of samples) {
      expect(estimateTokens(s)).toBe(Math.ceil(s.trim().length / 4));
    }
  });

  it("estimates more tokens-per-char for JSON than for prose of equal length", () => {
    const json = '{"symbol":"BTC","bids":[[42000,1.2],[41999,0.8]],"asks":[[42001,2.1]]}';
    // Build prose of the SAME length so the only difference is the ratio.
    const prose = "x".repeat(json.length);
    expect(estimateTokens(json)).toBeGreaterThan(estimateTokens(prose));
  });

  it("auto-detects object and array JSON content", () => {
    const obj = '{"a":1,"b":2}';
    const arr = "[1,2,3,4,5]";
    expect(estimateTokens(obj)).toBe(Math.ceil(obj.length / 2.5));
    expect(estimateTokens(arr)).toBe(Math.ceil(arr.length / 2.5));
  });

  it("honors an explicit kind override", () => {
    const text = "not json but force json ratio";
    expect(estimateTokens(text, "json")).toBe(Math.ceil(text.length / 2.5));
    const jsonish = '{"x":1}';
    expect(estimateTokens(jsonish, "prose")).toBe(Math.ceil(jsonish.length / 4));
  });

  it("a real order-book blob estimates closer to a true token count than /4 would", () => {
    // A representative JSON tool-result. Rough true token count via a
    // whitespace/punctuation split as a sanity reference.
    const orderBook = JSON.stringify({
      symbol: "ETH-USD",
      bids: Array.from({ length: 20 }, (_, i) => [2500 - i, 1.5 + i * 0.1]),
      asks: Array.from({ length: 20 }, (_, i) => [2501 + i, 0.9 + i * 0.05]),
      timestamp: 1718800000000,
    });

    // Rough true tokens: count atomic pieces (numbers, keys, punctuation runs).
    const roughTrue = (orderBook.match(/[A-Za-z0-9.\-]+|[{}\[\]:,]/g) ?? []).length;

    const flatEstimate = Math.ceil(orderBook.length / 4);
    const jsonEstimate = estimateTokens(orderBook); // auto → json ratio

    // The flat /4 under-counts vs the true token count; the JSON-aware estimate
    // is higher and lands nearer the rough-true figure.
    expect(flatEstimate).toBeLessThan(roughTrue);
    expect(jsonEstimate).toBeGreaterThan(flatEstimate);
    expect(Math.abs(jsonEstimate - roughTrue)).toBeLessThan(Math.abs(flatEstimate - roughTrue));
  });
});
