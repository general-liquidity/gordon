import { describe, expect, test } from "bun:test";
import {
  normalizeForComparison,
  summarizeQuoteVerifications,
  verifyQuote,
  verifyQuotes,
} from "./quoteVerification.ts";

describe("normalizeForComparison", () => {
  test("empty string", () => {
    expect(normalizeForComparison("")).toBe("");
  });

  test("trim + collapse whitespace", () => {
    expect(normalizeForComparison("  hello   world  ")).toBe("hello world");
  });

  test("casefold lowercases", () => {
    expect(normalizeForComparison("Hello World")).toBe("hello world");
  });

  test("strips combining accents (NFKD)", () => {
    expect(normalizeForComparison("café")).toBe("cafe");
    expect(normalizeForComparison("naïve")).toBe("naive");
  });

  test("strips accents across script ranges", () => {
    // Greek tonos, Vietnamese accents, etc.
    expect(normalizeForComparison("résumé")).toBe("resume");
    expect(normalizeForComparison("Tiệp")).toBe("tiep");
  });

  test("preserves non-combining unicode (CJK)", () => {
    expect(normalizeForComparison("市场 trades")).toBe("市场 trades");
  });

  test("collapses tabs/newlines as whitespace", () => {
    expect(normalizeForComparison("hello\n\tworld")).toBe("hello world");
  });
});

describe("verifyQuote — string_match", () => {
  test("exact match", () => {
    expect(verifyQuote("hello world", "before hello world after")).toBe(true);
  });

  test("case insensitive", () => {
    expect(verifyQuote("HELLO", "say hello there")).toBe(true);
  });

  test("whitespace variation survives", () => {
    expect(verifyQuote("hello   world", "saying hello world today")).toBe(true);
    expect(verifyQuote("hello\nworld", "the hello world example")).toBe(true);
  });

  test("accent variation survives (PDF reflow case)", () => {
    expect(verifyQuote("café", "we went to the cafe yesterday")).toBe(true);
    expect(verifyQuote("naïve approach", "a naive approach works")).toBe(true);
  });

  test("returns false when quote is not in source", () => {
    expect(verifyQuote("missing quote", "totally different text")).toBe(false);
  });

  test("returns false for empty quote", () => {
    expect(verifyQuote("", "some source")).toBe(false);
    expect(verifyQuote("   ", "some source")).toBe(false);
  });

  test("returns false for empty source", () => {
    expect(verifyQuote("anything", "")).toBe(false);
  });

  test("catches hallucinated quote (similar wording, not present)", () => {
    // Model paraphrases instead of quoting — should NOT verify
    expect(
      verifyQuote(
        "The company is planning a major layoff",
        "Layoffs are happening at the company.",
      ),
    ).toBe(false);
  });

  test("substring inside longer real text", () => {
    expect(
      verifyQuote(
        "leverage ratio of 7.3x",
        "Jane Street ran a leverage ratio of 7.3x on January 17",
      ),
    ).toBe(true);
  });
});

describe("verifyQuote — regex", () => {
  test("regex method matches a pattern", () => {
    expect(verifyQuote("7\\.\\d+x", "leverage 7.3x", { method: "regex" })).toBe(true);
  });

  test("regex method false for non-match", () => {
    expect(verifyQuote("nomatch", "totally different", { method: "regex" })).toBe(false);
  });

  test("malformed regex returns false, does not throw", () => {
    expect(() => verifyQuote("[invalid(", "any source", { method: "regex" })).not.toThrow();
    expect(verifyQuote("[invalid(", "any source", { method: "regex" })).toBe(false);
  });
});

describe("verifyQuote — manual", () => {
  test("manual always returns true (caller asserts verified)", () => {
    expect(verifyQuote("anything", "anything", { method: "manual" })).toBe(true);
  });

  test("manual still returns false for empty quote/source", () => {
    expect(verifyQuote("", "src", { method: "manual" })).toBe(false);
    expect(verifyQuote("q", "", { method: "manual" })).toBe(false);
  });
});

describe("verifyQuotes — batch", () => {
  test("returns per-quote verdicts", () => {
    const outcomes = verifyQuotes(
      ["leverage 7.3x", "fabricated claim"],
      "leverage 7.3x in the SEBI order text",
    );
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.verified).toBe(true);
    expect(outcomes[1]?.verified).toBe(false);
  });

  test("empty quote list returns empty array", () => {
    expect(verifyQuotes([], "src")).toEqual([]);
  });

  test("method propagates", () => {
    const outcomes = verifyQuotes(["x"], "y", { method: "manual" });
    expect(outcomes[0]?.method).toBe("manual");
  });
});

describe("summarizeQuoteVerifications", () => {
  test("counts and rate", () => {
    const summary = summarizeQuoteVerifications([
      { quote: "a", verified: true, method: "string_match" },
      { quote: "b", verified: false, method: "string_match" },
      { quote: "c", verified: true, method: "string_match" },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.verified).toBe(2);
    expect(summary.unverified).toBe(1);
    expect(summary.verifiedRate).toBeCloseTo(2 / 3, 3);
  });

  test("empty list has rate 0", () => {
    const summary = summarizeQuoteVerifications([]);
    expect(summary.verifiedRate).toBe(0);
  });
});
