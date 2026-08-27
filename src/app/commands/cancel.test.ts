import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONSENT_PATH_ENV, recordLiveConsent } from "../../infra/safety/consent.ts";
import { handleCancelCommand } from "./cancel.ts";

const consentPath = join(
  tmpdir(),
  `gordon-command-cancel-consent-${process.pid}-${Date.now()}.json`,
);
let priorConsentPath: string | undefined;

beforeAll(() => {
  priorConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
  if (existsSync(consentPath)) rmSync(consentPath);
});

afterAll(() => {
  if (existsSync(consentPath)) rmSync(consentPath);
  if (priorConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = priorConsentPath;
});

beforeEach(() => {
  if (existsSync(consentPath)) rmSync(consentPath);
});

function runtime(
  isSandbox: boolean,
  orders = [
    {
      orderId: "open-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      executedQty: 0,
    },
  ],
  balances: Array<{ asset: string; total: number }> = [],
  failInspection = false,
) {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      getState: () => ({
        session: {
          exchange: {
            exchangeId: "binance",
            isSandbox,
            getOpenOrders: async () => orders,
            getFullAccountDetails: async () => {
              if (failInspection) throw new Error("inspection must not run");
              return { accountInfo: { accountType: "SPOT" }, nonZeroBalances: balances };
            },
            cancelOrder: async () => {
              calls.push("cancel");
            },
            cancelAllOrders: async () => {
              calls.push("cancel-all");
              return orders;
            },
          },
        },
      }),
    },
  };
}

describe("/cancel live-consent policy", () => {
  it("allows cancellation of a live entry order without consent", async () => {
    const fixture = runtime(false);
    const result = await handleCancelCommand("all", fixture.runtime);

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    expect(fixture.calls).toEqual(["cancel"]);
  });

  it("retains a protective exit when live consent is absent", async () => {
    const fixture = runtime(
      false,
      [
        {
          orderId: "stop-1",
          symbol: "BTCUSDT",
          side: "SELL",
          type: "STOP_LOSS",
          quantity: 1,
          executedQty: 0,
        },
      ],
      [{ asset: "BTC", total: 1 }],
    );
    const result = await handleCancelCommand("all", fixture.runtime);

    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.details[0]?.error).toMatch(/live.*ARM|ARM.*live/i);
    expect(fixture.calls).toEqual([]);
  });

  it("allows the same cancellation on a sandbox venue", async () => {
    const fixture = runtime(true, undefined, [], true);
    const result = await handleCancelCommand("all", fixture.runtime);

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    expect(fixture.calls).toEqual(["cancel-all"]);
  });

  it("uses bulk cancellation with valid live consent without inspecting account metadata", async () => {
    recordLiveConsent();
    const fixture = runtime(false, undefined, [], true);

    const result = await handleCancelCommand("all", fixture.runtime);

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    expect(fixture.calls).toEqual(["cancel-all"]);
  });

  it("resolves a short numeric order ID before treating the target as a symbol", async () => {
    const fixture = runtime(false, [
      {
        orderId: "123",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
    ]);

    const result = await handleCancelCommand("123", fixture.runtime);

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    expect(fixture.calls).toEqual(["cancel"]);
  });

  it("accepts a long non-USDT symbol after exact ID resolution", async () => {
    const fixture = runtime(false, [
      {
        orderId: "order-1",
        symbol: "BTCUSD_PERP",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
    ]);

    const result = await handleCancelCommand("BTCUSD_PERP", fixture.runtime);

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    expect(fixture.calls).toEqual(["cancel"]);
  });

  it("preserves an earlier cancellation when later metadata inspection fails", async () => {
    const calls: string[] = [];
    const orders = [
      {
        orderId: "first",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
      {
        orderId: "second",
        symbol: "ETHUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
    ];
    const runtimeFixture = {
      getState: () => ({
        session: {
          exchange: {
            isSandbox: false,
            getOpenOrders: async () => orders,
            getFullAccountDetails: async (symbol?: string) => {
              if (symbol === "ETHUSDT") throw new Error("metadata offline");
              return { accountInfo: { accountType: "SPOT" }, nonZeroBalances: [] };
            },
            getMarketType: async (symbol: string) => {
              if (symbol === "ETHUSDT") throw new Error("metadata offline");
              return "spot";
            },
            cancelOrder: async (_symbol: string, orderId: string) => calls.push(orderId),
          },
        },
      }),
    };

    const result = await handleCancelCommand("all", runtimeFixture);

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(1);
    expect(calls).toEqual(["first"]);
    expect(result.details[1]?.error).toContain("classified as unknown");
  });

  it("counts an outer runtime failure as the failed detail it returns", async () => {
    const result = await handleCancelCommand("all", {
      getState: () => {
        throw new Error("runtime state unavailable");
      },
    });

    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]?.error).toContain("runtime state unavailable");
  });
});
