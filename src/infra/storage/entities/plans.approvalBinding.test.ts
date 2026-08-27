import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plan } from "../../../types/plan.ts";
import { setDatabasePathForTesting } from "../database.ts";
import {
  createPlan,
  getPlan,
  updatePlan,
  computePlanContentHash,
  setApprovedContentHash,
  getApprovedContentHash,
} from "./plans.ts";

const dbPath = join(tmpdir(), `gordon-plans-binding-${process.pid}-${Date.now()}.db`);

beforeAll(() => {
  setDatabasePathForTesting(dbPath);
});

afterAll(() => {
  setDatabasePathForTesting(null);
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

function planFixture(
  overrides: Partial<Omit<Plan, "id" | "createdAt">> = {},
): Omit<Plan, "id" | "createdAt"> {
  return {
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.1 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 49_000 },
    takeProfit: [{ price: 52_000, percentToSell: 1 }],
    reasoning: "binding test plan",
    status: "DRAFT",
    ...overrides,
  };
}

describe("computePlanContentHash", () => {
  test("ignores metadata fields (status, reasoning, timestamps)", () => {
    const base = createPlan(planFixture());
    const sameContent: Plan = {
      ...base,
      createdAt: "2020-01-01T00:00:00.000Z",
      reasoning: "completely different reasoning",
      status: "APPROVED",
    };
    expect(computePlanContentHash(sameContent)).toBe(computePlanContentHash(base));
  });

  test("changes when any trade-relevant field changes", () => {
    const base = createPlan(planFixture());
    const hash = computePlanContentHash(base);
    expect(computePlanContentHash({ ...base, entry: { type: "limit", price: 51_000 } })).not.toBe(
      hash,
    );
    expect(computePlanContentHash({ ...base, stopLoss: { price: 48_000 } })).not.toBe(hash);
    expect(
      computePlanContentHash({ ...base, allocation: { ...base.allocation, amount: 2000 } }),
    ).not.toBe(hash);
    expect(
      computePlanContentHash({ ...base, takeProfit: [{ price: 55_000, percentToSell: 1 }] }),
    ).not.toBe(hash);
    expect(computePlanContentHash({ ...base, symbol: "ETHUSDT" })).not.toBe(hash);
    expect(computePlanContentHash({ ...base, direction: "short" })).not.toBe(hash);
  });
});

describe("approvedContentHash storage", () => {
  test("set/get roundtrip; defaults to null", () => {
    const plan = createPlan(planFixture());
    expect(getApprovedContentHash(plan.id)).toBeNull();
    setApprovedContentHash(plan.id, "abc123");
    expect(getApprovedContentHash(plan.id)).toBe("abc123");
  });
});

describe("updatePlan demotion on APPROVED content mutation", () => {
  function approvedPlan(): Plan {
    const plan = createPlan(planFixture());
    updatePlan(plan.id, { status: "APPROVED" });
    const approved = getPlan(plan.id)!;
    setApprovedContentHash(plan.id, computePlanContentHash(approved));
    return approved;
  }

  test("trade-field mutation demotes APPROVED to DRAFT and clears the hash", () => {
    const plan = approvedPlan();
    const result = updatePlan(plan.id, { stopLoss: { price: 47_500 } });
    expect(result.status).toBe("DRAFT");
    expect(getPlan(plan.id)!.status).toBe("DRAFT");
    expect(getApprovedContentHash(plan.id)).toBeNull();
  });

  test("demotion wins even when the update also tries to set a status", () => {
    const plan = approvedPlan();
    const result = updatePlan(plan.id, {
      entry: { type: "limit", price: 60_000 },
      status: "APPROVED",
    });
    expect(result.status).toBe("DRAFT");
    expect(getPlan(plan.id)!.status).toBe("DRAFT");
    expect(getApprovedContentHash(plan.id)).toBeNull();
  });

  test("status-only updates do not demote (approve, execute transitions)", () => {
    const plan = approvedPlan();
    const result = updatePlan(plan.id, { status: "EXECUTING" });
    expect(result.status).toBe("EXECUTING");
    expect(getApprovedContentHash(plan.id)).not.toBeNull();
  });

  test("non-trade-relevant updates (reasoning) do not demote", () => {
    const plan = approvedPlan();
    const result = updatePlan(plan.id, { reasoning: "updated commentary only" });
    expect(result.status).toBe("APPROVED");
    expect(getApprovedContentHash(plan.id)).not.toBeNull();
  });

  test("mutating a DRAFT plan never demotes or throws", () => {
    const plan = createPlan(planFixture());
    const result = updatePlan(plan.id, { stopLoss: { price: 45_000 } });
    expect(result.status).toBe("DRAFT");
  });

  test("mutate-then-reapprove restores an executable binding", () => {
    const plan = approvedPlan();
    updatePlan(plan.id, { stopLoss: { price: 47_000 } });
    expect(getPlan(plan.id)!.status).toBe("DRAFT");
    // Re-approve: status transition + fresh hash over the new content.
    updatePlan(plan.id, { status: "APPROVED" });
    const reapproved = getPlan(plan.id)!;
    setApprovedContentHash(plan.id, computePlanContentHash(reapproved));
    expect(getApprovedContentHash(plan.id)).toBe(computePlanContentHash(reapproved));
    expect(reapproved.status).toBe("APPROVED");
  });
});
