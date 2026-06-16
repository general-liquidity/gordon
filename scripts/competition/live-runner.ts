#!/usr/bin/env bun
/**
 * Competition LIVE runner — wires the real MT5 bridge client into the
 * `CompetitionLiveTrader` loop with a trivial inline mean-reversion stub signal.
 *
 *   bun run scripts/competition/live-runner.ts
 *
 * Config via env:
 *   COMP_SYMBOLS      comma list (default "XAUUSD,EURUSD")
 *   COMP_INTERVAL_MS  cycle cadence in ms (default 60000)
 *   COMP_EXECUTION    "maker" | "taker" (default "taker")
 *   COMP_BARS         bars lookback (default 50)
 *   COMP_KILL_PCT     daily-loss kill fraction (default 0.08)
 *   COMP_TIMEFRAME    MT5 timeframe (default "M15")
 *
 * DOUBLE SAFETY GUARD — both must be set for a real order to fill:
 *   GORDON_LIVE_TRADING=1     (this process; checked inside CompetitionLiveTrader)
 *   MT5_BRIDGE_ALLOW_TRADING=1 (the sidecar; checked in mt5_bridge.py)
 * Unset either ⇒ the loop runs read-only and logs intended (dry) orders.
 *
 * NOTE: the signal here is a deliberately trivial placeholder so the runner is
 * self-contained. Real alpha plugs in by swapping the SignalFn — do not treat
 * this stub as a strategy.
 */

import { Mt5BridgeClient, type Mt5Bar } from "../../src/infra/broker/mt5/bridgeClient.ts";
import {
  CompetitionLiveTrader,
  type SignalFn,
  type ContractSpec,
} from "../../src/infra/trading/competition/liveTrader.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../src/core/risk-management/competition-risk-preset.ts";

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const symbols = (process.env.COMP_SYMBOLS ?? "XAUUSD,EURUSD")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const intervalMs = envNum("COMP_INTERVAL_MS", 60_000);
const execution = (process.env.COMP_EXECUTION === "maker" ? "maker" : "taker") as "maker" | "taker";
const barsLookback = envNum("COMP_BARS", 50);
const dailyLossKillPct = envNum("COMP_KILL_PCT", 0.08);
const timeframe = process.env.COMP_TIMEFRAME ?? "M15";

/**
 * Trivial mean-reversion STUB: fade the last bar's deviation from the lookback
 * mean. Below mean → long, above → short; stop/target scaled off recent range.
 * Placeholder only — real strategies replace this.
 */
const meanReversionStub: SignalFn = (bars: Mt5Bar[]) => {
  if (bars.length < 10) return null;
  const closes = bars.map((b) => b.close);
  const mean = closes.reduce((a, c) => a + c, 0) / closes.length;
  const last = closes[closes.length - 1]!;
  const ranges = bars.map((b) => b.high - b.low).filter((r) => r > 0);
  const atr = ranges.length ? ranges.reduce((a, r) => a + r, 0) / ranges.length : Math.abs(last) * 0.001;
  const dev = last - mean;
  const threshold = atr * 0.5;
  if (Math.abs(dev) < threshold) return null;
  const side = dev < 0 ? "long" : "short";
  return { side, stopDistance: atr * 1.5, targetDistance: atr * 2.0 };
};

const client = new Mt5BridgeClient();

const signals: Record<string, SignalFn> = {};
const contracts: Record<string, ContractSpec> = {};

async function bootstrap(): Promise<void> {
  const health = await client.health();
  if (!health.ok) {
    console.error(`✗ MT5 bridge not healthy: ${health.error ?? "unknown"} — is mt5_bridge.py running?`);
    process.exit(1);
  }
  console.log(`✓ bridge healthy — trading ${health.tradingEnabled ? "ENABLED" : "disabled (read/validate only)"}`);

  // Pull live contract specs (volume_min / volume_step) per symbol for lot rounding.
  for (const symbol of symbols) {
    const spec = await client.symbol(symbol);
    contracts[symbol] = {
      volume_min: spec.volume_min,
      volume_step: spec.volume_step,
      contractSize: spec.trade_contract_size,
    };
    signals[symbol] = meanReversionStub;
    console.log(`  ${symbol}: min ${spec.volume_min} / step ${spec.volume_step} lots, contract ${spec.trade_contract_size}`);
  }

  const armed = process.env.GORDON_LIVE_TRADING === "1";
  console.log(
    `\nGORDON_LIVE_TRADING=${armed ? "1 (ARMED)" : "unset (DRY — no real orders)"} · ` +
      `execution=${execution} · interval=${intervalMs}ms · symbols=${symbols.join(",")}\n`,
  );

  const trader = new CompetitionLiveTrader({
    client,
    symbols,
    signals,
    contracts,
    config: { execution, barsLookback, dailyLossKillPct, timeframe },
    riskParams: COMPETITION_RISK_AGGRESSIVE,
  });

  trader.runLoop(intervalMs, {
    onCycle: (report) => {
      const summary = report.decisions
        .map((d) => `${d.symbol}:${d.action}${d.lots ? `(${d.lots})` : ""}`)
        .join(" ");
      console.log(
        `[cycle] equity=${report.equity.toFixed(0)} dailyPnL=${report.dailyPnL.toFixed(0)} ` +
          `${report.halted ? "HALTED " : ""}placed=${report.ordersPlaced} · ${summary}`,
      );
    },
  });
}

bootstrap().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
