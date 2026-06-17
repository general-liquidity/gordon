#!/usr/bin/env bun
/**
 * Competition LIVE runner — wires the real MT5 bridge into the chosen strategy loop.
 *
 *   bun run scripts/competition/live-runner.ts
 *
 * Strategy (COMP_STRATEGY):
 *   "barbell" (DEFAULT) — the full barbell: dollar-neutral RV-reversion Best-Sharpe CORE +
 *     ring-fenced lottery SLEEVE, driven via target-portfolio reconciliation
 *     (`BarbellLiveRunner`). This is the go-live posture.
 *   "tsmom" — the single-leg TSMOM path (`CompetitionLiveTrader`). Kept for BRIDGE SMOKE
 *     VALIDATION: simplest order shape to confirm the transport before arming the barbell.
 *
 * Config via env:
 *   COMP_STRATEGY     "barbell" | "tsmom"            (default "barbell")
 *   COMP_SYMBOLS      comma list                     (default = the 15 tradeable instruments)
 *   COMP_INTERVAL_MS  cycle cadence ms               (default 60000)
 *   COMP_BARS         bars lookback                  (default from the frozen config)
 *   COMP_TIMEFRAME    MT5 timeframe                  (default "M15")
 *   COMP_STARTING_EQUITY  baseline for return calc   (default = account equity at boot)
 *   COMP_CUT_MS / COMP_DEADLINE_MS  epoch-ms of the Top-100 cut / contest end (barbell phase + horizon)
 *
 * DOUBLE SAFETY GUARD — both required for a real order to fill:
 *   GORDON_LIVE_TRADING=1      (this process)
 *   MT5_BRIDGE_ALLOW_TRADING=1 (the sidecar; mt5_bridge.py)
 * Unset either ⇒ read-only: deltas are computed + logged (DRY), nothing is sent.
 */

import { appendFileSync, readFileSync } from "node:fs";
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
import { BarbellLiveRunner } from "../../src/infra/trading/competition/barbellLiveRunner.ts";

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Live peer-return board from `COMP_PEER_RETURNS_PATH` — a JSON file the operator maintains from
 * the Round-1–3 leaderboard (an array of peer return fractions, or `{ "returns": [...] }`). Read
 * each cycle (best-effort). This is what unlocks the REAL-standing sleeve: without it the runner's
 * field stays the placeholder model and the endgame sleeve is gated OFF (see barbellLiveRunner +
 * OPERATIONS §9). Returns undefined when absent/malformed so the runner safely falls back.
 */
function readPeerReturns(path: string): { returns: number[] } | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { returns?: unknown })?.returns) ? (raw as { returns: unknown[] }).returns : null;
    if (!arr) return undefined;
    const returns = arr.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return returns.length >= 2 ? { returns } : undefined;
  } catch {
    return undefined;
  }
}

const strategy = (process.env.COMP_STRATEGY ?? "barbell").toLowerCase();
const symbols = (process.env.COMP_SYMBOLS ?? COMPETITION_TRADEABLE.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const intervalMs = envNum("COMP_INTERVAL_MS", 60_000);
const barsLookback = envNum("COMP_BARS", COMPETITION_LIVE_CONFIG.barsLookback);
const timeframe = process.env.COMP_TIMEFRAME ?? "M15";
const M15_MS = 15 * 60 * 1000;

const client = new Mt5BridgeClient();
const contracts: Record<string, ContractSpec> = {};

async function bootstrap(): Promise<void> {
  const health = await client.health();
  if (!health.ok) {
    console.error(`✗ MT5 bridge not healthy: ${health.error ?? "unknown"} — is mt5_bridge.py running?`);
    process.exit(1);
  }
  console.log(`✓ bridge healthy — trading ${health.tradingEnabled ? "ENABLED" : "disabled (read/validate only)"}`);

  for (const symbol of symbols) {
    const spec = await client.symbol(symbol);
    contracts[symbol] = { volume_min: spec.volume_min, volume_step: spec.volume_step, contractSize: spec.trade_contract_size };
    console.log(`  ${symbol}: min ${spec.volume_min} / step ${spec.volume_step} lots, contract ${spec.trade_contract_size}`);
  }

  const armed = process.env.GORDON_LIVE_TRADING === "1";
  console.log(
    `\nstrategy=${strategy} · GORDON_LIVE_TRADING=${armed ? "1 (ARMED)" : "unset (DRY — no real orders)"} · ` +
      `interval=${intervalMs}ms · symbols=${symbols.length}\n`,
  );

  if (strategy === "tsmom") {
    // Single-leg path — bridge smoke validation.
    const tsmom: SignalFn = makeTsmomSignal();
    const signals: Record<string, SignalFn> = {};
    for (const s of symbols) signals[s] = tsmom;
    const trader = new CompetitionLiveTrader({
      client, symbols, signals, contracts,
      config: { execution: "taker", barsLookback, dailyLossKillPct: COMPETITION_LIVE_CONFIG.dailyLossKillPct, timeframe },
      riskParams: COMPETITION_RISK,
    });
    trader.runLoop(intervalMs, {
      onCycle: (r) =>
        console.log(`[tsmom] equity=${r.equity.toFixed(0)} dailyPnL=${r.dailyPnL.toFixed(0)} ${r.halted ? "HALTED " : ""}placed=${r.ordersPlaced}`),
    });
    return;
  }

  // ── Barbell (default go-live posture) ──
  const acct = await client.account();
  const startingEquity = envNum("COMP_STARTING_EQUITY", acct.equity);
  const cutMs = envNum("COMP_CUT_MS", 0);
  const deadlineMs = envNum("COMP_DEADLINE_MS", 0);
  const peerPath = process.env.COMP_PEER_RETURNS_PATH;
  // Endgame arming reflects whether the file ACTUALLY resolves to a valid board NOW (≥2 returns),
  // not merely that the env var is set — a missing/empty/malformed file leaves the sleeve gated.
  const peerBoardNow = peerPath ? readPeerReturns(peerPath) : undefined;
  const peerBoardNote = !peerPath
    ? "no peer board → endgame sleeve GATED OFF (finals-only)"
    : peerBoardNow
      ? `peer board@${peerPath} (${peerBoardNow.returns.length} returns) → endgame sleeve ARMED on real data`
      : `peer board@${peerPath} set but EMPTY/invalid (need ≥2 returns) → endgame GATED until populated (re-checked each cycle)`;

  const runner = new BarbellLiveRunner(client, {
    symbols,
    contracts,
    startingEquity,
    barsLookback,
    timeframe,
    // Phase: post-cut once we pass the cut time (finals sleeve); pre-cut otherwise.
    phase: () => (cutMs > 0 && Date.now() >= cutMs ? "post_cut" : "pre_cut"),
    // Liquidation horizon: M15 bars remaining to the deadline (fallback ~5 trading days).
    barsToDeadline: () => (deadlineMs > 0 ? Math.max(1, Math.round((deadlineMs - Date.now()) / M15_MS)) : 480),
    // Bars to the Top-100 cut — enables the pre-finals endgame sleeve + the standing readout.
    barsToCut: () => (cutMs > 0 ? Math.max(0, Math.round((cutMs - Date.now()) / M15_MS)) : Number.POSITIVE_INFINITY),
    // Live peer-return board (operator-maintained) — REQUIRED for the endgame sleeve to auto-fire:
    // it calibrates the field to real rank. Without COMP_PEER_RETURNS_PATH the endgame stays gated.
    board: peerPath ? () => readPeerReturns(peerPath) : undefined,
    // Restart-safe state + manual kill-switch flag file (operator panic-button) + critical alerts.
    statePath: process.env.COMP_STATE_PATH,
    flattenFlagPath: process.env.COMP_FLATTEN_FLAG,
    alert: (a) => {
      const line = `${new Date().toISOString()} [${a.level.toUpperCase()}] ${a.event} — ${a.detail}`;
      console.log(`\n🚨 ${line}\n`);
      try {
        appendFileSync(process.env.COMP_ALERT_PATH ?? "comp-alerts.log", line + "\n");
      } catch {
        /* alert file best-effort */
      }
    },
  });

  console.log(
    `barbell: startingEquity=${startingEquity.toFixed(0)} · ` +
      `phase gate ${cutMs > 0 ? `cut@${new Date(cutMs).toISOString()}` : "pre_cut (no COMP_CUT_MS)"} · ` +
      `${deadlineMs > 0 ? `deadline@${new Date(deadlineMs).toISOString()}` : "barsToDeadline=480 (no COMP_DEADLINE_MS)"} · ` +
      `${peerBoardNote}\n`,
  );

  runner.runLoop(intervalMs, (r) => {
    const summary = r.orders.map((o) => `${o.symbol}:${o.action}(${o.side}${o.lots})`).join(" ") || "(at target)";
    console.log(`[barbell] equity=${r.equity.toFixed(0)} ret=${(r.ourReturnPct * 100).toFixed(2)}% placed=${r.ordersPlaced} · ${summary}`);
    console.log(`          ${r.decisionReason}`);
  });
}

bootstrap().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
