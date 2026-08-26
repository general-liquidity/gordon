import { describe, expect, test } from "bun:test";
import {
  filterByAsOf,
  InvalidAsOfCutoffError,
  isThinEvidence,
  classifyEvidenceQuality,
  mergeAndDedupe,
} from "./retrieval-helpers.ts";

describe("filterByAsOf", () => {
  test("returns input unchanged when asOf is undefined", () => {
    const recs = [{ createdAt: "2026-05-26T00:00:00Z" }, { createdAt: "2026-05-27T00:00:00Z" }];
    const out = filterByAsOf(recs, undefined, (r) => r.createdAt, "strict");
    expect(out).toEqual(recs);
  });

  test("drops records strictly after asOf", () => {
    const recs = [
      { createdAt: "2026-05-25T00:00:00Z", id: "a" },
      { createdAt: "2026-05-26T12:00:00Z", id: "b" },
      { createdAt: "2026-05-27T00:00:00Z", id: "c" },
    ];
    const out = filterByAsOf(recs, "2026-05-26T12:00:00Z", (r) => r.createdAt, "strict");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("keeps records exactly equal to asOf", () => {
    const recs = [{ createdAt: "2026-05-26T12:00:00Z", id: "a" }];
    const out = filterByAsOf(recs, "2026-05-26T12:00:00Z", (r) => r.createdAt, "strict");
    expect(out).toHaveLength(1);
  });

  test("permissive mode preserves records with missing timestamps", () => {
    const recs = [
      { createdAt: "2026-05-25", id: "a" },
      { createdAt: undefined as unknown as string, id: "b" },
      { createdAt: "2026-05-28", id: "c" },
    ];
    const out = filterByAsOf(recs, "2026-05-26", (r) => r.createdAt, "permissive");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("strict mode drops records with missing timestamps", () => {
    const recs = [
      { createdAt: "2026-05-25", id: "a" },
      { createdAt: undefined as unknown as string, id: "b" },
      { createdAt: "2026-05-28", id: "c" },
    ];
    const out = filterByAsOf(recs, "2026-05-26", (r) => r.createdAt, "strict");
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  test("strict mode drops records with unparseable timestamps", () => {
    const recs = [
      { createdAt: "2026-05-25", id: "a" },
      { createdAt: "sometime last week", id: "b" },
    ];
    const out = filterByAsOf(recs, "2026-05-26", (r) => r.createdAt, "strict");
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  test("permissive mode keeps records with unparseable timestamps", () => {
    const recs = [
      { createdAt: "2026-05-25", id: "a" },
      { createdAt: "sometime last week", id: "b" },
    ];
    const out = filterByAsOf(recs, "2026-05-26", (r) => r.createdAt, "permissive");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("throws on unparseable asOf in strict mode", () => {
    const recs = [{ createdAt: "2026-05-25", id: "a" }];
    expect(() => filterByAsOf(recs, "not-a-date", (r) => r.createdAt, "strict"))
      .toThrow(InvalidAsOfCutoffError);
  });

  test("throws on unparseable asOf in permissive mode too", () => {
    const recs = [{ createdAt: "2026-05-25", id: "a" }];
    expect(() => filterByAsOf(recs, "not-a-date", (r) => r.createdAt, "permissive"))
      .toThrow(InvalidAsOfCutoffError);
  });

  test("accepts numeric ms-epoch timestamps", () => {
    const recs = [
      { ts: 1_000_000_000_000, id: "a" }, // Sep 2001
      { ts: 2_000_000_000_000, id: "b" }, // May 2033
    ];
    const out = filterByAsOf(recs, "2026-01-01T00:00:00Z", (r) => r.ts, "strict");
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("isThinEvidence", () => {
  test("empty results are thin", () => {
    expect(isThinEvidence([])).toBe(true);
  });

  test("rich count is not thin even with low top score", () => {
    const recs = [{ score: 0.1 }, { score: 0.1 }, { score: 0.1 }];
    expect(isThinEvidence(recs)).toBe(false);
  });

  test("low count with strong top score is NOT thin", () => {
    const recs = [{ score: 0.9 }];
    expect(isThinEvidence(recs)).toBe(false);
  });

  test("low count with weak top score IS thin", () => {
    const recs = [{ score: 0.1 }];
    expect(isThinEvidence(recs)).toBe(true);
  });

  test("custom thresholds override defaults", () => {
    expect(isThinEvidence([{ score: 0.5 }], { minCount: 5, minTopScore: 0.8 })).toBe(true);
    expect(isThinEvidence([{ score: 0.9 }], { minCount: 5, minTopScore: 0.8 })).toBe(false);
  });
});

describe("classifyEvidenceQuality", () => {
  test("expanded when fallback was triggered", () => {
    expect(classifyEvidenceQuality(1, 5, true)).toBe("expanded");
  });

  test("rich when no expansion + enough results", () => {
    expect(classifyEvidenceQuality(5, 5, false)).toBe("rich");
  });

  test("thin when no expansion + few results", () => {
    expect(classifyEvidenceQuality(1, 1, false)).toBe("thin");
  });

  test("thin when first pass empty + no expansion", () => {
    expect(classifyEvidenceQuality(0, 0, false)).toBe("thin");
  });
});

describe("mergeAndDedupe", () => {
  test("dedupes by id field", () => {
    const a = [{ id: "1", content: "foo" }, { id: "2", content: "bar" }];
    const b = [{ id: "2", content: "bar (dup)" }, { id: "3", content: "baz" }];
    const out = mergeAndDedupe(a, b);
    expect(out.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(out.find((r) => r.id === "2")?.content).toBe("bar");
  });

  test("dedupes by url when id missing", () => {
    const a = [{ url: "x.com/1" }, { url: "x.com/2" }];
    const b = [{ url: "x.com/2" }, { url: "x.com/3" }];
    const out = mergeAndDedupe(a, b);
    expect(out).toHaveLength(3);
  });

  test("uses content+timestamp fingerprint when no id-ish field", () => {
    const a = [{ content: "hello world", createdAt: "2026-05-26" }];
    const b = [{ content: "hello world", createdAt: "2026-05-26" }, { content: "different" }];
    const out = mergeAndDedupe(a, b);
    expect(out).toHaveLength(2);
  });

  test("preserves primary order, then appends fallback", () => {
    const a = [{ id: "p1" }, { id: "p2" }];
    const b = [{ id: "f1" }, { id: "p1" }, { id: "f2" }];
    const out = mergeAndDedupe(a, b);
    expect(out.map((r) => r.id)).toEqual(["p1", "p2", "f1", "f2"]);
  });
});
