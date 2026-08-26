/**
 * Live-consent gate on the discovery order tools. Both reached the venue with
 * only a kill-switch + permission-mode check before this gate.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSENT_PATH_ENV } from "../../../safety/consent.ts";
import { placeBracketOrderTool, placeMarketOrderTool } from "./discovery.ts";

const consentPath = join(tmpdir(), `gordon-consent-discovery-${process.pid}-${Date.now()}.json`);
let previousConsentPath: string | undefined;

beforeAll(() => {
  previousConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
  if (existsSync(consentPath)) rmSync(consentPath);
});

afterAll(() => {
  if (previousConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = previousConsentPath;
});

function makeExecContext(placed: string[], isSandbox: boolean) {
  const exchange = {
    exchangeId: "binance",
    isSandbox,
    getPrice: async () => 100,
    getBalance: async () => 100_000,
    getOpenOrders: async () => [],
    getFullAccountDetails: async () => ({ totalUsdtValue: 100_000, nonZeroBalances: [] }),
    placeOrder: async (params: { symbol: string }) => {
      placed.push(params.symbol);
      return {
        orderId: "order-1",
        symbol: params.symbol,
        side: "BUY",
        type: "MARKET",
        status: "FILLED",
        price: 100,
        quantity: 1,
        executedQty: 1,
        cummulativeQuoteQty: 100,
      };
    },
  };
  const values: Record<string, unknown> = { exchange, config: { permissionMode: "auto" } };
  return { requestContext: { get: (key: string) => values[key] } } as never;
}

describe("discovery order tools live-consent gate", () => {
  it("place_bracket_order refuses on a live venue without consent", async () => {
    const placed: string[] = [];
    const res = (await placeBracketOrderTool.execute!(
      { symbol: "BTCUSDT", side: "BUY", quantity: 0.01, stopLossPrice: 90, takeProfitPrice: 120 } as never,
      makeExecContext(placed, false),
    )) as { error?: string };

    expect(res.error).toMatch(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });

  it("place_market_order refuses on a live venue without consent", async () => {
    const placed: string[] = [];
    const res = (await placeMarketOrderTool.execute!(
      { symbol: "BTCUSDT", side: "BUY", quantity: 0.01 } as never,
      makeExecContext(placed, false),
    )) as { error?: string };

    expect(res.error).toMatch(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });
});
