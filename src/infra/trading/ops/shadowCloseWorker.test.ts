import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveShadowFill,
  tickShadowCloseWorker,
  DEFAULT_SHADOW_MAX_HOLD_MS,
} from "./shadowCloseWorker.ts";
import { recordShadowOpen, readShadowFills } from "./shadowMode.ts";
import type { ShadowFill } from "./shadowMode.ts";

let tempDir: string;
let shadowPath: string;
let shadowEnv: NodeJS.ProcessEnv;

function longFill(overrides: Partial<ShadowFill> = {}): ShadowFill {
  return {
    planId: "pln_test",
    symbol: "BTCUSDT",
    side: "long",
    entryPrice: 100,
    intendedSize: 0.01,
    strategy: "support_bounce",
    stopLoss: 90,
    takeProfit: 120,
    openedAt: Date.now() - 60_000,
    closedAt: null,
    exitPrice: null,
    pnl: null,
    pnlFraction: null,
    closeReason: null,
    status: "open",
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-shadow-close-"));
  shadowPath = join(tempDir, "shadow-fills.jsonl");
  shadowEnv = {
    GORDON_SHADOW_MODE: "1",
    GORDON_SHADOW_FILLS_PATH: shadowPath,
  } as NodeJS.ProcessEnv;
});

describe("resolveShadowFill", () => {
  it("closes long on stop hit", () => {
    const res = resolveShadowFill(longFill(), 89, Date.now(), DEFAULT_SHADOW_MAX_HOLD_MS);
    expect(res.shouldClose).toBe(true);
    expect(res.closeReason).toBe("stop");
    expect(res.exitPrice).toBe(90);
  });

  it("closes long on target hit", () => {
    const res = resolveShadowFill(longFill(), 121, Date.now(), DEFAULT_SHADOW_MAX_HOLD_MS);
    expect(res.shouldClose).toBe(true);
    expect(res.closeReason).toBe("target");
    expect(res.exitPrice).toBe(120);
  });

  it("closes on max-hold timeout", () => {
    const now = Date.now();
    const res = resolveShadowFill(
      longFill({ openedAt: now - DEFAULT_SHADOW_MAX_HOLD_MS - 1 }),
      100,
      now,
      DEFAULT_SHADOW_MAX_HOLD_MS,
    );
    expect(res.shouldClose).toBe(true);
    expect(res.closeReason).toBe("time");
    expect(res.exitPrice).toBe(100);
  });

  it("closes short on stop hit", () => {
    const res = resolveShadowFill(
      longFill({ side: "short", stopLoss: 110, takeProfit: 80 }),
      111,
      Date.now(),
      DEFAULT_SHADOW_MAX_HOLD_MS,
    );
    expect(res.shouldClose).toBe(true);
    expect(res.closeReason).toBe("stop");
  });
});

describe("tickShadowCloseWorker", () => {
  it("no-ops when shadow mode is disabled", async () => {
    const result = await tickShadowCloseWorker({ path: shadowPath, env: {} });
    expect(result.checked).toBe(0);
    expect(result.closed).toBe(0);
  });

  it("closes open fills via injected price fetcher", async () => {
    recordShadowOpen(
      {
        planId: "pln_close_1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 100,
        intendedSize: 0.01,
        strategy: "support_bounce",
        stopLoss: 90,
        takeProfit: 120,
      },
      shadowPath,
    );

    const result = await tickShadowCloseWorker({
      path: shadowPath,
      env: shadowEnv,
      priceFetcher: async () => 121,
      now: Date.now(),
    });

    expect(result.checked).toBe(1);
    expect(result.closed).toBe(1);
    const fills = readShadowFills({}, shadowPath);
    expect(fills[0]?.status).toBe("closed");
    expect(fills[0]?.closeReason).toBe("target");
  });

  it("skips fills when price is unavailable", async () => {
    recordShadowOpen(
      {
        planId: "pln_close_2",
        symbol: "ETHUSDT",
        side: "long",
        entryPrice: 2000,
        intendedSize: 0.01,
        strategy: "support_bounce",
        stopLoss: 1900,
        takeProfit: 2200,
      },
      shadowPath,
    );

    const result = await tickShadowCloseWorker({
      path: shadowPath,
      env: shadowEnv,
      priceFetcher: async () => null,
    });

    expect(result.checked).toBe(1);
    expect(result.closed).toBe(0);
    expect(result.skippedNoPrice).toBe(1);
    expect(readShadowFills({ status: "open" }, shadowPath)).toHaveLength(1);
  });
});