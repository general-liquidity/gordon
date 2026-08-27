/**
 * The three halt gates, exercised directly.
 *
 * Every case supplies its own `env` so the operator's real settings and shell
 * cannot decide the verdict, and its own debrief path so the streak breaker
 * reads a known trade history rather than whatever is in ~/.gordon.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluatePreTradeHaltGates } from "./preTradeHaltGates.ts";
import {
  resetSessionAbsorbingBarrierForTesting,
  trackSessionEquity,
} from "./absorbingBarrierState.ts";
import { resetStreakCircuitForTesting } from "../trading/ops/streakCircuitState.ts";

const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);
const dirs: string[] = [];

function debriefPathWith(pnls: number[], offsetMs = -60_000): string {
  const dir = mkdtempSync(join(tmpdir(), "gordon-halt-"));
  dirs.push(dir);
  const path = join(dir, "debriefs.jsonl");
  const lines = pnls.map((pnlUsd, index) =>
    JSON.stringify({
      id: `dbr-${index}`,
      recordedAt: new Date(NOW + offsetMs + index).toISOString(),
      tradeId: `t${index}`,
      symbol: "BTCUSDT",
      pnlUsd,
      quadrant: pnlUsd > 0 ? "deserved_success" : "poetic_justice",
      action: "learn",
      processScore: 5,
      outcomeScore: 5,
      processGood: false,
      outcomeGood: false,
    }),
  );
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

/** Nothing enabled by default; each case turns on exactly the gate it tests. */
const OFF: NodeJS.ProcessEnv = {
  GORDON_STREAK_CIRCUIT_BREAKER: "0",
  GORDON_GIVE_BACK_STOP: "0",
  GORDON_ABSORBING_BARRIER: "0",
};

beforeEach(() => {
  resetSessionAbsorbingBarrierForTesting();
  resetStreakCircuitForTesting();
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("streak circuit breaker", () => {
  const on = { ...OFF, GORDON_STREAK_CIRCUIT_BREAKER: "1" };

  test("three consecutive losses block the next entry and name the gate", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
      debriefPath: debriefPathWith([-100, -100, -100]),
    });

    expect(verdict.blocks).toHaveLength(1);
    expect(verdict.blocks[0]?.gate).toBe("GORDON_STREAK_CIRCUIT_BREAKER");
    expect(verdict.blocks[0]?.reason).toContain("consecutive losses");
  });

  test("two consecutive losses do not block", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
      debriefPath: debriefPathWith([-100, -100]),
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("a win after the losses clears the streak", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
      debriefPath: debriefPathWith([-100, -100, -100, 50]),
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("the flag off leaves the same history unblocked", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: OFF,
      debriefPath: debriefPathWith([-100, -100, -100]),
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  /**
   * The reason this is not a kill switch. The trip starts a clock; once the
   * clock runs out the same three losses must not re-arm it, or a 60-minute
   * cooldown becomes a halt only a manual reset could clear.
   */
  test("the cooldown expires on its own and does not re-trip on the same losses", () => {
    const path = debriefPathWith([-100, -100, -100]);
    const first = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
      debriefPath: path,
    });
    expect(first.blocks).toHaveLength(1);

    const during = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW + 30 * 60_000,
      env: on,
      debriefPath: path,
    });
    expect(during.blocks[0]?.reason).toContain("Cooldown in progress");

    const after = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW + 61 * 60_000,
      env: on,
      debriefPath: path,
    });
    expect(after.blocks).toHaveLength(0);
  });

  test("an exposure-reducing order is exempt while the breaker blocks", () => {
    const path = debriefPathWith([-100, -100, -100]);
    const entry = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
      debriefPath: path,
    });
    expect(entry.blocks).toHaveLength(1);

    const exit = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: true,
      nowMs: NOW,
      env: on,
      debriefPath: path,
    });
    expect(exit.blocks).toHaveLength(0);
    expect(exit.warnings.join(" ")).toContain("reduces existing exposure");
  });
});

describe("give-back stop", () => {
  const on = { ...OFF, GORDON_GIVE_BACK_STOP: "1" };

  function seedSession(...equities: number[]): void {
    for (const equity of equities) trackSessionEquity(equity, {}, on);
  }

  test("giving back more than half the session high-water profit blocks", () => {
    seedSession(10_000, 20_000);

    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 14_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
    });

    expect(verdict.blocks).toHaveLength(1);
    expect(verdict.blocks[0]?.gate).toBe("GORDON_GIVE_BACK_STOP");
    expect(verdict.blocks[0]?.reason).toContain("give-back floor");
  });

  test("holding above the floor does not block", () => {
    seedSession(10_000, 20_000);

    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 18_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("a session with no high-water profit leaves the rule dormant", () => {
    seedSession(10_000);

    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 9_000,
      exposureReducing: false,
      nowMs: NOW,
      env: on,
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("the flag off leaves the same give-back unblocked", () => {
    seedSession(10_000, 20_000);

    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 14_000,
      exposureReducing: false,
      nowMs: NOW,
      env: OFF,
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("flattening is never blocked by the rule written to make you flatten", () => {
    seedSession(10_000, 20_000);

    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 14_000,
      exposureReducing: true,
      nowMs: NOW,
      env: on,
    });

    expect(verdict.blocks).toHaveLength(0);
  });
});

describe("absorbing barrier", () => {
  const on: NodeJS.ProcessEnv = {
    ...OFF,
    GORDON_ABSORBING_BARRIER: "1",
    GORDON_BASE_R_PER_TRADE_USD: "100",
    GORDON_DAY_START_EQUITY_USD: "10000",
  };

  test("a daily loss budget inside the warn band blocks", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: { ...on, GORDON_RISK_DAILY_LOSS_USD: "400" },
    });

    expect(verdict.blocks).toHaveLength(1);
    expect(verdict.blocks[0]?.gate).toBe("GORDON_ABSORBING_BARRIER");
    expect(verdict.blocks[0]?.reason).toContain("broker");
  });

  test("a comfortable budget does not block", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: { ...on, GORDON_RISK_DAILY_LOSS_USD: "2000" },
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("no R unit leaves the distance barriers inactive rather than guessed", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: { ...on, GORDON_BASE_R_PER_TRADE_USD: "", GORDON_RISK_DAILY_LOSS_USD: "400" },
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("the flag off leaves the same barrier unblocked", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      nowMs: NOW,
      env: { ...on, GORDON_ABSORBING_BARRIER: "0", GORDON_RISK_DAILY_LOSS_USD: "400" },
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("an exposure-reducing order is exempt while the barrier blocks", () => {
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: true,
      nowMs: NOW,
      env: { ...on, GORDON_RISK_DAILY_LOSS_USD: "400" },
    });

    expect(verdict.blocks).toHaveLength(0);
  });

  test("the terminal fold blocks once cumulative destroyed capital passes tau", () => {
    const env: NodeJS.ProcessEnv = {
      ...OFF,
      GORDON_ABSORBING_BARRIER: "1",
      GORDON_INCEPTION_LOSS_FRACTION: "0.2",
    };
    trackSessionEquity(100_000, { inceptionLossFraction: 0.2 }, env);

    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 70_000,
      exposureReducing: false,
      nowMs: NOW,
      env,
    });

    expect(verdict.blocks).toHaveLength(1);
    expect(verdict.blocks[0]?.reason).toContain("terminal");
  });
});
