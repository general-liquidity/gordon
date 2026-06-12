import { describe, it, expect } from "bun:test";
import type { EventBus } from "../../events/bus.ts";
import { installTempGordonHome } from "../../test-utils/tempGordonHome.ts";
import { getPositionStore, PHANTOM_GRACE_MS } from "./store.ts";
import { PositionStateMachine } from "./state-machine.ts";
import type { PositionRecord } from "./types.ts";

installTempGordonHome("gordon-posstore-test-");

const stubBus = { emit: async () => {} } as unknown as EventBus;

function record(overrides: Partial<PositionRecord> = {}): PositionRecord {
  const now = new Date().toISOString();
  return {
    id: `pos_test_${Math.random().toString(36).slice(2, 10)}`,
    symbol: "BTCUSDT",
    exchangeId: "default",
    side: "long",
    state: "idea",
    stateHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function agedIso(ageMs: number): string {
  return new Date(Date.now() - ageMs).toISOString();
}

describe("PositionStore phantom write guard", () => {
  it("rejects explicit zero quantity", async () => {
    const store = await getPositionStore();
    await expect(store.save(record({ quantity: 0 }))).rejects.toThrow(/Phantom position rejected/);
  });

  it("rejects explicit zero entryPrice", async () => {
    const store = await getPositionStore();
    await expect(store.save(record({ entryPrice: 0 }))).rejects.toThrow(/Phantom position rejected/);
  });

  it("rejects negative quantity", async () => {
    const store = await getPositionStore();
    await expect(store.save(record({ quantity: -1 }))).rejects.toThrow(/Phantom position rejected/);
  });

  it("accepts absent quantity/entryPrice (pre-fill) and positive values (filled)", async () => {
    const store = await getPositionStore();
    await store.save(record());
    await store.save(record({ state: "filled", entryPrice: 50_000, quantity: 0.01 }));
  });
});

describe("PositionStateMachine reload + zero-fill guards", () => {
  it("transitions a DB-reloaded position (NULL scalar columns must not fail schema validation)", async () => {
    // Regression: rowToPosition used to surface SQLite NULLs as JS null,
    // which the zod optionals reject — every transition of a persisted
    // position failed, stranding phantom 'idea' rows.
    const store = await getPositionStore();
    const sm = new PositionStateMachine(stubBus, store);
    const created = await sm.create({ symbol: "BTCUSDT", exchangeId: "default", side: "long" });

    const analyzed = await sm.transition(created.id, "analyzed");
    expect(analyzed.state).toBe("analyzed");
  });

  it("refuses to transition to 'filled' without positive entry data", async () => {
    const store = await getPositionStore();
    const sm = new PositionStateMachine(stubBus, store);
    const created = await sm.create({ symbol: "BTCUSDT", exchangeId: "default", side: "long" });
    await sm.transition(created.id, "analyzed");
    await sm.transition(created.id, "planned");
    await sm.transition(created.id, "approved");
    await sm.transition(created.id, "ordering");

    await expect(sm.transition(created.id, "filled")).rejects.toThrow(/positive entryPrice\/quantity/);
    await expect(
      sm.transition(created.id, "filled", { entryPrice: 0, quantity: 0 }),
    ).rejects.toThrow(/positive entryPrice\/quantity/);

    const filled = await sm.transition(created.id, "filled", { entryPrice: 50_000, quantity: 0.01 });
    expect(filled.state).toBe("filled");
  });
});

describe("PositionStore phantom read filter", () => {
  it("getActive excludes aged phantom rows but keeps fresh pre-fill and real positions", async () => {
    const store = await getPositionStore();
    const stale = agedIso(PHANTOM_GRACE_MS + 60_000);

    await store.save(record({ id: "pos_phantom", createdAt: stale, updatedAt: stale }));
    await store.save(record({ id: "pos_fresh_idea" }));
    await store.save(record({
      id: "pos_real",
      state: "filled",
      createdAt: stale,
      updatedAt: stale,
      entryPrice: 50_000,
      quantity: 0.01,
    }));

    const active = await store.getActive();
    const ids = active.map((p) => p.id);
    expect(ids).not.toContain("pos_phantom");
    expect(ids).toContain("pos_fresh_idea");
    expect(ids).toContain("pos_real");

    const phantoms = await store.getPhantoms();
    expect(phantoms.map((p) => p.id)).toEqual(["pos_phantom"]);
  });
});
