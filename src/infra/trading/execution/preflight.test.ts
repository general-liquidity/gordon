import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GordonContext } from "../../agents/types.ts";
import type { Exchange, OrderParams } from "../../exchange/types.ts";
import { resetAllKillSwitches } from "../../safety/killSwitches.ts";
import { CONSENT_PATH_ENV, recordLiveConsent } from "../../safety/consent.ts";
import { assertLiveConsent, createSafeOrderSubmitter, runExecutionPreflight } from "./preflight.ts";

// Kill-switch state is process-global and persisted; a switch tripped by
// another test file would otherwise fail these preflight assertions.
beforeEach(() => {
  resetAllKillSwitches("test isolation reset");
});

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

describe("execution preflight — live consent gate", () => {
  let dir: string;
  const order: OrderParams = { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.001 };

  function liveContext(): GordonContext {
    const ctx = mockContext();
    (ctx.exchange as unknown as { isSandbox: boolean }).isSandbox = false;
    return ctx;
  }

  beforeEach(() => {
    resetAllKillSwitches("test isolation reset");
    dir = mkdtempSync(join(tmpdir(), "gordon-preflight-consent-"));
    process.env[CONSENT_PATH_ENV] = join(dir, "consent.json");
  });

  afterEach(() => {
    delete process.env[CONSENT_PATH_ENV];
    rmSync(dir, { recursive: true, force: true });
  });

  it("blocks a live order until consent is recorded", async () => {
    const result = await runExecutionPreflight({
      ctx: liveContext(),
      source: "test.preflight.live",
      rationale: "testing live consent gate blocks",
      order,
      skipRiskGate: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("live_consent_required");
  });

  it("allows a live order after consent is recorded", async () => {
    recordLiveConsent(process.env);
    const result = await runExecutionPreflight({
      ctx: liveContext(),
      source: "test.preflight.live",
      rationale: "testing live consent gate passes",
      order,
      skipRiskGate: true,
    });
    expect(result.ok).toBe(true);
  });
});

describe("assertLiveConsent", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-assert-consent-"));
    process.env[CONSENT_PATH_ENV] = join(dir, "consent.json");
  });

  afterEach(() => {
    delete process.env[CONSENT_PATH_ENV];
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws on a live venue without consent", () => {
    expect(() => assertLiveConsent({ isSandbox: false }, "test.assert")).toThrow(
      /have not yet acknowledged live trading/,
    );
  });

  it("treats an absent venue handle as live", () => {
    expect(() => assertLiveConsent(undefined, "test.assert")).toThrow(
      /have not yet acknowledged live trading/,
    );
  });

  it("passes for a sandbox exchange and a paper broker", () => {
    expect(() => assertLiveConsent({ isSandbox: true }, "test.assert")).not.toThrow();
    expect(() => assertLiveConsent({ isPaper: true }, "test.assert")).not.toThrow();
  });

  it("passes on a live venue once consent is recorded", () => {
    recordLiveConsent(process.env);
    expect(() => assertLiveConsent({ isSandbox: false }, "test.assert")).not.toThrow();
  });
});
