import { beforeEach, describe, expect, test } from "bun:test";
import {
  formatTurnsView,
  getTurnSummaries,
  recordTurn,
  resetTurnSummaries,
} from "./turnSummaries.ts";

describe("turnSummaries", () => {
  beforeEach(() => {
    resetTurnSummaries();
  });

  test("recordTurn populates the ring buffer", () => {
    recordTurn("scan BTC for setups", "Found two setups on BTC.");
    const turns = getTurnSummaries();
    expect(turns.length).toBe(1);
    expect(turns[0]!.userPrompt).toBe("scan BTC for setups");
    expect(turns[0]!.intent).toBe("scan");
  });

  test("empty user or assistant text is not recorded", () => {
    recordTurn("", "some reply");
    recordTurn("a prompt", "   ");
    expect(getTurnSummaries().length).toBe(0);
  });

  test("buffer caps at 50 turns", () => {
    for (let i = 0; i < 60; i++) {
      recordTurn(`prompt ${i}`, `reply ${i}`);
    }
    const turns = getTurnSummaries();
    expect(turns.length).toBe(50);
    expect(turns[0]!.userPrompt).toBe("prompt 59");
    expect(turns[49]!.userPrompt).toBe("prompt 10");
  });

  test("formatTurnsView lists newest first", () => {
    recordTurn("what is the ETH regime", "ETH is in a ranging regime.");
    recordTurn("buy 0.1 BTC", "Created a plan to buy 0.1 BTC.");
    const view = formatTurnsView("");
    expect(view).toContain("Recent turns");
    expect(view.indexOf("buy 0.1 BTC")).toBeLessThan(view.indexOf("what is the ETH regime"));
    expect(view).toContain("[long]");
  });

  test("formatTurnsView with no turns explains itself", () => {
    expect(formatTurnsView("")).toContain("No completed turns yet");
  });

  test("formatTurnsView with args finds a matching turn", () => {
    recordTurn("what is the ETH regime", "ETH is ranging.");
    recordTurn("scan SOL movers", "SOL movers listed.");
    const hit = formatTurnsView("ETH regime");
    expect(hit).toContain('matching "ETH regime"');
    expect(hit).toContain("what is the ETH regime");
  });

  test("formatTurnsView with non-matching args reports no match", () => {
    recordTurn("scan SOL movers", "SOL movers listed.");
    expect(formatTurnsView("doge")).toContain('No turn matching "doge"');
  });

  test("formatTurnsView respects the limit", () => {
    for (let i = 0; i < 20; i++) {
      recordTurn(`unique-prompt-${i}`, `reply ${i}`);
    }
    const view = formatTurnsView("", 5);
    expect(view).toContain("5 of 20");
    expect(view).toContain("unique-prompt-19");
    expect(view).not.toContain("unique-prompt-14");
  });
});
