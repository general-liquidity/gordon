import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isShadowModeEnabled,
  defaultShadowFillsPath,
  recordShadowOpen,
  recordShadowClose,
  readShadowFills,
  summarizeShadowFills,
  compareShadowVsReal,
  shadowSummaryToPayload,
  SHADOW_FLAG_ENV,
  SHADOW_PATH_ENV,
} from "./shadowMode.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-shadow-test-"));
  logPath = join(tempDir, "shadow.jsonl");
});

describe("isShadowModeEnabled", () => {
  it("respects the flag", () => {
    expect(isShadowModeEnabled({})).toBe(false);
    expect(isShadowModeEnabled({ [SHADOW_FLAG_ENV]: "1" })).toBe(true);
    expect(isShadowModeEnabled({ [SHADOW_FLAG_ENV]: "true" })).toBe(true);
    expect(isShadowModeEnabled({ [SHADOW_FLAG_ENV]: "0" })).toBe(false);
  });
});

describe("defaultShadowFillsPath", () => {
  it("honors override env var", () => {
    expect(defaultShadowFillsPath({ [SHADOW_PATH_ENV]: "/custom/path.jsonl" })).toBe(
      "/custom/path.jsonl",
    );
  });

  it("falls back to home-dir default", () => {
    const p = defaultShadowFillsPath({});
    expect(p).toContain(".gordon");
    expect(p).toContain("shadow-fills.jsonl");
  });
});

describe("recordShadowOpen", () => {
  it("appends an open fill to the JSONL", () => {
    const fill = recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 50000,
        intendedSize: 0.1,
        strategy: "regime-rsi",
        stopLoss: 49000,
        takeProfit: 52000,
        now: 1_700_000_000_000,
      },
      logPath,
    );

    expect(fill.status).toBe("open");
    expect(fill.openedAt).toBe(1_700_000_000_000);
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.planId).toBe("p1");
    expect(parsed.status).toBe("open");
  });

  it("creates parent dir if missing", () => {
    const nested = join(tempDir, "nested", "deep", "shadow.jsonl");
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 50000,
        intendedSize: 0.1,
        strategy: "x",
      },
      nested,
    );
    expect(existsSync(nested)).toBe(true);
  });
});

describe("recordShadowClose", () => {
  it("appends a close diff", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 50000,
        intendedSize: 0.1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowClose(
      {
        planId: "p1",
        exitPrice: 52000,
        closeReason: "target",
        now: 1_700_000_999_000,
      },
      logPath,
    );

    const content = readFileSync(logPath, "utf8").trim().split("\n");
    expect(content.length).toBe(2);
    const closeRec = JSON.parse(content[1]!);
    expect(closeRec.type).toBe("close");
    expect(closeRec.exitPrice).toBe(52000);
  });
});

describe("readShadowFills", () => {
  it("returns empty array when file missing", () => {
    expect(readShadowFills({}, join(tempDir, "missing.jsonl"))).toEqual([]);
  });

  it("reconciles open + close into closed fill with PnL", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 2,
        strategy: "x",
      },
      logPath,
    );
    recordShadowClose({ planId: "p1", exitPrice: 110, closeReason: "target" }, logPath);

    const fills = readShadowFills({}, logPath);
    expect(fills.length).toBe(1);
    expect(fills[0]!.status).toBe("closed");
    expect(fills[0]!.pnl).toBe(20); // (110-100) * 2
    expect(fills[0]!.pnlFraction).toBeCloseTo(0.1); // 20 / (100*2)
    expect(fills[0]!.closeReason).toBe("target");
  });

  it("computes short PnL correctly", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "short",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowClose({ planId: "p1", exitPrice: 90, closeReason: "target" }, logPath);

    const fills = readShadowFills({}, logPath);
    expect(fills[0]!.pnl).toBe(10); // short profits when price drops
  });

  it("keeps open fill open if no matching close", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    const fills = readShadowFills({}, logPath);
    expect(fills[0]!.status).toBe("open");
    expect(fills[0]!.pnl).toBeNull();
  });

  it("filters by symbol", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowOpen(
      {
        planId: "p2",
        symbol: "ETH/USD",
        side: "long",
        entryPrice: 200,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );

    const btcOnly = readShadowFills({ symbol: "BTC/USD" }, logPath);
    expect(btcOnly.length).toBe(1);
    expect(btcOnly[0]!.planId).toBe("p1");
  });

  it("filters by status", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowOpen(
      {
        planId: "p2",
        symbol: "ETH/USD",
        side: "long",
        entryPrice: 200,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowClose({ planId: "p1", exitPrice: 110, closeReason: "target" }, logPath);

    expect(readShadowFills({ status: "open" }, logPath).length).toBe(1);
    expect(readShadowFills({ status: "closed" }, logPath).length).toBe(1);
  });

  it("filters by strategy", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "rsi",
      },
      logPath,
    );
    recordShadowOpen(
      {
        planId: "p2",
        symbol: "ETH/USD",
        side: "long",
        entryPrice: 200,
        intendedSize: 1,
        strategy: "macd",
      },
      logPath,
    );

    expect(readShadowFills({ strategy: "rsi" }, logPath).map((f) => f.planId)).toEqual(["p1"]);
  });

  it("filters by sinceMs", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
        now: 1000,
      },
      logPath,
    );
    recordShadowOpen(
      {
        planId: "p2",
        symbol: "ETH/USD",
        side: "long",
        entryPrice: 200,
        intendedSize: 1,
        strategy: "x",
        now: 2000,
      },
      logPath,
    );

    expect(readShadowFills({ sinceMs: 1500 }, logPath).map((f) => f.planId)).toEqual(["p2"]);
  });

  it("limits returned results", () => {
    for (let i = 0; i < 5; i++) {
      recordShadowOpen(
        {
          planId: `p${i}`,
          symbol: "BTC/USD",
          side: "long",
          entryPrice: 100,
          intendedSize: 1,
          strategy: "x",
          now: i * 1000,
        },
        logPath,
      );
    }
    expect(readShadowFills({ limit: 2 }, logPath).length).toBe(2);
  });

  it("tolerates malformed lines", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    const { appendFileSync } = require("node:fs");
    appendFileSync(logPath, "not-json{\n");
    recordShadowOpen(
      {
        planId: "p2",
        symbol: "ETH/USD",
        side: "long",
        entryPrice: 200,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );

    const fills = readShadowFills({}, logPath);
    expect(fills.length).toBe(2);
  });
});

describe("summarizeShadowFills", () => {
  it("returns zeros for empty input", () => {
    const s = summarizeShadowFills([]);
    expect(s.totalFills).toBe(0);
    expect(s.totalPnl).toBe(0);
    expect(s.winRate).toBeNull();
  });

  it("counts winners and losers correctly", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowOpen(
      {
        planId: "p2",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowClose({ planId: "p1", exitPrice: 110, closeReason: "target" }, logPath);
    recordShadowClose({ planId: "p2", exitPrice: 90, closeReason: "stop" }, logPath);

    const fills = readShadowFills({}, logPath);
    const s = summarizeShadowFills(fills);
    expect(s.winners).toBe(1);
    expect(s.losers).toBe(1);
    expect(s.winRate).toBe(0.5);
    expect(s.totalPnl).toBe(0); // +10 - 10
  });

  it("computes mean and std of pnl fractions across closed fills", () => {
    recordShadowOpen(
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowOpen(
      {
        planId: "p2",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
      },
      logPath,
    );
    recordShadowClose({ planId: "p1", exitPrice: 110, closeReason: "target" }, logPath);
    recordShadowClose({ planId: "p2", exitPrice: 90, closeReason: "stop" }, logPath);

    const s = summarizeShadowFills(readShadowFills({}, logPath));
    expect(s.pnlFractionMean).toBeCloseTo(0);
    expect(s.pnlFractionStd).toBeGreaterThan(0);
  });
});

describe("compareShadowVsReal", () => {
  it("computes divergence", () => {
    const shadow = summarizeShadowFills([
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
        stopLoss: null,
        takeProfit: null,
        openedAt: 0,
        closedAt: 1,
        exitPrice: 110,
        pnl: 10,
        pnlFraction: 0.1,
        closeReason: "target",
        status: "closed",
      },
    ]);
    const real = summarizeShadowFills([
      {
        planId: "r1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
        stopLoss: null,
        takeProfit: null,
        openedAt: 0,
        closedAt: 1,
        exitPrice: 105,
        pnl: 5,
        pnlFraction: 0.05,
        closeReason: "manual",
        status: "closed",
      },
    ]);
    const cmp = compareShadowVsReal(shadow, real);
    expect(cmp.divergencePnl).toBe(5);
    expect(cmp.divergencePnlFraction).toBeCloseTo(0.05);
  });

  it("nulls divergencePnlFraction when one side has no fractions", () => {
    const empty = summarizeShadowFills([]);
    const cmp = compareShadowVsReal(empty, empty);
    expect(cmp.divergencePnlFraction).toBeNull();
  });
});

describe("shadowSummaryToPayload", () => {
  it("emits stable shape", () => {
    const s = summarizeShadowFills([]);
    const p = shadowSummaryToPayload(s);
    expect(p.kind).toBe("shadow.summary_recorded");
    expect(p.totalFills).toBe(0);
  });
});
