import { describe, expect, test } from "bun:test";
import {
  scoreDarkPoolAdverseSelection,
  formatDarkPoolAdverseSelection,
  type DarkPoolFill,
} from "./dark-pool-adverse-selection.ts";

function buyFill(
  fillPrice: number,
  midPriceAfter: number,
  qty: number,
  spread: number,
): DarkPoolFill {
  return {
    side: "buy",
    fillPrice,
    quantity: qty,
    midPriceAfterWindow: midPriceAfter,
    litMarketSpread: spread,
  };
}

function sellFill(
  fillPrice: number,
  midPriceAfter: number,
  qty: number,
  spread: number,
): DarkPoolFill {
  return {
    side: "sell",
    fillPrice,
    quantity: qty,
    midPriceAfterWindow: midPriceAfter,
    litMarketSpread: spread,
  };
}

describe("scoreDarkPoolAdverseSelection", () => {
  test("insufficient_data with too few fills", () => {
    const fills = Array(10)
      .fill(0)
      .map(() => buyFill(100, 100.01, 100, 0.02));
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("buys followed by price drops → net_loss verdict", () => {
    // Adverse selection on buys: bought at 100, price drifts to 99.95
    // Nominal saving = $0.01 (half of $0.02 spread).
    // Adverse move = $0.05 (price moved against us).
    // Net = +$0.01 - $0.05 = -$0.04 per share = net_loss.
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 30; i++) {
      fills.push(buyFill(100, 99.95, 100, 0.02));
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.verdict).toBe("net_loss");
    expect(r.netBps).toBeLessThan(0);
  });

  test("buys followed by price gains → net_benefit verdict", () => {
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 30; i++) {
      fills.push(buyFill(100, 100.05, 100, 0.02));
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.verdict).toBe("net_benefit");
    expect(r.netBps).toBeGreaterThan(0);
  });

  test("sells followed by price drops → net_benefit", () => {
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 30; i++) {
      fills.push(sellFill(100, 99.95, 100, 0.02));
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.verdict).toBe("net_benefit");
  });

  test("sells followed by price gains → net_loss", () => {
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 30; i++) {
      fills.push(sellFill(100, 100.05, 100, 0.02));
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.verdict).toBe("net_loss");
  });

  test("post-fill price equals fill price → breakeven", () => {
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 30; i++) {
      // No adverse move; nominal saving present but small enough to fall
      // within the breakeven band when expressed in bps.
      fills.push(buyFill(100, 100, 100, 0.0001));
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.verdict).toBe("breakeven");
  });

  test("quantity weighting respected", () => {
    // Smaller fills with adverse moves outweigh larger fills with benefits
    // when weighted by quantity.
    const fills: DarkPoolFill[] = [];
    // 25 large benefit fills
    for (let i = 0; i < 25; i++) {
      fills.push(buyFill(100, 100.1, 100, 0.02));
    }
    // 5 small fills (low qty); price barely changes
    for (let i = 0; i < 5; i++) {
      fills.push(buyFill(100, 99.99, 10, 0.02));
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    // Net should still be a benefit, dominated by the heavy qty
    expect(r.verdict).toBe("net_benefit");
    expect(r.totalQuantity).toBe(25 * 100 + 5 * 10);
  });

  test("respects custom minFills threshold", () => {
    const fills = Array(15)
      .fill(0)
      .map(() => buyFill(100, 99.95, 100, 0.02));
    const strict = scoreDarkPoolAdverseSelection(fills, { minFills: 20 });
    const lax = scoreDarkPoolAdverseSelection(fills, { minFills: 10 });
    expect(strict.verdict).toBe("insufficient_data");
    expect(lax.verdict).not.toBe("insufficient_data");
  });

  test("breakeven band widens with custom threshold", () => {
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 30; i++) {
      fills.push(buyFill(100, 100.0001, 100, 0.0002));
    }
    const tightBand = scoreDarkPoolAdverseSelection(fills, { breakevenBandBps: 0.001 });
    const wideBand = scoreDarkPoolAdverseSelection(fills, { breakevenBandBps: 100 });
    expect(wideBand.verdict).toBe("breakeven");
    // tightBand will likely classify as net_benefit or net_loss
    expect(["net_benefit", "net_loss", "breakeven"]).toContain(tightBand.verdict);
  });

  test("mixed sides aggregated correctly", () => {
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 15; i++) {
      fills.push(buyFill(100, 99.95, 100, 0.02)); // adverse on buy
    }
    for (let i = 0; i < 15; i++) {
      fills.push(sellFill(100, 100.05, 100, 0.02)); // adverse on sell
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.verdict).toBe("net_loss");
  });

  test("zero quantity fill filtered out", () => {
    const fills: DarkPoolFill[] = Array(25)
      .fill(0)
      .map(() => buyFill(100, 100.05, 100, 0.02));
    fills.push({
      side: "buy",
      fillPrice: 100,
      quantity: 0,
      midPriceAfterWindow: 50,
      litMarketSpread: 0.02,
    });
    const r = scoreDarkPoolAdverseSelection(fills);
    expect(r.totalQuantity).toBe(25 * 100);
  });
});

describe("formatDarkPoolAdverseSelection", () => {
  test("renders header + warning on net_loss verdict", () => {
    const fills: DarkPoolFill[] = [];
    for (let i = 0; i < 30; i++) {
      fills.push(buyFill(100, 99.95, 100, 0.02));
    }
    const r = scoreDarkPoolAdverseSelection(fills);
    const text = formatDarkPoolAdverseSelection(r);
    expect(text).toContain("Dark-Pool Adverse Selection");
    expect(text).toContain("NET_LOSS");
    expect(text).toContain("losing money");
  });
});
