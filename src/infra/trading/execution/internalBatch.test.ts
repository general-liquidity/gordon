import { describe, it, expect } from "bun:test";
import { computeInternalBatch, type BatchOrderInput } from "./internalBatch.ts";

function order(
  orderId: string,
  symbol: string,
  side: "buy" | "sell",
  qty: number,
  referencePrice: number,
  strategyTag?: string,
): BatchOrderInput {
  return { orderId, symbol, side, qty, referencePrice, strategyTag };
}

describe("computeInternalBatch — empty / single-side", () => {
  it("returns no crossings when input is empty", () => {
    const result = computeInternalBatch([]);
    expect(result.internalCrossings).toEqual([]);
    expect(result.externalOrders).toEqual([]);
    expect(result.totalCrossedQty).toBe(0);
  });

  it("returns no crossings when only buys present", () => {
    const result = computeInternalBatch([
      order("a", "AAPL", "buy", 100, 150),
      order("b", "AAPL", "buy", 50, 151),
    ]);
    expect(result.internalCrossings).toEqual([]);
    expect(result.externalOrders.length).toBe(2);
    expect(result.totalCrossedQty).toBe(0);
    expect(result.totalExternalQty).toBe(150);
  });

  it("returns no crossings when only sells present", () => {
    const result = computeInternalBatch([
      order("a", "AAPL", "sell", 100, 150),
      order("b", "AAPL", "sell", 50, 151),
    ]);
    expect(result.internalCrossings).toEqual([]);
    expect(result.totalCrossedQty).toBe(0);
  });

  it("returns no crossings when symbols differ", () => {
    const result = computeInternalBatch([
      order("a", "AAPL", "buy", 100, 150),
      order("b", "MSFT", "sell", 100, 400),
    ]);
    expect(result.internalCrossings).toEqual([]);
  });
});

describe("computeInternalBatch — basic crossing", () => {
  it("crosses equal-quantity buy + sell at midpoint price", () => {
    const result = computeInternalBatch([
      order("buy1", "AAPL", "buy", 100, 150),
      order("sell1", "AAPL", "sell", 100, 152),
    ]);
    expect(result.internalCrossings.length).toBe(1);
    const c = result.internalCrossings[0]!;
    expect(c.qty).toBe(100);
    expect(c.clearingPrice).toBe(151); // midpoint
    expect(c.buyOrderId).toBe("buy1");
    expect(c.sellOrderId).toBe("sell1");
    expect(result.totalCrossedQty).toBe(100);
  });

  it("crosses smaller of two quantities; residual stays external", () => {
    const result = computeInternalBatch([
      order("buy1", "AAPL", "buy", 100, 150),
      order("sell1", "AAPL", "sell", 30, 150),
    ]);
    expect(result.internalCrossings.length).toBe(1);
    expect(result.internalCrossings[0]!.qty).toBe(30);
    const buyResidual = result.externalOrders.find((o) => o.orderId === "buy1")!;
    expect(buyResidual.residualQty).toBe(70);
    const sellResidual = result.externalOrders.find((o) => o.orderId === "sell1")!;
    expect(sellResidual.residualQty).toBe(0);
  });

  it("FIFO matching across multiple orders", () => {
    const result = computeInternalBatch([
      order("buy1", "AAPL", "buy", 50, 150),
      order("buy2", "AAPL", "buy", 80, 150),
      order("sell1", "AAPL", "sell", 100, 150),
    ]);
    // buy1 (50) fully crosses with sell1, leaving sell1 at 50 remaining
    // buy2 (80) crosses 50 with sell1's remainder, leaving buy2 at 30
    expect(result.internalCrossings.length).toBe(2);
    expect(result.totalCrossedQty).toBe(100);
    const buy2Residual = result.externalOrders.find((o) => o.orderId === "buy2")!;
    expect(buy2Residual.residualQty).toBe(30);
  });
});

describe("computeInternalBatch — multi-symbol", () => {
  it("crosses within each symbol independently", () => {
    const result = computeInternalBatch([
      order("a1", "AAPL", "buy", 100, 150),
      order("a2", "AAPL", "sell", 100, 150),
      order("m1", "MSFT", "buy", 50, 400),
      order("m2", "MSFT", "sell", 50, 400),
    ]);
    expect(result.internalCrossings.length).toBe(2);
    expect(result.symbolSummary.length).toBe(2);
    expect(result.totalCrossedQty).toBe(150);
  });

  it("populates per-symbol summary correctly", () => {
    const result = computeInternalBatch([
      order("a1", "AAPL", "buy", 100, 150),
      order("a2", "AAPL", "sell", 60, 150),
    ]);
    const summary = result.symbolSummary.find((s) => s.symbol === "AAPL")!;
    expect(summary.grossBuyQty).toBe(100);
    expect(summary.grossSellQty).toBe(60);
    expect(summary.crossedQty).toBe(60);
    expect(summary.netExternalQty).toBe(40);
    expect(summary.netExternalSide).toBe("buy");
  });
});

describe("computeInternalBatch — requireDifferentStrategy", () => {
  it("crosses orders from different strategies by default", () => {
    const result = computeInternalBatch([
      order("a1", "AAPL", "buy", 100, 150, "strategy_x"),
      order("a2", "AAPL", "sell", 100, 150, "strategy_y"),
    ]);
    expect(result.internalCrossings.length).toBe(1);
  });

  it("skips same-strategy pairs when requireDifferentStrategy=true", () => {
    const result = computeInternalBatch(
      [
        order("a1", "AAPL", "buy", 100, 150, "strategy_x"),
        order("a2", "AAPL", "sell", 100, 150, "strategy_x"),
      ],
      { requireDifferentStrategy: true },
    );
    expect(result.internalCrossings.length).toBe(0);
    expect(result.externalOrders.every((o) => o.residualQty === o.originalQty)).toBe(true);
  });

  it("crosses cross-strategy with requireDifferentStrategy=true", () => {
    const result = computeInternalBatch(
      [
        order("a1", "AAPL", "buy", 100, 150, "strategy_x"),
        order("a2", "AAPL", "sell", 100, 150, "strategy_y"),
      ],
      { requireDifferentStrategy: true },
    );
    expect(result.internalCrossings.length).toBe(1);
  });
});

describe("computeInternalBatch — minCrossQty threshold", () => {
  it("skips crossings below the minimum quantity threshold", () => {
    const result = computeInternalBatch(
      [order("a1", "AAPL", "buy", 5, 150), order("a2", "AAPL", "sell", 5, 150)],
      { minCrossQty: 10 },
    );
    expect(result.internalCrossings.length).toBe(0);
  });

  it("crosses when quantity meets threshold", () => {
    const result = computeInternalBatch(
      [order("a1", "AAPL", "buy", 20, 150), order("a2", "AAPL", "sell", 20, 150)],
      { minCrossQty: 10 },
    );
    expect(result.internalCrossings.length).toBe(1);
  });
});

describe("computeInternalBatch — summary text", () => {
  it("includes order count + crossings count + external count", () => {
    const result = computeInternalBatch([
      order("a", "AAPL", "buy", 100, 150),
      order("b", "AAPL", "sell", 100, 150),
    ]);
    expect(result.summary).toContain("2 orders");
    expect(result.summary).toContain("1 symbols");
    expect(result.summary).toContain("1 internal crossings");
  });
});
