import { describe, it, expect } from "bun:test";
import { aggregateTargetNotionals, reconcile } from "./barbellLiveRunner.ts";
import type { BarbellDecision } from "./barbellStrategy.ts";
import type { Mt5Position, Mt5Quote } from "../../broker/mt5/bridgeClient.ts";
import type { ContractSpec } from "./liveTrader.ts";

function decision(over: Partial<BarbellDecision>): BarbellDecision {
  return {
    core: [],
    sleeve: null,
    standing: { percentile: 0.5, estimatedRank: 250, stance: "neutral", reason: "", clearsCut: true },
    ringFence: { totalEquity: 1e6, coreEquity: 9.2e5, sleeveReserve: 8e4, sleeveDeployed: 0, sleevePnL: 0, redLineEquity: 5e5 },
    reason: "",
    ...over,
  };
}
const pair = (symbolA: string, symbolB: string, sideA: "buy" | "sell", nA: number, sideB: "buy" | "sell", nB: number) => ({
  symbolA, symbolB, sideA, sideB, notionalA: nA, notionalB: nB, allocation: 1, regime: "ACTIVE",
});
const quote = (symbol: string, mid: number): Mt5Quote =>
  ({ symbol, bid: mid * 0.9999, ask: mid * 1.0001, last: mid, time: 0, live: true }) as Mt5Quote;
const pos = (symbol: string, side: "long" | "short", volume: number): Mt5Position =>
  ({ ticket: 1, symbol, type: side === "long" ? 0 : 1, sideLabel: side, volume, price_open: 1, price_current: 1, profit: 0, sl: 0, tp: 0 });
const spec: ContractSpec = { volume_min: 0.01, volume_step: 0.01, contractSize: 1 };

describe("aggregateTargetNotionals", () => {
  it("a single dollar-neutral pair → +notional on the long leg, −notional on the short leg", () => {
    const t = aggregateTargetNotionals(decision({ core: [pair("BTCUSD", "ETHUSD", "buy", 50_000, "sell", 50_000)] }));
    expect(t.BTCUSD).toBe(50_000);
    expect(t.ETHUSD).toBe(-50_000);
  });

  it("nets a symbol that appears in two pairs with opposite signs", () => {
    const t = aggregateTargetNotionals(decision({
      core: [pair("BTCUSD", "ETHUSD", "buy", 40_000, "sell", 40_000), pair("SOLUSD", "BTCUSD", "buy", 30_000, "sell", 30_000)],
    }));
    expect(t.BTCUSD).toBe(40_000 - 30_000); // long in pair 1, short in pair 2 → nets to +10k
    expect(t.ETHUSD).toBe(-40_000);
    expect(t.SOLUSD).toBe(30_000);
  });

  it("adds the sleeve's directional notional", () => {
    const t = aggregateTargetNotionals(decision({ sleeve: { symbol: "SOLUSD", side: "buy", notional: 200_000, leverage: 5, margin: 40_000, reason: "" } }));
    expect(t.SOLUSD).toBe(200_000);
  });
});

describe("reconcile", () => {
  const contracts = { BTCUSD: spec, ETHUSD: spec };

  it("opens the delta from flat to target", () => {
    const orders = reconcile({ BTCUSD: 50_000 }, [], { BTCUSD: quote("BTCUSD", 50_000) }, contracts, ["BTCUSD"]);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.side).toBe("buy");
    expect(orders[0]!.lots).toBeCloseTo(1.0, 6); // 50000 notional / 50000 price / 1 contractSize
  });

  it("is IDEMPOTENT — already at target → no order", () => {
    const orders = reconcile({ BTCUSD: 50_000 }, [pos("BTCUSD", "long", 1.0)], { BTCUSD: quote("BTCUSD", 50_000) }, contracts, ["BTCUSD"]);
    expect(orders).toHaveLength(0);
  });

  it("flattens a symbol with no target (closes the existing position)", () => {
    const orders = reconcile({}, [pos("BTCUSD", "long", 1.0)], { BTCUSD: quote("BTCUSD", 50_000) }, contracts, ["BTCUSD"]);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.side).toBe("sell"); // sell to close the long
    expect(orders[0]!.lots).toBeCloseTo(1.0, 6);
  });

  it("flips a short to the target long (delta spans zero)", () => {
    const orders = reconcile({ BTCUSD: 50_000 }, [pos("BTCUSD", "short", 1.0)], { BTCUSD: quote("BTCUSD", 50_000) }, contracts, ["BTCUSD"]);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.side).toBe("buy");
    expect(orders[0]!.lots).toBeCloseTo(2.0, 6); // −1 → +1 = buy 2 lots
  });

  it("reduces an oversized position toward target", () => {
    const orders = reconcile({ BTCUSD: 50_000 }, [pos("BTCUSD", "long", 3.0)], { BTCUSD: quote("BTCUSD", 50_000) }, contracts, ["BTCUSD"]);
    expect(orders[0]!.side).toBe("sell");
    expect(orders[0]!.lots).toBeCloseTo(2.0, 6); // 3 → 1 = sell 2
  });
});
