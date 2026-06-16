#!/usr/bin/env bun
/**
 * Competition LIVE runner — wires the real MT5 bridge client into the
 * `CompetitionLiveTrader` loop with the regime-adaptive default strategy.
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
 * NOTE: the strategy here is the regime-adaptive DEFAULT — mean-revert in chop,
 * momentum in trend (see `src/core/alpha/regime-adaptive-strategy.ts`). It is the
 * honest best-available posture, NOT a proven edge: its value is robustness across
 * regimes + not taking the structurally wrong bet, not demonstrated alpha. Swap the
 * SignalFn to plug in something better.
 */

import { Mt5BridgeClient, type Mt5Bar } from "../../src/infra/broker/mt5/bridgeClient.ts";
import {
  CompetitionLiveTrader,
  type SignalFn,
  type ContractSpec,
} from "../../src/infra/trading/competition/liveTrader.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../src/core/risk-management/competition-risk-preset.ts";
import { regimeAdaptiveSignal } from "../../src/core/alpha/regime-adaptive-strategy.ts";

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
 * Regime-adaptive DEFAULT: classify the recent regime (efficiency ratio) and pick
 * the regime-appropriate signal — mean-revert in chop, momentum breakout in trend.
 * Honest best-available, NOT a proven edge (see the module header). Same vol-scaled
 * stop/target shape the dry-run/sizing spine expects.
 */
const regimeAdaptive: SignalFn = (bars: Mt5Bar[]) =>
  regimeAdaptiveSignal(bars.map((b) => b.close));

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
    signals[symbol] = regimeAdaptive;
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
