#!/usr/bin/env bun
/**
 * Competition LIVE runner — wires the real MT5 bridge client into the
 * `CompetitionLiveTrader` loop with the regime-adaptive default strategy.
 *
 *   bun run scripts/competition/live-runner.ts
 *
 * Config via env (defaults = the FROZEN competition config):
 *   COMP_SYMBOLS      comma list (default = the 15 tradeable instruments)
 *   COMP_INTERVAL_MS  cycle cadence in ms (default 60000)
 *   COMP_EXECUTION    "maker" | "taker" (default "taker" — Cypher is FOK/IOC)
 *   COMP_BARS         bars lookback (default from the frozen config)
 *   COMP_KILL_PCT     daily-loss kill fraction (default from the frozen survival preset)
 *   COMP_TIMEFRAME    MT5 timeframe (default "M15")
 *
 * DOUBLE SAFETY GUARD — both must be set for a real order to fill:
 *   GORDON_LIVE_TRADING=1     (this process; checked inside CompetitionLiveTrader)
 *   MT5_BRIDGE_ALLOW_TRADING=1 (the sidecar; checked in mt5_bridge.py)
 * Unset either ⇒ the loop runs read-only and logs intended (dry) orders.
 *
 * Strategy = the FROZEN beta-stripped TSMOM + survive-and-rank preset
 * (`src/infra/trading/competition/competitionStrategy.ts`) — IDENTICAL to what the
 * paper-mode rehearsal exercises. NOT a proven return edge; its value is low drawdown
 * + a smooth equity curve, which is what the Drawdown/Sharpe ranks reward.
 */

import { Mt5BridgeClient } from "../../src/infra/broker/mt5/bridgeClient.ts";
import {
  CompetitionLiveTrader,
  type SignalFn,
  type ContractSpec,
} from "../../src/infra/trading/competition/liveTrader.ts";
import {
  makeTsmomSignal,
  COMPETITION_TRADEABLE,
  COMPETITION_LIVE_CONFIG,
  COMPETITION_RISK,
} from "../../src/infra/trading/competition/competitionStrategy.ts";

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const symbols = (process.env.COMP_SYMBOLS ?? COMPETITION_TRADEABLE.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const intervalMs = envNum("COMP_INTERVAL_MS", 60_000);
const execution = (process.env.COMP_EXECUTION === "maker" ? "maker" : "taker") as "maker" | "taker";
const barsLookback = envNum("COMP_BARS", COMPETITION_LIVE_CONFIG.barsLookback);
const dailyLossKillPct = envNum("COMP_KILL_PCT", COMPETITION_LIVE_CONFIG.dailyLossKillPct);
const timeframe = process.env.COMP_TIMEFRAME ?? "M15";

/** The frozen beta-stripped time-series-momentum signal (one instance, all symbols). */
const tsmom: SignalFn = makeTsmomSignal();

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
    signals[symbol] = tsmom;
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
    riskParams: COMPETITION_RISK,
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
