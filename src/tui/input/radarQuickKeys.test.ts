import { describe, expect, test } from "bun:test";

import { radarQuickKeyCommand, type RadarFocus } from "./radarQuickKeys.ts";

const focus: RadarFocus = {
  id: "sug_1234567890",
  category: "volatility",
  title: "BTC realized volatility spike",
};

describe("radarQuickKeyCommand", () => {
  test("maps ack/pass/snooze keys", () => {
    expect(radarQuickKeyCommand("a", focus)).toBe("/ack sug_1234567890");
    expect(radarQuickKeyCommand("p", focus)).toBe("/pass sug_1234567890");
    expect(radarQuickKeyCommand("d", focus)).toBe("/snooze volatility 60");
  });

  test("accepts uppercase keys from shifted input", () => {
    expect(radarQuickKeyCommand("A", focus)).toBe("/ack sug_1234567890");
  });

  test("returns null for unrelated keys and null focus", () => {
    expect(radarQuickKeyCommand("x", focus)).toBeNull();
    expect(radarQuickKeyCommand("a", null)).toBeNull();
  });
});
