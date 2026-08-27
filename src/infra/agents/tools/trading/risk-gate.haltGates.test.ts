/**
 * The halt gates on the real order path.
 *
 * `evaluateOrderRisk` is the chokepoint every order dispatch goes through, so
 * this is where a blocking verdict has to turn into `approved: false`. The
 * gates' own arithmetic is covered in `infra/safety/preTradeHaltGates.test.ts`;
 * what is asserted here is that the order path consults them, names the gate
 * in the refusal, and still lets the operator out of a position.
 *
 * The debrief path is pinned to a temp file in every case: the streak breaker
 * reads ~/.gordon/debriefs.jsonl by default, and a developer with a real trade
 * history would otherwise decide these results.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drawdownTracker } from "../../../../core/risk-management/drawdown-tracker.ts";
import { DEBRIEF_MATRIX_PATH_ENV } from "../../../trading/ops/debriefMatrix.ts";
import { resetStreakCircuitForTesting } from "../../../trading/ops/streakCircuitState.ts";
import {
  resetSessionAbsorbingBarrierForTesting,
  trackSessionEquity,
} from "../../../safety/absorbingBarrierState.ts";
import { evaluateOrderRisk } from "./risk-gate.ts";
import type { GordonContext } from "../types.ts";

const EQUITY_USD = 10_000;
const PRICE_USD = 1_000;

const TOUCHED = [
  DEBRIEF_MATRIX_PATH_ENV,
  "GORDON_STREAK_CIRCUIT_BREAKER",
  "GORDON_GIVE_BACK_STOP",
  "GORDON_ABSORBING_BARRIER",
  "GORDON_BASE_R_PER_TRADE_USD",
  "GORDON_DAY_START_EQUITY_USD",
  "GORDON_RISK_DAILY_LOSS_USD",
];

const dirs: string[] = [];

function contextWith(options: {
  cashUsd: number;
  holdings?: Array<{ asset: string; total: number }>;
}): GordonContext {
  const holdings = options.holdings ?? [];
  const exchange = {
    exchangeId: "stub",
    isSandbox: true,
    getFullAccountDetails: async () => ({
      totalUsdtValue: EQUITY_USD,
      nonZeroBalances: [
        { asset: "USDT", free: options.cashUsd, locked: 0, total: options.cashUsd },
        ...holdings.map((holding) => ({ ...holding, free: holding.total, locked: 0 })),
      ],
    }),
    getBalance: async (asset: string) => (asset === "USDT" ? options.cashUsd : 0),
    getPrice: async () => PRICE_USD,
  };
  return { exchange, broker: null } as unknown as GordonContext;
}

const ENTRY_ORDER = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  quantity: 0.5,
  price: PRICE_USD,
};

/** Sells half of the 1 BTC held: on the exit side and inside the position. */
const EXIT_ORDER = {
  symbol: "BTCUSDT",
  side: "SELL",
  type: "LIMIT",
  quantity: 0.5,
  price: PRICE_USD,
};

function heldContext(): GordonContext {
  return contextWith({ cashUsd: 6_000, holdings: [{ asset: "BTC", total: 1 }] });
}

/** Write a debrief log with the given P&L sequence and point the gate at it. */
function debriefLog(pnls: number[]): void {
  const dir = mkdtempSync(join(tmpdir(), "gordon-riskgate-halt-"));
  dirs.push(dir);
  const path = join(dir, "debriefs.jsonl");
  const lines = pnls.map((pnlUsd, index) =>
    JSON.stringify({
      id: `dbr-${index}`,
      recordedAt: new Date(Date.now() - 60_000 + index).toISOString(),
      tradeId: `t${index}`,
      symbol: "BTCUSDT",
      pnlUsd,
      quadrant: "poetic_justice",
      action: "learn",
      processScore: 5,
      outcomeScore: 5,
      processGood: false,
      outcomeGood: false,
    }),
  );
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  process.env[DEBRIEF_MATRIX_PATH_ENV] = path;
}

beforeEach(() => {
  for (const name of TOUCHED) delete process.env[name];
  drawdownTracker.reset(EQUITY_USD);
  resetSessionAbsorbingBarrierForTesting();
  resetStreakCircuitForTesting();
  // Empty history unless a case writes one, so the default-on streak gate
  // cannot inherit the developer's real trades.
  debriefLog([]);
});

afterEach(() => {
  for (const name of TOUCHED) delete process.env[name];
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("streak circuit breaker on the order path", () => {
  test("three consecutive losses refuse a new entry and the refusal names the gate", async () => {
    debriefLog([-100, -100, -100]);

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("GORDON_STREAK_CIRCUIT_BREAKER");
    expect(result.reason).toContain("consecutive losses");
  });

  test("two losses leave the same entry approved", async () => {
    debriefLog([-100, -100]);

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
  });

  test("the operator can still exit while the breaker blocks new entries", async () => {
    debriefLog([-100, -100, -100]);

    const blocked = await evaluateOrderRisk(ENTRY_ORDER, heldContext());
    expect(blocked.approved).toBe(false);

    const exit = await evaluateOrderRisk(EXIT_ORDER, heldContext());
    expect(exit.approved).toBe(true);
    expect(exit.reason).not.toContain("halt gate");
    expect(exit.warnings.join(" ")).toContain("reduces existing exposure");
  });

  test("setting the flag off restores the pre-gate behaviour", async () => {
    debriefLog([-100, -100, -100]);
    process.env.GORDON_STREAK_CIRCUIT_BREAKER = "0";

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
  });
});

describe("give-back stop on the order path", () => {
  /** Session opened at 5,000, peaked at 20,000; the gate sees 10,000 now. */
  function seedGiveBack(): void {
    trackSessionEquity(5_000, {});
    trackSessionEquity(20_000, {});
  }

  test("an entry is refused once the session has given back more than half its peak profit", async () => {
    seedGiveBack();

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("GORDON_GIVE_BACK_STOP");
    expect(result.reason).toContain("give-back floor");
  });

  test("a session that never printed a profit leaves the entry approved", async () => {
    trackSessionEquity(10_000, {});

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
  });

  test("flattening is allowed while the give-back stop blocks new risk", async () => {
    seedGiveBack();

    const blocked = await evaluateOrderRisk(ENTRY_ORDER, heldContext());
    expect(blocked.approved).toBe(false);

    const exit = await evaluateOrderRisk(EXIT_ORDER, heldContext());
    expect(exit.approved).toBe(true);
    expect(exit.reason).not.toContain("halt gate");
  });

  test("setting the flag off restores the pre-gate behaviour", async () => {
    seedGiveBack();
    process.env.GORDON_GIVE_BACK_STOP = "0";

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
  });
});

describe("absorbing barrier on the order path", () => {
  function narrowBudget(): void {
    process.env.GORDON_BASE_R_PER_TRADE_USD = "100";
    process.env.GORDON_DAY_START_EQUITY_USD = String(EQUITY_USD);
    process.env.GORDON_RISK_DAILY_LOSS_USD = "400";
  }

  test("an entry inside the warn band of the broker barrier is refused", async () => {
    narrowBudget();

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("GORDON_ABSORBING_BARRIER");
    expect(result.reason).toContain("broker");
  });

  test("a comfortable budget leaves the entry approved", async () => {
    narrowBudget();
    process.env.GORDON_RISK_DAILY_LOSS_USD = "4000";

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
  });

  test("the operator can still exit while the barrier blocks new entries", async () => {
    narrowBudget();

    const blocked = await evaluateOrderRisk(ENTRY_ORDER, heldContext());
    expect(blocked.approved).toBe(false);

    const exit = await evaluateOrderRisk(EXIT_ORDER, heldContext());
    expect(exit.approved).toBe(true);
    expect(exit.reason).not.toContain("halt gate");
  });

  test("setting the flag off restores the pre-gate behaviour", async () => {
    narrowBudget();
    process.env.GORDON_ABSORBING_BARRIER = "0";

    const result = await evaluateOrderRisk(ENTRY_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
  });
});
