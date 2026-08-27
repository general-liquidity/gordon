import { describe, it, expect } from "bun:test";
import { executeAtomicGroup, validateOrderLeg } from "./atomicExecution.ts";
import type { OrderLeg, OrderSubmitter, OrderCanceller } from "./atomicExecution.ts";

function leg(overrides: Partial<OrderLeg> = {}): OrderLeg {
  return {
    legId: `leg_${Math.random().toString(36).slice(2, 8)}`,
    label: "Entry",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: 0.5,
    price: 50_000,
    venue: "binance",
    ...overrides,
  };
}

function okSubmitter(): { submit: OrderSubmitter; calls: OrderLeg[] } {
  const calls: OrderLeg[] = [];
  const submit: OrderSubmitter = async (l) => {
    calls.push(l);
    return { orderId: `ord_${l.legId}`, fillPrice: l.price, fillQuantity: l.quantity };
  };
  return { submit, calls };
}

function okCanceller(): { cancel: OrderCanceller; calls: string[] } {
  const calls: string[] = [];
  const cancel: OrderCanceller = async (orderId) => {
    calls.push(orderId);
    return true;
  };
  return { cancel, calls };
}

describe("validateOrderLeg", () => {
  it("passes a well-formed limit leg", () => {
    expect(validateOrderLeg(leg())).toEqual([]);
  });

  it("rejects zero, negative, and NaN quantity", () => {
    for (const q of [0, -1, Number.NaN]) {
      expect(validateOrderLeg(leg({ quantity: q })).length).toBeGreaterThan(0);
    }
  });

  it("rejects negative and non-finite price", () => {
    expect(validateOrderLeg(leg({ price: -50_000 })).length).toBeGreaterThan(0);
    expect(validateOrderLeg(leg({ price: Number.POSITIVE_INFINITY })).length).toBeGreaterThan(0);
  });

  it("requires price on LIMIT and STOP_LIMIT", () => {
    expect(validateOrderLeg(leg({ type: "LIMIT", price: undefined })).length).toBeGreaterThan(0);
    expect(
      validateOrderLeg(leg({ type: "STOP_LIMIT", price: undefined, stopPrice: 49_000 })).length,
    ).toBeGreaterThan(0);
  });

  it("requires stopPrice on STOP and STOP_LIMIT", () => {
    expect(
      validateOrderLeg(leg({ type: "STOP", price: undefined, stopPrice: undefined })).length,
    ).toBeGreaterThan(0);
    expect(validateOrderLeg(leg({ type: "STOP", price: undefined, stopPrice: 49_000 }))).toEqual(
      [],
    );
  });

  it("allows MARKET legs without price", () => {
    expect(validateOrderLeg(leg({ type: "MARKET", price: undefined }))).toEqual([]);
  });

  it("rejects empty symbol, venue, legId", () => {
    expect(validateOrderLeg(leg({ symbol: "" })).length).toBeGreaterThan(0);
    expect(validateOrderLeg(leg({ venue: " " })).length).toBeGreaterThan(0);
    expect(validateOrderLeg(leg({ legId: "" })).length).toBeGreaterThan(0);
  });
});

describe("executeAtomicGroup — pre-submit bounds check", () => {
  it("rejects the whole group before any submit when one leg is invalid", async () => {
    const { submit, calls } = okSubmitter();
    const { cancel, calls: cancelCalls } = okCanceller();
    const legs = [
      leg({ legId: "a", label: "Entry" }),
      leg({ legId: "b", label: "Stop", quantity: -1 }),
      leg({ legId: "c", label: "Target" }),
    ];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(group.status).toBe("rejected");
    expect(calls).toHaveLength(0);
    expect(cancelCalls).toHaveLength(0);
    expect(group.results.find((r) => r.legId === "b")!.status).toBe("failed");
    expect(group.results.find((r) => r.legId === "b")!.error).toContain("Validation failed");
    expect(group.results.find((r) => r.legId === "a")!.status).toBe("cancelled");
    expect(group.results.find((r) => r.legId === "a")!.error).toContain("invalid sibling leg");
    expect(group.completedAt).toBeDefined();
  });

  it("rejects a LIMIT leg with no price without submitting", async () => {
    const { submit, calls } = okSubmitter();
    const { cancel } = okCanceller();
    const group = await executeAtomicGroup([leg({ price: undefined })], submit, cancel);
    expect(group.status).toBe("rejected");
    expect(calls).toHaveLength(0);
  });
});

describe("executeAtomicGroup — happy path", () => {
  it("fills all legs and completes", async () => {
    const { submit, calls } = okSubmitter();
    const { cancel, calls: cancelCalls } = okCanceller();
    const legs = [leg({ legId: "a" }), leg({ legId: "b" }), leg({ legId: "c" })];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(group.status).toBe("completed");
    expect(calls.map((l) => l.legId)).toEqual(["a", "b", "c"]);
    expect(cancelCalls).toHaveLength(0);
    for (const r of group.results) {
      expect(r.status).toBe("filled");
      expect(r.orderId).toBeDefined();
    }
  });

  it("submits dependent legs once their dependency fills", async () => {
    const { submit, calls } = okSubmitter();
    const { cancel } = okCanceller();
    const legs = [leg({ legId: "a" }), leg({ legId: "b", dependsOn: "a" })];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(group.status).toBe("completed");
    expect(calls.map((l) => l.legId)).toEqual(["a", "b"]);
  });

  it("skips a leg whose dependency is not filled", async () => {
    const { submit, calls } = okSubmitter();
    const { cancel } = okCanceller();
    const legs = [leg({ legId: "a" }), leg({ legId: "b", dependsOn: "missing" })];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(calls.map((l) => l.legId)).toEqual(["a"]);
    const skipped = group.results.find((r) => r.legId === "b")!;
    expect(skipped.status).toBe("cancelled");
    expect(skipped.error).toContain("not filled");
    expect(group.status).toBe("completed");
  });
});

describe("executeAtomicGroup — rollback semantics", () => {
  it("rolls back legs 0..N-1 in LIFO order when leg N fails", async () => {
    const failOn = "c";
    const submitted: string[] = [];
    const submit: OrderSubmitter = async (l) => {
      if (l.legId === failOn) throw new Error("insufficient margin");
      submitted.push(l.legId);
      return { orderId: `ord_${l.legId}` };
    };
    const { cancel, calls: cancelCalls } = okCanceller();
    const legs = [
      leg({ legId: "a" }),
      leg({ legId: "b" }),
      leg({ legId: "c" }),
      leg({ legId: "d" }),
    ];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(group.status).toBe("rolled_back");
    expect(submitted).toEqual(["a", "b"]);
    expect(cancelCalls).toEqual(["ord_b", "ord_a"]); // LIFO
    expect(group.results.find((r) => r.legId === "a")!.status).toBe("cancelled");
    expect(group.results.find((r) => r.legId === "b")!.status).toBe("cancelled");
    expect(group.results.find((r) => r.legId === "c")!.status).toBe("failed");
    expect(group.results.find((r) => r.legId === "c")!.error).toContain("insufficient margin");
    expect(group.results.find((r) => r.legId === "d")!.status).toBe("cancelled");
    expect(group.results.find((r) => r.legId === "d")!.error).toContain("rollback");
  });

  it("marks a leg orphaned when its cancel returns false", async () => {
    const submit: OrderSubmitter = async (l) => {
      if (l.legId === "b") throw new Error("rejected");
      return { orderId: `ord_${l.legId}` };
    };
    const cancel: OrderCanceller = async () => false;
    const legs = [leg({ legId: "a" }), leg({ legId: "b" })];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(group.status).toBe("partial_orphan");
    const orphan = group.results.find((r) => r.legId === "a")!;
    expect(orphan.status).toBe("orphaned");
    expect(orphan.error).toContain("manual review");
  });

  it("marks a leg orphaned when its cancel throws", async () => {
    const submit: OrderSubmitter = async (l) => {
      if (l.legId === "b") throw new Error("rejected");
      return { orderId: `ord_${l.legId}` };
    };
    const cancel: OrderCanceller = async () => {
      throw new Error("venue timeout");
    };
    const legs = [leg({ legId: "a" }), leg({ legId: "b" })];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(group.status).toBe("partial_orphan");
    const orphan = group.results.find((r) => r.legId === "a")!;
    expect(orphan.status).toBe("orphaned");
    expect(orphan.error).toContain("Cancel failed: venue timeout");
  });

  it("mixes orphaned and cancelled when only some cancels fail", async () => {
    const submit: OrderSubmitter = async (l) => {
      if (l.legId === "c") throw new Error("rejected");
      return { orderId: `ord_${l.legId}` };
    };
    const cancel: OrderCanceller = async (orderId) => orderId !== "ord_a";
    const legs = [leg({ legId: "a" }), leg({ legId: "b" }), leg({ legId: "c" })];

    const group = await executeAtomicGroup(legs, submit, cancel);

    expect(group.status).toBe("partial_orphan");
    expect(group.results.find((r) => r.legId === "a")!.status).toBe("orphaned");
    expect(group.results.find((r) => r.legId === "b")!.status).toBe("cancelled");
  });
});
