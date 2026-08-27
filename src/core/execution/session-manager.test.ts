/**
 * The execution algorithms used to default `submitOrder` to a raw
 * `exchange.placeOrder`, which bypassed the consent / preflight path for any
 * caller that omitted the submitter. The submitter is now required, so every
 * child slice goes through whatever safe submitter the caller supplies.
 */

import { describe, expect, it } from "bun:test";
import type { Exchange } from "../../infra/exchange/types.ts";
import type { ExecutionIntent } from "./algorithms/types.ts";
import { ExecutionSessionManager } from "./session-manager.ts";

function makeExchange(rawPlacements: string[]): Exchange {
  return {
    exchangeId: "binance",
    isSandbox: true,
    getPrice: async () => 100,
    placeOrder: async (params: { symbol: string }) => {
      rawPlacements.push(params.symbol);
      throw new Error("raw placeOrder must never be reached by an execution algorithm");
    },
  } as unknown as Exchange;
}

const intent: ExecutionIntent = {
  algorithm: "TWAP",
  symbol: "BTCUSDT",
  side: "BUY",
  totalQuantity: 0.03,
  config: { slices: 3, durationMs: 60_000 },
} as ExecutionIntent;

describe("ExecutionSessionManager submitter routing", () => {
  it("routes slices through the supplied submitter, never the raw exchange", async () => {
    const rawPlacements: string[] = [];
    const submitted: string[] = [];
    const manager = ExecutionSessionManager.getInstance();

    const session = await manager.startSession(
      intent,
      makeExchange(rawPlacements),
      async (params) => {
        submitted.push(params.symbol);
        return {
          orderId: `slice-${submitted.length}`,
          symbol: params.symbol,
          side: "BUY",
          type: "MARKET",
          status: "FILLED",
          price: 100,
          quantity: params.quantity ?? 0,
          executedQty: params.quantity ?? 0,
          cummulativeQuoteQty: (params.quantity ?? 0) * 100,
        } as never;
      },
    );

    await manager.cancelSession(session.sessionId);

    expect(submitted.length).toBeGreaterThan(0);
    expect(rawPlacements).toEqual([]);
  });

  it("does not fall back to the raw exchange when a caller omits the submitter", async () => {
    const rawPlacements: string[] = [];
    const manager = ExecutionSessionManager.getInstance();

    const start = manager.startSession as unknown as (
      intent: ExecutionIntent,
      exchange: Exchange,
    ) => Promise<{ sessionId: string }>;
    const session = await start.call(manager, intent, makeExchange(rawPlacements));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await manager.cancelSession(session.sessionId);

    expect(rawPlacements).toEqual([]);
  });
});
