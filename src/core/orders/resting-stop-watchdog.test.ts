import { describe, expect, it } from "bun:test";
import { scanRestingStops } from "./resting-stop-watchdog.ts";
import type { WatchedOrder, WatchedPosition } from "./resting-stop-watchdog.ts";

const pos = (over: Partial<WatchedPosition> = {}): WatchedPosition => ({
  positionId: "p1",
  symbol: "BTCUSDT",
  side: "long",
  quantity: 1,
  stopOrderId: "s1",
  ...over,
});

const ord = (over: Partial<WatchedOrder> = {}): WatchedOrder => ({
  orderId: "s1",
  status: "NEW",
  ...over,
});

describe("scanRestingStops", () => {
  it("a working stop produces no alert", () => {
    const r = scanRestingStops({ positions: [pos()], orders: [ord({ status: "NEW" })] });
    expect(r.alerts).toHaveLength(0);
    expect(r.reArmRequired).toBe(false);
    expect(r.protectedCount).toBe(1);
    expect(r.scanned).toBe(1);
  });

  it("PARTIALLY_FILLED counts as working by default", () => {
    const r = scanRestingStops({
      positions: [pos()],
      orders: [ord({ status: "PARTIALLY_FILLED" })],
    });
    expect(r.reArmRequired).toBe(false);
    expect(r.protectedCount).toBe(1);
  });

  it("a cancelled stop demands re-arm (critical)", () => {
    const r = scanRestingStops({ positions: [pos()], orders: [ord({ status: "CANCELED" })] });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]!.liveness).toBe("cancelled");
    expect(r.alerts[0]!.action).toBe("re-arm");
    expect(r.alerts[0]!.severity).toBe("critical");
    expect(r.reArmRequired).toBe(true);
  });

  it("an expired day-order stop demands re-arm", () => {
    const r = scanRestingStops({ positions: [pos()], orders: [ord({ status: "EXPIRED" })] });
    expect(r.alerts[0]!.liveness).toBe("expired");
    expect(r.alerts[0]!.action).toBe("re-arm");
  });

  it("a rejected stop demands re-arm", () => {
    const r = scanRestingStops({ positions: [pos()], orders: [ord({ status: "REJECTED" })] });
    expect(r.alerts[0]!.liveness).toBe("rejected");
    expect(r.reArmRequired).toBe(true);
  });

  it("an absent stop (no stopOrderId) demands re-arm", () => {
    const r = scanRestingStops({ positions: [pos({ stopOrderId: undefined })], orders: [] });
    expect(r.alerts[0]!.liveness).toBe("absent");
    expect(r.alerts[0]!.stopOrderId).toBeNull();
    expect(r.alerts[0]!.action).toBe("re-arm");
  });

  it("a dangling stop reference (order not found) is treated as absent", () => {
    const r = scanRestingStops({ positions: [pos({ stopOrderId: "missing" })], orders: [] });
    expect(r.alerts[0]!.liveness).toBe("absent");
    expect(r.reArmRequired).toBe(true);
  });

  it("a filled stop flags reconcile, not re-arm", () => {
    const r = scanRestingStops({ positions: [pos()], orders: [ord({ status: "FILLED" })] });
    expect(r.alerts[0]!.liveness).toBe("filled");
    expect(r.alerts[0]!.action).toBe("reconcile");
    expect(r.reArmRequired).toBe(false);
  });

  it("pending_cancel is a warning re-arm", () => {
    const r = scanRestingStops({ positions: [pos()], orders: [ord({ status: "PENDING_CANCEL" })] });
    expect(r.alerts[0]!.liveness).toBe("pending_cancel");
    expect(r.alerts[0]!.severity).toBe("warning");
    expect(r.alerts[0]!.action).toBe("re-arm");
  });

  it("explicit isWorking flag overrides status vocabulary", () => {
    const working = scanRestingStops({
      positions: [pos()],
      orders: [ord({ status: "CANCELED", isWorking: true })],
    });
    expect(working.alerts).toHaveLength(0);
    const dead = scanRestingStops({
      positions: [pos()],
      orders: [ord({ status: "NEW", isWorking: false })],
    });
    expect(dead.alerts).toHaveLength(1);
    expect(dead.reArmRequired).toBe(true);
  });

  it("flat positions (quantity 0) are skipped", () => {
    const r = scanRestingStops({
      positions: [pos({ quantity: 0, stopOrderId: undefined })],
      orders: [],
    });
    expect(r.scanned).toBe(0);
    expect(r.alerts).toHaveLength(0);
    expect(r.summary).toBe("no open positions to scan");
  });

  it("custom workingStatuses set narrows what counts as live", () => {
    const r = scanRestingStops({
      positions: [pos()],
      orders: [ord({ status: "PARTIALLY_FILLED" })],
      workingStatuses: ["NEW"],
    });
    expect(r.reArmRequired).toBe(true);
    expect(r.alerts[0]!.liveness).toBe("dead");
  });

  it("mixed portfolio summarizes protected vs re-arm counts", () => {
    const r = scanRestingStops({
      positions: [
        pos({ positionId: "p1", stopOrderId: "s1" }),
        pos({ positionId: "p2", symbol: "ETHUSDT", stopOrderId: "s2" }),
        pos({ positionId: "p3", symbol: "SOLUSDT", stopOrderId: undefined }),
      ],
      orders: [ord({ orderId: "s1", status: "NEW" }), ord({ orderId: "s2", status: "CANCELED" })],
    });
    expect(r.scanned).toBe(3);
    expect(r.protectedCount).toBe(1);
    expect(r.alerts).toHaveLength(2);
    expect(r.reArmRequired).toBe(true);
    expect(r.summary).toBe("1/3 positions protected; 2 need re-arm");
  });
});
