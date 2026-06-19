import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TipService } from "./tips.ts";

let tempDir: string;
let previousHome: string | undefined;

describe("TipService — context-gating", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gordon-tipsvc-"));
    previousHome = process.env.GORDON_HOME;
    process.env.GORDON_HOME = tempDir; // isolate tip_history.json
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.GORDON_HOME;
    else process.env.GORDON_HOME = previousHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("a predicate-gated tip is suppressed when its context is false", () => {
    const svc = new TipService();
    // sessionNumber 100 → every tip past the 10-session cooldown.
    // Empty context: ranBacktest/nearRiskLimit/hasOpenPositions all undefined,
    // so all predicate-gated tips fail their predicate and are skipped.
    const tip = svc.getNextTip(100, {});
    expect(tip).not.toBeNull();
    // The first eligible tip must NOT be one of the gated ones.
    expect(["trailing", "backtest", "risk"]).not.toContain(tip!.id);
    // It should be the first always-eligible tip in declaration order.
    expect(tip!.id).toBe("ensemble");
  });

  test("a predicate-gated tip surfaces when its context is true", () => {
    const svc = new TipService();
    // trailing is the first declared tip and is gated on hasOpenPositions.
    const tip = svc.getNextTip(100, { hasOpenPositions: true });
    expect(tip).not.toBeNull();
    expect(tip!.id).toBe("trailing");
  });

  test("a tip without a predicate behaves as before (always eligible)", () => {
    const svc = new TipService();
    // No context at all (default param). The first tip in order is "trailing"
    // which IS gated — so the first ungated tip "ensemble" surfaces.
    const tip = svc.getNextTip(100);
    expect(tip).not.toBeNull();
    expect(tip!.isRelevant).toBeUndefined();
    expect(tip!.id).toBe("ensemble");
  });

  test("cooldown still throttles repeats (rotation preserved)", () => {
    const svc = new TipService();
    const first = svc.getNextTip(100, {});
    expect(first!.id).toBe("ensemble");
    // Same session number → ensemble within cooldown, next ungated tip surfaces.
    const second = svc.getNextTip(100, {});
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe("ensemble");
  });
});
