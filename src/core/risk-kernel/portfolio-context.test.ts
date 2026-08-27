import { describe, expect, it } from "bun:test";

import type { Exchange } from "../../infra/exchange/types.ts";
import { PortfolioContextBuilder } from "./portfolio-context.ts";

function exchange(overrides: Record<string, unknown> = {}): Exchange {
  return {
    exchangeId: "ccxt:test",
    getFullAccountDetails: async () => ({
      accountInfo: { canTrade: true, canWithdraw: false, canDeposit: false, balances: [] },
      totalUsdtValue: 10_500,
      nonZeroBalances: [
        { asset: "USDT", free: 9_000, locked: 500, total: 9_500 },
        { asset: "BTC", free: 0.01, locked: 0, total: 0.01 },
      ],
    }),
    getPrice: async () => 100_000,
    ...overrides,
  } as unknown as Exchange;
}

describe("PortfolioContextBuilder live snapshots", () => {
  it("uses the coherent account snapshot for free stable cash", async () => {
    const adapter = exchange({
      getBalance: async () => {
        throw new Error("must not issue a second balance read");
      },
    });

    const context = await new PortfolioContextBuilder().buildFromExchange(adapter);

    expect(context.availableBalance).toBe(9_000);
    expect(context.openPositions).toHaveLength(1);
    expect(context.openPositions[0]?.symbol).toBe("BTCUSDT");
  });

  it("refuses to omit a positive balance when its mark cannot be obtained", async () => {
    const adapter = exchange({ getPrice: async () => Promise.reject(new Error("no mark")) });

    await expect(new PortfolioContextBuilder().buildFromExchange(adapter)).rejects.toThrow(
      "unpriced positive balances",
    );
  });
});
