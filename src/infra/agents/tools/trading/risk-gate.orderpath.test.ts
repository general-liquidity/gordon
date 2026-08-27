/**
 * Order-path wiring for the safety projection and the economic order floor.
 *
 * Every case holds total equity at $10,000, and the process-wide drawdown tracker
 * is reset to that figure before each case. Holding equity constant is not enough
 * on its own: the tracker is a module singleton, so any earlier test file in the
 * run can leave a peak behind that makes these fixtures read as a deep drawdown.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { drawdownTracker } from "../../../../core/risk-management/drawdown-tracker.ts";

import {
  evaluateOrderRisk,
  FEE_FIXED_PER_TRANCHE_ENV,
  FEE_MIN_PER_ORDER_ENV,
  FEE_TOLERANCE_BPS_ENV,
  FEE_TRANCHE_SIZE_ENV,
} from "./risk-gate.ts";
import type { GordonContext } from "../types.ts";
import type { BrokerAdapter } from "../../../broker/types.ts";

const EQUITY_USD = 10_000;
const PRICE_USD = 1_000;

interface StubBalance {
  asset: string;
  total: number;
}

function contextWith(options: { cashUsd: number; holdings?: StubBalance[] }): GordonContext {
  const holdings = options.holdings ?? [];
  const exchange = {
    exchangeId: "stub",
    isSandbox: true,
    getFullAccountDetails: async () => ({
      totalUsdtValue: EQUITY_USD,
      nonZeroBalances: [
        { asset: "USDT", free: options.cashUsd, locked: 0, total: options.cashUsd },
        ...holdings.map((holding) => ({ ...holding, free: holding.total, locked: 0 })),
      ],
    }),
    getBalance: async (asset: string) => (asset === "USDT" ? options.cashUsd : 0),
    getPrice: async () => PRICE_USD,
  };
  return { exchange, broker: null } as unknown as GordonContext;
}

function brokerContextWith(quote: { bidPrice: number; askPrice: number }): GordonContext {
  const broker = {
    brokerId: "alpaca",
    isPaper: true,
    getAccount: async () => ({
      id: "paper-account",
      status: "ACTIVE",
      currency: "USD",
      cash: 6_000,
      buyingPower: 6_000,
      portfolioValue: EQUITY_USD,
      patternDayTrader: false,
      shortingEnabled: true,
      tradingBlocked: false,
    }),
    getPositions: async () => [],
    getLatestQuote: async (symbol: string) => ({
      symbol,
      bidPrice: quote.bidPrice,
      bidSize: 100,
      askPrice: quote.askPrice,
      askSize: 100,
      timestamp: new Date().toISOString(),
    }),
  } as unknown as BrokerAdapter;
  return { exchange: null, broker } as unknown as GordonContext;
}

/** Kernel-approved at $500 on a $10k account with $6k of cash and nothing held. */
const FEASIBLE_ORDER = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  quantity: 0.5,
  price: PRICE_USD,
};

/** $6,000 of BTC against $9,500 of ETH already on the book: gross exceeds 1x equity. */
function oversizedOrderContext(): GordonContext {
  return contextWith({ cashUsd: 6_000, holdings: [{ asset: "ETH", total: 9.5 }] });
}

const OVERSIZED_ORDER = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  quantity: 6,
  price: PRICE_USD,
};

function clearFeeEnv(): void {
  delete process.env[FEE_FIXED_PER_TRANCHE_ENV];
  delete process.env[FEE_TRANCHE_SIZE_ENV];
  delete process.env[FEE_MIN_PER_ORDER_ENV];
  delete process.env[FEE_TOLERANCE_BPS_ENV];
}

afterEach(clearFeeEnv);

beforeEach(() => {
  drawdownTracker.reset(EQUITY_USD);
});

describe("evaluateOrderRisk order path", () => {
  test("an order inside every limit keeps the size it asked for", async () => {
    const result = await evaluateOrderRisk(FEASIBLE_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
    expect(result.quantity).toBe(FEASIBLE_ORDER.quantity);
  });

  // This fixture holds 9.5 ETH against 10,000 equity, so 9,500 of the leverage
  // allowance is already spent and only 500 of new exposure fits. Cutting a
  // 6,000 order to 500 is a 92% reduction, past the adjuster's floor, and past
  // that floor refusing is more honest than silently placing 8% of what was
  // asked for. The order is therefore refused rather than resized.
  //
  // It previously reported approved, because the adjuster did not account for
  // the leverage ceiling at all and the kernel never re-checked what it had
  // produced: the resized order still stood at 1.05x against a 1x limit.
  test("an order the adjuster cannot bring under the leverage ceiling is refused", async () => {
    const result = await evaluateOrderRisk(OVERSIZED_ORDER, oversizedOrderContext());

    expect(result.approved).toBe(false);
    // The refusal names what it could not satisfy rather than failing silently.
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("a resizable order is resized, and the constraint is named to the operator", async () => {
    // 0.6 lots is 600 of exposure against 500 of room: over the ceiling, but a
    // 17% cut, well inside the adjuster's floor.
    const result = await evaluateOrderRisk(
      { ...OVERSIZED_ORDER, quantity: 0.6 },
      oversizedOrderContext(),
    );

    expect(result.approved).toBe(true);
    expect(result.quantity).toBeLessThan(0.6);
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.quantity * PRICE_USD).toBeLessThanOrEqual(500 + 1e-6);
  });

  test("an order below the economic floor is refused with the floor and the shortfall stated", async () => {
    process.env[FEE_FIXED_PER_TRANCHE_ENV] = "2.50";
    process.env[FEE_TRANCHE_SIZE_ENV] = "100";
    process.env[FEE_TOLERANCE_BPS_ENV] = "100";

    const result = await evaluateOrderRisk(
      { ...FEASIBLE_ORDER, quantity: 0.1 },
      contextWith({ cashUsd: 6_000 }),
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("economic floor");
    expect(result.reason).toContain("250.00");
    expect(result.reason).toContain("150.00");
  });

  test("a zero-commission schedule asserts no floor and leaves a small order approved", async () => {
    process.env[FEE_FIXED_PER_TRANCHE_ENV] = "0";
    process.env[FEE_TRANCHE_SIZE_ENV] = "100";

    const result = await evaluateOrderRisk(
      { ...FEASIBLE_ORDER, quantity: 0.1 },
      contextWith({ cashUsd: 6_000 }),
    );

    expect(result.approved).toBe(true);
    expect(result.quantity).toBe(0.1);
  });

  test("an unconfigured fee schedule warns instead of refusing the order", async () => {
    const result = await evaluateOrderRisk(FEASIBLE_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
    expect(result.warnings.join(" | ")).toContain("Economic order floor not evaluated");
  });

  test("no portfolio context keeps the existing fail-closed rejection unchanged", async () => {
    const result = await evaluateOrderRisk(FEASIBLE_ORDER, {
      exchange: null,
      broker: null,
    } as unknown as GordonContext);

    expect(result.approved).toBe(false);
    expect(result.quantity).toBe(FEASIBLE_ORDER.quantity);
    expect(result.reason).toContain("portfolio context unavailable");
  });

  test("a new-symbol market order obtains a reference price before risk evaluation", async () => {
    const result = await evaluateOrderRisk(
      { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.5 },
      contextWith({ cashUsd: 6_000 }),
    );

    expect(result.approved).toBe(true);
    expect(result.quantity).toBe(0.5);
    expect(result.warnings.join(" | ")).not.toContain("Safety projection skipped");
  });

  test("a market order fails closed when its venue cannot provide a price", async () => {
    const ctx = contextWith({ cashUsd: 6_000 });
    (ctx.exchange as unknown as { getPrice: () => Promise<number> }).getPrice = async () =>
      Number.NaN;
    const result = await evaluateOrderRisk(
      { symbol: "NEWUSDT", side: "BUY", type: "MARKET", quantity: 0.5 },
      ctx,
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("no positive reference price");
  });

  test("a broker buy uses the executable ask quote in the common risk gate", async () => {
    const result = await evaluateOrderRisk(
      { symbol: "AAPL", side: "BUY", type: "MARKET", quantity: 5 },
      brokerContextWith({ bidPrice: 99, askPrice: 100 }),
    );

    expect(result.approved).toBe(true);
    expect(result.warnings.join(" | ")).not.toContain("Safety projection skipped");
  });

  test("a broker sell uses the executable bid and fails closed on an invalid quote", async () => {
    const result = await evaluateOrderRisk(
      { symbol: "AAPL", side: "SELL", type: "MARKET", quantity: 5 },
      brokerContextWith({ bidPrice: Number.NaN, askPrice: 100 }),
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("no positive reference price");
  });

  test("the gate never hands back more size than was asked for", async () => {
    const cases = [
      { order: FEASIBLE_ORDER, ctx: () => contextWith({ cashUsd: 6_000 }) },
      { order: OVERSIZED_ORDER, ctx: oversizedOrderContext },
      {
        order: { ...FEASIBLE_ORDER, side: "SELL", quantity: 3 },
        ctx: () => contextWith({ cashUsd: 6_000, holdings: [{ asset: "BTC", total: 3 }] }),
      },
      {
        order: { ...FEASIBLE_ORDER, quantity: 0.001 },
        ctx: () => contextWith({ cashUsd: 6_000 }),
      },
    ];

    for (const { order, ctx } of cases) {
      const result = await evaluateOrderRisk(order, ctx());
      expect(result.quantity).toBeLessThanOrEqual(order.quantity);
      expect(result.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  test("an order the kernel already refuses is never approved by the added layers", async () => {
    // BTC exposure is already at the single-asset cap, so no adjustment exists.
    const ctx = contextWith({ cashUsd: 6_000, holdings: [{ asset: "BTC", total: 3 }] });
    const result = await evaluateOrderRisk({ ...FEASIBLE_ORDER, quantity: 2 }, ctx);

    expect(result.approved).toBe(false);
  });
});

describe("evaluateOrderRisk GORDON_RISK_MODE=paper override", () => {
  afterEach(() => {
    delete process.env.GORDON_RISK_MODE;
  });

  test("applies the paper override on a sandbox venue", async () => {
    process.env.GORDON_RISK_MODE = "paper";
    const result = await evaluateOrderRisk(FEASIBLE_ORDER, contextWith({ cashUsd: 6_000 }));

    expect(result.approved).toBe(true);
    expect(result.reason).toContain("Paper mode");
  });

  test("does not apply the paper override on a live venue", async () => {
    process.env.GORDON_RISK_MODE = "paper";
    const ctx = contextWith({ cashUsd: 6_000 });
    (ctx.exchange as unknown as { isSandbox: boolean }).isSandbox = false;

    const result = await evaluateOrderRisk(FEASIBLE_ORDER, ctx);

    expect(result.reason).not.toContain("Paper mode");
  });
});
