import { describe, expect, test } from "bun:test";
import { argumentHintFor, extractUsageArgs } from "./argumentHint.ts";

describe("extractUsageArgs", () => {
  test("splits required and optional tokens off the command name", () => {
    expect(extractUsageArgs("/chart <symbol> [timeframe]")).toEqual([
      "<symbol>",
      "[timeframe]",
    ]);
  });

  test("no-argument usage yields an empty list", () => {
    expect(extractUsageArgs("/scan")).toEqual([]);
  });

  test("keeps a bracketed alternation as a single token", () => {
    expect(extractUsageArgs("/trending [gainers|losers]")).toEqual([
      "[gainers|losers]",
    ]);
  });

  test("uses the primary form of a piped usage", () => {
    expect(extractUsageArgs("/history [symbol] [limit] | /history show <id>")).toEqual([
      "[symbol]",
      "[limit]",
    ]);
  });

  test("non-slash usage strings are ignored", () => {
    expect(extractUsageArgs("Per-skill invocation stats")).toEqual([]);
  });
});

describe("argumentHintFor", () => {
  test("shows the full argument list on exact command + trailing space", () => {
    expect(argumentHintFor("/chart ")).toEqual({
      active: "<symbol>",
      rest: ["[timeframe]"],
    });
  });

  test("advances to the next argument once one is typed", () => {
    expect(argumentHintFor("/chart BTC ")).toEqual({
      active: "[timeframe]",
      rest: [],
    });
  });

  test("hint clears once every argument is supplied", () => {
    expect(argumentHintFor("/chart BTC 1h ")).toBeNull();
  });

  test("hint is hidden while the user is typing an argument", () => {
    expect(argumentHintFor("/chart BTC")).toBeNull();
  });

  test("no hint without a trailing space", () => {
    expect(argumentHintFor("/chart")).toBeNull();
  });

  test("unknown command has no hint", () => {
    expect(argumentHintFor("/notacommand ")).toBeNull();
  });

  test("argument-free command shows no hint", () => {
    expect(argumentHintFor("/scan ")).toBeNull();
  });
});
