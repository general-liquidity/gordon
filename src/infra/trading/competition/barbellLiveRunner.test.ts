import { afterEach, describe, it, expect } from "bun:test";
import { aggregateTargetNotionals, reconcile, BarbellLiveRunner, type Mt5Like, type AlertEvent } from "./barbellLiveRunner.ts";
import { BARBELL_CONFIG, type BarbellDecision } from "./barbellStrategy.ts";
import type { Mt5Account, Mt5Bar, Mt5OrderRequest, Mt5OrderResult, Mt5Position, Mt5Quote } from "../../broker/mt5/bridgeClient.ts";
import type { ContractSpec } from "./liveTrader.ts";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("BarbellLiveRunner — survival circuit breaker", () => {
  const acct = (over: Partial<Mt5Account>): Mt5Account => ({
    login: 1, currency: "USD", balance: 1e6, equity: 1e6, margin: 0, margin_free: 1e6,
    margin_level: 300, profit: 0, leverage: 30, ...over,
  });
  const bars = (): Mt5Bar[] =>
    Array.from({ length: 120 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100 + Math.sin(i / 3), tickVolume: 1, spread: 1, realVolume: 0 }) as Mt5Bar);
  const rvBarsForZ = (lastSpread: number): Record<string, Mt5Bar[]> => {
    const spread: number[] = [];
    for (let i = 0; i < 120; i++) spread.push((i % 2 === 0 ? 1 : -1) * 0.005);
    spread[spread.length - 1] = lastSpread;
    return {
      BTCUSD: spread.map((s, i) => ({ time: i * 900, open: Math.exp(s), high: Math.exp(s), low: Math.exp(s), close: Math.exp(s), tickVolume: 1, spread: 1, realVolume: 0 }) as Mt5Bar),
      ETHUSD: spread.map((_, i) => ({ time: i * 900, open: 1, high: 1, low: 1, close: 1, tickVolume: 1, spread: 1, realVolume: 0 }) as Mt5Bar),
    };
  };

  class FakeClient implements Mt5Like {
    placed: Mt5OrderRequest[] = [];
    cancelled: number[] = [];
    pending: { ticket: number }[] = [];
    constructor(
      private acc: Mt5Account,
      private posList: Mt5Position[],
      private thin: Set<string> = new Set(),
      private barsBySymbol: Record<string, Mt5Bar[]> = {},
    ) {}
    async account(): Promise<Mt5Account> { return this.acc; }
    async positions(): Promise<Mt5Position[]> { return this.posList; }
    async quote(symbol: string): Promise<Mt5Quote> { return quote(symbol, 100); }
    async bars(params: { symbol: string }): Promise<Mt5Bar[]> { return this.thin.has(params.symbol) ? [] : (this.barsBySymbol[params.symbol] ?? bars()); }
    async placeOrder(req: Mt5OrderRequest): Promise<Mt5OrderResult> { this.placed.push(req); return { executed: true, order: 1 }; }
    async orders() { return this.pending as never[]; }
    async cancel(ticket: number): Promise<Mt5OrderResult> { this.cancelled.push(ticket); return { executed: true }; }
  }

  const runnerCfg = {
    symbols: ["BTCUSD", "ETHUSD"],
    contracts: { BTCUSD: spec, ETHUSD: spec } as Record<string, ContractSpec>,
    startingEquity: 1e6,
    barsToDeadline: () => 200,
    phase: () => "post_cut" as const,
    barsLookback: 96,
    timeframe: "M15",
  };

  const ORIGINAL = process.env.GORDON_LIVE_TRADING;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GORDON_LIVE_TRADING;
    else process.env.GORDON_LIVE_TRADING = ORIGINAL;
    delete process.env.GORDON_COMP_FLATTEN;
  });

  it("trips at a low margin level and FLATTENS the open book (targets → 0)", async () => {
    delete process.env.GORDON_LIVE_TRADING; // dry — assert intent via the reconcile orders
    const client = new FakeClient(
      acct({ margin_level: 40, margin: 1e4, equity: 4e5 }), // 40% ≤ 50% breaker, has open margin
      [pos("BTCUSD", "long", 1.0)], // an open position to flatten
    );
    const report = await new BarbellLiveRunner(client, runnerCfg, () => {}).runCycle();

    expect(report.breakerTripped).toBe(true);
    expect(report.marginLevelPct).toBe(40);
    expect(report.decisionReason).toContain("FLATTEN");
    const flatten = report.orders.find((o) => o.symbol === "BTCUSD");
    expect(flatten?.side).toBe("sell"); // sell to close the long
    expect(flatten?.action).toBe("dry");
  });

  it("does not trip when the margin level is healthy", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const client = new FakeClient(acct({ margin_level: 300, margin: 1e4 }), []);
    const report = await new BarbellLiveRunner(client, runnerCfg, () => {}).runCycle();
    expect(report.breakerTripped).toBe(false);
    expect(report.marginLevelPct).toBe(300);
  });

  it("stays idle (no false trip) when there are no open positions, even at margin_level 0", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const client = new FakeClient(acct({ margin_level: 0, margin: 0 }), []);
    const report = await new BarbellLiveRunner(client, runnerCfg, () => {}).runCycle();
    expect(report.breakerTripped).toBe(false); // margin 0 ⇒ no positions ⇒ idle
  });

  it("excludes an instrument whose live feed is empty and logs the exclusion note", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const logs: string[] = [];
    const client = new FakeClient(acct({ margin_level: 300, margin: 0 }), [], new Set(["ETHUSD"]));
    const report = await new BarbellLiveRunner(client, runnerCfg, (m) => logs.push(m)).runCycle();
    expect(report.breakerTripped).toBe(false);
    expect(logs.some((l) => l.includes("Excluded") && l.includes("ETHUSD"))).toBe(true);
  });

  it("fires a CRITICAL alert when the survival breaker trips", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const alerts: AlertEvent[] = [];
    const client = new FakeClient(acct({ margin_level: 40, margin: 1e4, equity: 4e5 }), [pos("BTCUSD", "long", 1.0)]);
    await new BarbellLiveRunner(client, { ...runnerCfg, alert: (a) => alerts.push(a) }, () => {}).runCycle();
    expect(alerts.some((a) => a.level === "critical" && a.event === "SURVIVAL_BREAKER")).toBe(true);
  });

  it("kill-switch (GORDON_COMP_FLATTEN) flattens the book + fires a CRITICAL alert", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    process.env.GORDON_COMP_FLATTEN = "1";
    const alerts: AlertEvent[] = [];
    const client = new FakeClient(acct({ margin_level: 300, margin: 1e4 }), [pos("BTCUSD", "long", 1.0)]);
    const report = await new BarbellLiveRunner(client, { ...runnerCfg, alert: (a) => alerts.push(a) }, () => {}).runCycle();
    expect(report.manualFlatten).toBe(true);
    expect(report.decisionReason).toContain("KILL SWITCH");
    expect(alerts.some((a) => a.event === "KILL_SWITCH")).toBe(true);
    expect(report.orders.find((o) => o.symbol === "BTCUSD")?.side).toBe("sell"); // flatten the long
  });

  it("uses the live board (REAL data) for the standing when wired — not the placeholder model", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const client = new FakeClient(acct({ margin_level: 300, margin: 0 }), []);
    const board = () => ({ returns: [-0.1, 0.0, 0.05, 0.2, -0.3] });
    const report = await new BarbellLiveRunner(client, { ...runnerCfg, board, barsToCut: () => 24 }, () => {}).runCycle();
    expect(report.standing.returnSource).toBe("board");
  });

  it("falls back to the MODEL standing when no board is wired (endgame sleeve stays gated off)", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const client = new FakeClient(acct({ margin_level: 300, margin: 0 }), []);
    const report = await new BarbellLiveRunner(client, { ...runnerCfg, barsToCut: () => 24 }, () => {}).runCycle();
    expect(report.standing.returnSource).toBe("model");
  });

  it("persists equity history to statePath and reloads it on restart", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const statePath = join(tmpdir(), "barbell-persist-test.json");
    rmSync(statePath, { force: true });
    const client = new FakeClient(acct({ margin_level: 300, margin: 0 }), []);
    await new BarbellLiveRunner(client, { ...runnerCfg, statePath }, () => {}).runCycle();
    expect(existsSync(statePath)).toBe(true);
    const saved = JSON.parse(readFileSync(statePath, "utf8")) as { equityHistory: number[] };
    expect(saved.equityHistory.length).toBeGreaterThan(0);
    // a fresh runner with the same statePath restores the history (logged on construct)
    const logs: string[] = [];
    new BarbellLiveRunner(client, { ...runnerCfg, statePath }, (m) => logs.push(m));
    expect(logs.some((l) => l.includes("restored") && l.includes("equity samples"))).toBe(true);
    rmSync(statePath, { force: true });
  });

  it("persists RV hysteresis state so a restart keeps holding through the reversion band", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const statePath = join(tmpdir(), "barbell-rv-state-test.json");
    rmSync(statePath, { force: true });
    const cfg = {
      ...runnerCfg,
      phase: () => "pre_cut" as const,
      statePath,
      barbellConfig: {
        ...BARBELL_CONFIG,
        sleeveFraction: 0,
        core: "rv" as const,
        rvConfig: {
          ...BARBELL_CONFIG.rvConfig,
          clusters: [["BTCUSD", "ETHUSD"]],
          lookback: 48,
          entryZ: 2.0,
          exitZ: 0.5,
          maxPairs: 1,
          minObs: 60,
        },
      },
    };

    await new BarbellLiveRunner(new FakeClient(acct({ margin_level: 300, margin: 0 }), [], new Set(), rvBarsForZ(0.03)), cfg, () => {}).runCycle();
    const saved = JSON.parse(readFileSync(statePath, "utf8")) as { rvState: Array<[string, number]> };
    expect(saved.rvState).toContainEqual(["BTCUSD/ETHUSD", -1]);

    const restarted = await new BarbellLiveRunner(new FakeClient(acct({ margin_level: 300, margin: 0 }), [], new Set(), rvBarsForZ(0.006)), cfg, () => {}).runCycle();
    expect(restarted.orders.some((o) => o.symbol === "BTCUSD" && o.action === "dry")).toBe(true);
    rmSync(statePath, { force: true });
  });

  it("TAKER mode (default) places MARKET orders", async () => {
    process.env.GORDON_LIVE_TRADING = "1";
    const client = new FakeClient(acct({ margin_level: 300, margin: 0 }), []);
    await new BarbellLiveRunner(client, runnerCfg, () => {}).runCycle();
    expect(client.placed.length).toBeGreaterThan(0);
    expect(client.placed.every((r) => r.type === "market")).toBe(true);
  });

  it("MAKER mode rests LIMIT orders (filling:return) when the book is hedged, and cancels prior resting", async () => {
    process.env.GORDON_LIVE_TRADING = "1";
    const client = new FakeClient(acct({ margin_level: 300, margin: 0 }), []);
    client.pending = [{ ticket: 99 }]; // a stale resting limit from a prior cycle
    await new BarbellLiveRunner(client, { ...runnerCfg, execution: () => "maker" as const }, () => {}).runCycle();
    expect(client.placed.length).toBeGreaterThan(0);
    expect(client.placed.every((r) => r.type === "limit")).toBe(true);
    expect(client.placed.every((r) => r.filling === "return")).toBe(true);
    expect(client.cancelled).toContain(99); // re-posts fresh each cycle
  });
});
