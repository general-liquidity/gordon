import { afterEach, describe, expect, test } from "bun:test";
import { BrokerFactory } from "../factory.ts";
import type { BrokerAdapter, BrokerCredentials, BrokerId } from "../types.ts";
import { installMockBrokerApi } from "../testing/mock-api.ts";

const BROKER_CASES: BrokerId[] = [
  "alpaca",
  "webull",
  "schwab",
  "tradier",
  "tradestation",
  "tastytrade",
  "etrade",
  "ibkr",
];

function createCredentials(brokerId: BrokerId): BrokerCredentials {
  return {
    apiKey: `key-${brokerId}`,
    apiSecret: `secret-${brokerId}`,
    accountId: brokerId === "webull" ? "WB-ACC-1" : undefined,
    paper: true,
    baseUrl: `https://${brokerId}.mock`,
    dataBaseUrl: `https://${brokerId}.mock`,
  };
}

describe("broker conformance matrix", () => {
  afterEach(() => {
    BrokerFactory.clearCache();
  });

  for (const brokerId of BROKER_CASES) {
    test(`${brokerId}: account sync + order lifecycle + error paths`, async () => {
      const mock = installMockBrokerApi(brokerId);
      let adapter: BrokerAdapter | undefined;
      try {
        adapter = BrokerFactory.create(brokerId, createCredentials(brokerId));

        await expect(adapter.testConnection()).resolves.toBe(true);

        const account = await adapter.getAccount();
        expect(account.currency).toBe("USD");
        expect(account.buyingPower).toBeGreaterThan(0);

        const positions = await adapter.getPositions();
        expect(positions.length).toBeGreaterThan(0);
        expect(positions[0]?.symbol).toBe("AAPL");

        const placedOrder = await adapter.placeOrder({
          symbol: "AAPL",
          side: "buy",
          type: "market",
          timeInForce: "day",
          qty: 1,
        });
        expect(placedOrder.symbol).toBe("AAPL");

        const reconciled = await adapter.getOrder(placedOrder.id || "order-1");
        expect(reconciled.id.length).toBeGreaterThan(0);
        expect(reconciled.symbol).toBe("AAPL");
        expect(reconciled.filledQty).toBeGreaterThanOrEqual(0);

        await expect(adapter.cancelOrder(placedOrder.id || "order-1")).resolves.toBeUndefined();
        await expect(adapter.cancelAllOrders()).resolves.toBeUndefined();

        const quote = await adapter.getLatestQuote("AAPL");
        expect(quote.symbol).toBe("AAPL");
        expect(quote.askPrice).toBeGreaterThan(0);
        expect(quote.bidPrice).toBeGreaterThan(0);

        await expect(adapter.placeOrder({
          symbol: "AAPL",
          side: "buy",
          type: "market",
          timeInForce: "day",
        })).rejects.toThrow("qty or notional");

        await expect(adapter.getLatestQuote("UNKNOWN")).rejects.toThrow();

        expect(mock.getTotalCalls()).toBeGreaterThan(0);
      } finally {
        mock.restore();
      }
    });
  }
});
