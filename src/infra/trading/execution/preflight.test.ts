import { describe, expect, it } from "bun:test";

import type { GordonContext } from "../../agents/types.ts";
import type { Exchange, OrderParams } from "../../exchange/types.ts";
import { createSafeOrderSubmitter, runExecutionPreflight } from "./preflight.ts";

function mockContext(onPlace?: (order: OrderParams) => void): GordonContext {
  const exchange = {
    exchangeId: "ccxt:binance",
    displayName: "Mock Binance",
    isSandbox: true,
    async getFullAccountDetails() {
      return {
        accountInfo: {
          canTrade: true,
          canWithdraw: false,
          canDeposit: true,
          accountType: "SPOT",
          balances: [],
          updateTime: Date.now(),
        },
        totalUsdtValue: 100_000,
        nonZeroBalances: [],
      };
    },
    async getBalance(asset: string) {
      return asset === "USDT" ? 100_000 : 0;
    },
    async getPrice() {
      return 50_000;
    },
    async placeOrder(order: OrderParams) {
      onPlace?.(order);
      return {
        orderId: "order-1",
        clientOrderId: order.newClientOrderId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: "FILLED",
        price: order.price ?? 0,
        quantity: order.quantity ?? 0,
        executedQty: order.quantity ?? 0,
        cummulativeQuoteQty: 0,
      };
    },
  } as unknown as Exchange;

  return {
    userId: "test-user",
    exchange,
    config: { permissionMode: "ask" },
  } as GordonContext;
}

describe("execution preflight", () => {
  it("fails closed on invalid order shape before reaching exchange", async () => {
    const result = await runExecutionPreflight({
      ctx: mockContext(),
      source: "test.preflight",
      rationale: "testing invalid preflight shape",
      order: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("invalid_order_shape");
      expect(result.reason).toContain("quantity");
    }
  });

  it("routes safe submitter orders through preflight before placeOrder", async () => {
    const placed: OrderParams[] = [];
    const submitOrder = createSafeOrderSubmitter({
      ctx: mockContext((order) => placed.push(order)),
      source: "test.execution.slice",
      rationale: "testing guarded slice submission",
    });

    const order = await submitOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.001,
    });

    expect(order.orderId).toBe("order-1");
    expect(placed).toHaveLength(1);
    expect(placed[0]?.symbol).toBe("BTCUSDT");
  });
});
