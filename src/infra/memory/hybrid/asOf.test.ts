import { describe, it, expect } from "bun:test";
import { hybridSearch, type MemoryEntry } from "./search.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 6, 1); // decision instant

const entries: MemoryEntry[] = [
  {
    id: "past",
    content: "BTC reclaimed the range high on strong spot volume",
    timestamp: T0 - 5 * DAY,
    knownAt: T0 - 5 * DAY,
  },
  {
    id: "at",
    content: "BTC range high volume breakout confirmed intraday",
    timestamp: T0,
    knownAt: T0,
  },
  {
    id: "future",
    content: "BTC range high volume collapsed the following week",
    timestamp: T0 + 7 * DAY,
    knownAt: T0 + 7 * DAY,
  },
];

describe("hybridSearch as-of guard", () => {
  it("returns all matching entries when no as-of bound is set", () => {
    const results = hybridSearch("BTC range high volume", entries, { limit: 10 });
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(["at", "future", "past"]);
  });

  it("excludes any record learned after the as-of decision time (no lookahead)", () => {
    const results = hybridSearch("BTC range high volume", entries, {
      limit: 10,
      asOf: T0,
    });
    const ids = results.map((r) => r.id);
    expect(ids).toContain("past");
    expect(ids).toContain("at");
    // The record learned a week later must never surface for a decision at T0.
    expect(ids).not.toContain("future");
  });

  it("falls back to the valid-time timestamp when knownAt is absent", () => {
    const noKnownAt: MemoryEntry[] = entries.map(({ knownAt: _unused, ...rest }) => rest);
    const results = hybridSearch("BTC range high volume", noKnownAt, {
      limit: 10,
      asOf: T0,
    });
    expect(results.map((r) => r.id)).not.toContain("future");
  });

  it("keeps evergreen entries (null timestamp) visible under an as-of bound", () => {
    const withEvergreen: MemoryEntry[] = [
      ...entries,
      { id: "rule", content: "BTC range high volume breakouts need confirmation", timestamp: null },
    ];
    const results = hybridSearch("BTC range high volume", withEvergreen, {
      limit: 10,
      asOf: T0,
    });
    expect(results.map((r) => r.id)).toContain("rule");
    expect(results.map((r) => r.id)).not.toContain("future");
  });
});
