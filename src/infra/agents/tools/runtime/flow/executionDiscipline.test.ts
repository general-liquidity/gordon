import { describe, it, expect } from "bun:test";
import {
  crossInternalBatchTool,
  checkAuctionWindowTool,
  executionDisciplineTools,
} from "./executionDiscipline.ts";

interface BatchResult {
  internalCrossings: Array<{ symbol: string; qty: number; clearingPrice: number; buyOrderId: string; sellOrderId: string }>;
  externalOrders: Array<{ orderId: string; residualQty: number }>;
  totalCrossedQty: number;
  totalExternalQty: number;
  summary: string;
}

interface AuctionResult {
  shouldDefer: boolean;
  reason: string;
  nextAuctionAt: string | null;
  secondsUntilNextAuction: number | null;
  estimatedSavingsBps?: number;
  knownAuctionWindows: Array<{ kind: string }>;
}

describe("crossInternalBatchTool — shape", () => {
  it("registers under id 'cross_internal_batch'", () => {
    expect(crossInternalBatchTool.id).toBe("cross_internal_batch");
  });

  it("aggregation export contains both tools", () => {
    expect(executionDisciplineTools.cross_internal_batch).toBe(crossInternalBatchTool);
    expect(executionDisciplineTools.check_auction_window).toBe(checkAuctionWindowTool);
  });
});

describe("crossInternalBatchTool — execution", () => {
  it("crosses an equal-quantity buy + sell pair", async () => {
    const result = (await crossInternalBatchTool.execute!(
      {
        orders: [
          { orderId: "b1", symbol: "AAPL", side: "buy", qty: 100, referencePrice: 150 },
          { orderId: "s1", symbol: "AAPL", side: "sell", qty: 100, referencePrice: 152 },
        ],
        requireDifferentStrategy: false,
      },
      {} as never,
    )) as BatchResult;
    expect(result.internalCrossings.length).toBe(1);
    expect(result.internalCrossings[0]!.qty).toBe(100);
    expect(result.internalCrossings[0]!.clearingPrice).toBe(151);
    expect(result.totalCrossedQty).toBe(100);
  });

  it("returns external residuals when only one side present", async () => {
    const result = (await crossInternalBatchTool.execute!(
      {
        orders: [
          { orderId: "b1", symbol: "AAPL", side: "buy", qty: 100, referencePrice: 150 },
          { orderId: "b2", symbol: "MSFT", side: "buy", qty: 50, referencePrice: 400 },
        ],
        requireDifferentStrategy: false,
      },
      {} as never,
    )) as BatchResult;
    expect(result.internalCrossings.length).toBe(0);
    expect(result.totalCrossedQty).toBe(0);
    expect(result.totalExternalQty).toBe(150);
  });

  it("populates summary text", async () => {
    const result = (await crossInternalBatchTool.execute!(
      {
        orders: [
          { orderId: "b1", symbol: "AAPL", side: "buy", qty: 50, referencePrice: 150 },
          { orderId: "s1", symbol: "AAPL", side: "sell", qty: 50, referencePrice: 150 },
        ],
        requireDifferentStrategy: false,
      },
      {} as never,
    )) as BatchResult;
    expect(result.summary).toContain("2 orders");
  });
});

describe("checkAuctionWindowTool — shape", () => {
  it("registers under id 'check_auction_window'", () => {
    expect(checkAuctionWindowTool.id).toBe("check_auction_window");
  });
});

describe("checkAuctionWindowTool — execution", () => {
  it("returns shouldDefer=false for urgent override", async () => {
    const result = (await checkAuctionWindowTool.execute!(
      {
        venue: "nasdaq",
        forceImmediate: true,
        maxDeferralSeconds: 1800,
        estimatedSavingsBps: 1,
      },
      {} as never,
    )) as AuctionResult;
    expect(result.shouldDefer).toBe(false);
    expect(result.reason).toContain("urgent");
  });

  it("returns shouldDefer=false for unknown venue", async () => {
    const result = (await checkAuctionWindowTool.execute!(
      {
        venue: "madeup_venue",
        forceImmediate: false,
        maxDeferralSeconds: 1800,
        estimatedSavingsBps: 1,
      },
      {} as never,
    )) as AuctionResult;
    expect(result.shouldDefer).toBe(false);
    expect(result.knownAuctionWindows).toEqual([]);
  });

  it("returns shouldDefer=true for cow_swap (always near-future batch)", async () => {
    const result = (await checkAuctionWindowTool.execute!(
      {
        venue: "cow_swap",
        forceImmediate: false,
        maxDeferralSeconds: 1800,
        estimatedSavingsBps: 1,
      },
      {} as never,
    )) as AuctionResult;
    expect(result.shouldDefer).toBe(true);
    expect(result.knownAuctionWindows.length).toBe(1);
    expect(result.knownAuctionWindows[0]!.kind).toBe("batch_continuous");
  });

  it("surfaces known auction windows for nasdaq", async () => {
    const result = (await checkAuctionWindowTool.execute!(
      {
        venue: "nasdaq",
        forceImmediate: false,
        maxDeferralSeconds: 1800,
        estimatedSavingsBps: 1,
      },
      {} as never,
    )) as AuctionResult;
    expect(result.knownAuctionWindows.length).toBe(2);
    const kinds = result.knownAuctionWindows.map((w) => w.kind).sort();
    expect(kinds).toEqual(["closing_cross", "opening_cross"]);
  });
});
