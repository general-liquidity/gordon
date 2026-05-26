import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetObservationsForTests,
  getSymbolObservationCount,
  hasRecentSymbolObservation,
  lastObservationAt,
  recordSymbolObservation,
} from "./symbolObservationTracker.ts";

beforeEach(() => {
  _resetObservationsForTests();
});

describe("symbolObservationTracker", () => {
  test("returns false when nothing recorded", () => {
    expect(hasRecentSymbolObservation("BTC/USDT")).toBe(false);
    expect(getSymbolObservationCount("BTC/USDT")).toBe(0);
    expect(lastObservationAt("BTC/USDT")).toBeNull();
  });

  test("records and reads back a single observation", () => {
    recordSymbolObservation("BTC/USDT");
    expect(hasRecentSymbolObservation("BTC/USDT")).toBe(true);
    expect(getSymbolObservationCount("BTC/USDT")).toBe(1);
    expect(lastObservationAt("BTC/USDT")).not.toBeNull();
  });

  test("normalizes case + trims whitespace", () => {
    recordSymbolObservation("  btc/usdt  ");
    expect(hasRecentSymbolObservation("BTC/USDT")).toBe(true);
    expect(hasRecentSymbolObservation("btc/usdt")).toBe(true);
  });

  test("silently ignores empty + non-string inputs", () => {
    recordSymbolObservation("");
    recordSymbolObservation("   ");
    recordSymbolObservation(undefined);
    recordSymbolObservation(null);
    recordSymbolObservation(42);
    expect(getSymbolObservationCount("BTC/USDT")).toBe(0);
  });

  test("counts only within the window", async () => {
    recordSymbolObservation("ETH/USDT");
    // Wide window — should count.
    expect(getSymbolObservationCount("ETH/USDT", 60_000)).toBe(1);
    // Wait long enough that the observation falls outside a 5ms window.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(getSymbolObservationCount("ETH/USDT", 5)).toBe(0);
    expect(hasRecentSymbolObservation("ETH/USDT", 5)).toBe(false);
  });

  test("isolates symbols", () => {
    recordSymbolObservation("BTC/USDT");
    recordSymbolObservation("BTC/USDT");
    recordSymbolObservation("ETH/USDT");
    expect(getSymbolObservationCount("BTC/USDT")).toBe(2);
    expect(getSymbolObservationCount("ETH/USDT")).toBe(1);
    expect(getSymbolObservationCount("SOL/USDT")).toBe(0);
  });

  test("retains observations across multiple records", () => {
    for (let i = 0; i < 5; i++) recordSymbolObservation("AAPL");
    expect(getSymbolObservationCount("AAPL")).toBe(5);
    expect(hasRecentSymbolObservation("AAPL")).toBe(true);
  });

  test("trims oldest entries when over the cap", () => {
    // Push past the 200-entry cap.
    for (let i = 0; i < 250; i++) recordSymbolObservation("CAP/TEST");
    expect(getSymbolObservationCount("CAP/TEST")).toBeLessThanOrEqual(200);
  });
});
