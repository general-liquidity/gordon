import { describe, expect, test } from "bun:test";

import { fuzzyMatch } from "./fuzzy.ts";

describe("fuzzyMatch", () => {
  test("matches case-insensitively", () => {
    expect(fuzzyMatch("BTC", "/scan btc breakout")).not.toBeNull();
  });

  test("matches scattered subsequences", () => {
    expect(fuzzyMatch("pln", "plan")).not.toBeNull();
  });

  test("returns null when the query cannot match", () => {
    expect(fuzzyMatch("xyz", "plan")).toBeNull();
  });

  test("scores contiguous matches above scattered matches", () => {
    const substring = fuzzyMatch("plan", "create trade plan")?.score ?? 0;
    const scattered = fuzzyMatch("pln", "plan")?.score ?? 0;
    expect(substring).toBeGreaterThan(scattered);
  });

  test("prefers shorter targets when match quality ties", () => {
    const short = fuzzyMatch("plan", "plan")?.score ?? 0;
    const long = fuzzyMatch("plan", "plan a detailed btc trade")?.score ?? 0;
    expect(short).toBeGreaterThan(long);
  });
});
