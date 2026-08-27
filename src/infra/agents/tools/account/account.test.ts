import { describe, expect, it } from "bun:test";
import { getAccountDetailsTool } from "./account.ts";

function execContext(exchange: Record<string, unknown>) {
  const values: Record<string, unknown> = { exchange };
  return { requestContext: { get: (key: string) => values[key] } } as never;
}

function accountDetails() {
  return {
    accountInfo: {
      canTrade: true,
      canWithdraw: false,
      canDeposit: true,
      accountType: "SPOT",
      balances: [],
      updateTime: Date.parse("2026-08-26T12:00:00.000Z"),
    },
    totalUsdtValue: 12_345,
    nonZeroBalances: [{ asset: "BTC", free: 0.1, locked: 0.02, total: 0.12 }],
  };
}

describe("get_account_details", () => {
  it("honors every history exclusion and still returns the venue account snapshot", async () => {
    const calls: string[] = [];
    const exchange = {
      displayName: "Test Venue",
      getFullAccountDetails: async () => {
        calls.push("details");
        return accountDetails();
      },
      getTradeHistory: async () => {
        calls.push("trades");
        return [];
      },
      getDepositHistory: async () => {
        calls.push("deposits");
        return [];
      },
      getWithdrawalHistory: async () => {
        calls.push("withdrawals");
        return [];
      },
      getEarnPositions: async () => {
        calls.push("earn");
        return [];
      },
    };

    const result = (await getAccountDetailsTool.execute!(
      {
        includeTradeHistory: false,
        includeDepositHistory: false,
        includeWithdrawalHistory: false,
        includeEarnPositions: false,
      },
      execContext(exchange),
    )) as Record<string, unknown>;

    expect(calls).toEqual(["details"]);
    expect(result.totalValue).toBe(12_345);
    expect(result.accountUpdatedAt).toBe("2026-08-26T12:00:00.000Z");
    expect(result.balances).toEqual([{ asset: "BTC", free: 0.1, locked: 0.02, total: 0.12 }]);
    expect(result.recentTrades).toBeUndefined();
    expect(result.deposits).toBeUndefined();
    expect(result.withdrawals).toBeUndefined();
    expect(result.earnPositions).toBeUndefined();
    expect(result.summary).toEqual({
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalRecentTrades: 0,
      earnPositionsCount: 0,
    });
  });

  it("maps requested histories independently and reports a partial venue failure", async () => {
    const exchange = {
      displayName: "Test Venue",
      getFullAccountDetails: async () => accountDetails(),
      getTradeHistory: async (symbol: string | undefined, limit: number) => {
        expect(symbol).toBeUndefined();
        expect(limit).toBe(100);
        return [
          {
            id: "trade-1",
            orderId: "order-1",
            symbol: "BTC/USDT",
            side: "BUY",
            price: 100,
            quantity: 2,
            commission: 0.1,
            commissionAsset: "USDT",
            time: Date.parse("2026-08-26T12:01:00.000Z"),
            isMaker: true,
          },
        ];
      },
      getDepositHistory: async () => {
        throw new Error("deposit endpoint disabled");
      },
      getWithdrawalHistory: async () => [
        {
          coin: "USDT",
          amount: 20,
          transactionFee: 1,
          network: "TRX",
          status: "COMPLETE",
          address: "destination",
          applyTime: Date.parse("2026-08-26T12:02:00.000Z"),
          completeTime: null,
        },
      ],
      getEarnPositions: async () => [
        {
          asset: "USDT",
          amount: 50,
          apy: 0.04,
          productName: "Flexible",
          canRedeem: true,
        },
      ],
    };

    const result = (await getAccountDetailsTool.execute!(
      {
        includeTradeHistory: true,
        includeDepositHistory: true,
        includeWithdrawalHistory: true,
        includeEarnPositions: true,
      },
      execContext(exchange),
    )) as any;

    expect(result.recentTrades).toEqual([
      {
        symbol: "BTC/USDT",
        side: "BUY",
        price: 100,
        quantity: 2,
        quoteQty: 200,
        commission: "0.1 USDT",
        time: "2026-08-26T12:01:00.000Z",
        isMaker: true,
      },
    ]);
    expect(result.deposits).toBeUndefined();
    expect(result.withdrawals).toHaveLength(1);
    expect(result.earnPositions).toEqual([
      {
        asset: "USDT",
        totalAmount: 50,
        freeAmount: 50,
        lockedAmount: 0,
        apy: "0.04",
        productName: "Flexible",
      },
    ]);
    expect(result.warnings).toEqual(["Deposit history unavailable: deposit endpoint disabled"]);
    expect(result.summary).toEqual({
      totalDeposits: 0,
      totalWithdrawals: 1,
      totalRecentTrades: 1,
      earnPositionsCount: 1,
    });
  });
});
