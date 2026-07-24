import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import type { Plan } from "../../../../types/plan.ts";
import { setDatabasePathForTesting, getDatabase } from "../../../storage/database.ts";
import {
  createPlan,
  getPlan,
  updatePlan,
  computePlanContentHash,
  getApprovedContentHash,
} from "../../../storage/entities/plans.ts";
import { resetAllKillSwitches } from "../../../safety/killSwitches.ts";
import { resetSessionWipRegistryForTesting } from "../../../safety/wipSessionRegistry.ts";
import { approvePlanTool, executePlanTool } from "./trading.ts";

const dbPath = join(tmpdir(), `gordon-trading-binding-${process.pid}-${Date.now()}.db`);

beforeAll(() => {
  setDatabasePathForTesting(dbPath);
});

afterAll(() => {
  setDatabasePathForTesting(null);
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
  }
});

beforeEach(() => {
  resetAllKillSwitches();
  // The WIP-limit gate is default-ON and consults a process-wide session
  // registry singleton. A prior suite that executes a plan leaves activated
  // entries there; under a shared-process run that leak can trip execute_plan's
  // WIP gate (which fires before the allocation/price gates these tests assert
  // on) and mask the expected error. Reset it so each test starts with a clean
  // registry — this does not touch the approval-binding guard, only WIP state.
  resetSessionWipRegistryForTesting();
});

const RATIONALE = "User confirmed plan, entry trigger hit, no regime conflict";

function planFixture(overrides: Partial<Omit<Plan, "id" | "createdAt">> = {}): Omit<Plan, "id" | "createdAt"> {
  return {
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.01 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 49_000 },
    takeProfit: [{ price: 52_000, percentToSell: 1 }],
    reasoning: "approval binding test plan",
    status: "DRAFT",
    ...overrides,
  };
}

function makeExecContext(options: { quote?: number; portfolioValue?: number; maxAllocationPerTrade?: number } = {}) {
  const requestContext = new RequestContext();
  requestContext.set("exchange", {
    exchangeId: "binance",
    displayName: "Mock Binance",
    isSandbox: true,
    getPrice: async () => options.quote ?? 50_000,
    getBalance: async (asset: string) => asset === "USDT" ? 50_000 : 0,
    getFullAccountDetails: async () => ({
      accountInfo: {
        canTrade: true,
        canWithdraw: false,
        canDeposit: true,
        accountType: "SPOT",
        balances: [],
        updateTime: Date.now(),
      },
      totalUsdtValue: options.portfolioValue ?? 100_000,
      nonZeroBalances: [],
    }),
    get24hrTickers: async () => [],
    getSpread: async () => ({
      spread: 1,
      spreadPercent: 0.001,
      bidPrice: (options.quote ?? 50_000) - 0.5,
      askPrice: (options.quote ?? 50_000) + 0.5,
    }),
  });
  requestContext.set("config", {
    permissionMode: "ask",
    preferences: {
      maxAllocationPerTrade: options.maxAllocationPerTrade ?? 0.2,
      cashReservePercent: 0.2,
    },
  });
  requestContext.set("portfolioValue", options.portfolioValue ?? 100_000);
  requestContext.set("availableCash", 50_000);
  return { requestContext };
}

async function approve(planId: string) {
  return (await (approvePlanTool as unknown as {
    execute: (input: { planId: string }, ctx: unknown) => Promise<{ success: boolean; error?: string }>;
  }).execute({ planId }, makeExecContext()));
}

async function exec(planId: string, ctxOptions: Parameters<typeof makeExecContext>[0] = {}) {
  return (await (executePlanTool as unknown as {
    execute: (
      input: { planId: string; rationale: string },
      ctx: unknown,
    ) => Promise<{ success: boolean; error?: string }>;
  }).execute({ planId, rationale: RATIONALE }, makeExecContext(ctxOptions)));
}

describe("approve_plan content binding", () => {
  test("approval stores the canonical content hash", async () => {
    const plan = createPlan(planFixture());
    const result = await approve(plan.id);
    expect(result.success).toBe(true);
    const stored = getApprovedContentHash(plan.id);
    expect(stored).toBe(computePlanContentHash(getPlan(plan.id)!));
  });
});

describe("execute_plan content binding", () => {
  test("approve → mutate via updatePlan → execute is rejected (demoted to DRAFT)", async () => {
    const plan = createPlan(planFixture());
    await approve(plan.id);
    updatePlan(plan.id, { stopLoss: { price: 47_000 } });
    expect(getPlan(plan.id)!.status).toBe("DRAFT");
    const result = await exec(plan.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not APPROVED/i);
  });

  test("approve → direct-DB mutation keeping APPROVED → execute rejected on hash mismatch", async () => {
    const plan = createPlan(planFixture());
    await approve(plan.id);
    // Red-team path: mutate trade content without going through updatePlan,
    // so the status stays APPROVED and the stale approval hash remains.
    getDatabase()
      .prepare("UPDATE plans SET stopLoss = ? WHERE id = ?")
      .run(JSON.stringify({ price: 1 }), plan.id);
    expect(getPlan(plan.id)!.status).toBe("APPROVED");
    const result = await exec(plan.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/modified after approval/i);
  });

  test("mutate then re-approve passes the binding gate", async () => {
    const plan = createPlan(planFixture());
    await approve(plan.id);
    updatePlan(plan.id, { stopLoss: { price: 48_500 } });
    const reapproval = await approve(plan.id);
    expect(reapproval.success).toBe(true);
    const result = await exec(plan.id);
    // Execution proceeds past the binding + price gates; downstream gates
    // (risk kernel fail-closed on the stub exchange) may still block, but
    // never for approval-binding reasons.
    expect(result.error ?? "").not.toMatch(/modified after approval|content hash|not APPROVED/i);
  });

  test("APPROVED plan with no recorded hash (legacy) is rejected fail-closed", async () => {
    const plan = createPlan(planFixture());
    getDatabase().prepare("UPDATE plans SET status = 'APPROVED' WHERE id = ?").run(plan.id);
    const result = await exec(plan.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no recorded approval content hash/i);
  });
});

describe("execute_plan order-construction price gate", () => {
  test("zero limit entry price is rejected", async () => {
    const plan = createPlan(planFixture({ entry: { type: "limit", price: 0 } }));
    await approve(plan.id);
    const result = await exec(plan.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid price data/i);
    expect(result.error).toMatch(/entry price/i);
  });

  test("NaN stop-loss price is rejected", async () => {
    // JSON round-trip stores NaN as null — either way it is unusable.
    const plan = createPlan(planFixture({ stopLoss: { price: Number.NaN } }));
    await approve(plan.id);
    const result = await exec(plan.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid price data/i);
    expect(result.error).toMatch(/stop-loss/i);
  });

  test("degraded venue quote (NaN) blocks execution", async () => {
    const plan = createPlan(planFixture({ entry: { type: "market", price: null } }));
    await approve(plan.id);
    const result = await exec(plan.id, { quote: Number.NaN });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/degraded/i);
  });

  test("guardrails validateTrade blocks allocation above the configured cap", async () => {
    const plan = createPlan(planFixture({
      allocation: { currency: "USDT", amount: 50_000, percentOfPortfolio: 0.5 },
    }));
    await approve(plan.id);
    const result = await exec(plan.id, { portfolioValue: 100_000, maxAllocationPerTrade: 0.2 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Trade validation failed/i);
    expect(result.error).toMatch(/exceeds max allowed/i);
  });
});
