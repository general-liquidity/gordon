#!/usr/bin/env bun
/**
 * Live STANDING watch (READ-ONLY) — the operator's competition dashboard.
 *
 * Polls the MT5 bridge for account + positions, accumulates the 15-minute equity curve, and
 * prints our live §11-17 standing (Return / Sharpe / max-DD / risk-discipline + estimated rank,
 * stance, sleeve readout) every interval — WITHOUT arming trading. Run it alongside the live
 * runner (or on its own) to watch where we stand and when the sleeve would fire.
 *
 *   COMP_STARTING_EQUITY=1000000 COMP_CUT_MS=... COMP_DEADLINE_MS=... \
 *   COMP_FIELD_N=500 WATCH_INTERVAL_S=900 bun run scripts/competition/standing-watch.ts
 *
 * Pure read-only: account / positions / quote / symbol only — never an order. Note: it measures
 * from when it STARTS (it can't recover equity history before launch), so run it from go-live for
 * full-window metrics. Poll at 900s (15 min) to match the competition's 15-min Sharpe sampling.
 */

import { Mt5BridgeClient } from "../../src/infra/broker/mt5/bridgeClient.ts";
import { computeStanding } from "../../src/infra/trading/competition/standingMonitor.ts";
import type { RiskSample } from "../../src/core/risk-management/competition-scoring.ts";

const M15_MS = 15 * 60 * 1000;
const num = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : d;
};

const client = new Mt5BridgeClient();
const equityHistory: number[] = [];
const riskHistory: RiskSample[] = [];
const specCache = new Map<string, number>(); // symbol → contractSize

async function contractSize(sym: string): Promise<number> {
  if (!specCache.has(sym)) {
    try {
      const s = await client.symbol(sym);
      specCache.set(sym, s.trade_contract_size > 0 ? s.trade_contract_size : 1);
    } catch {
      specCache.set(sym, 1);
    }
  }
  return specCache.get(sym)!;
}

async function poll(): Promise<void> {
  const account = await client.account();
  equityHistory.push(account.equity);

  const positions = await client.positions();
  const signedBySym: Record<string, number> = {};
  let gross = 0;
  for (const p of positions) {
    const q = await client.quote(p.symbol).catch(() => null);
    const mid = q && q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : p.price_current;
    const notional = Math.abs(p.volume) * mid * (await contractSize(p.symbol));
    gross += notional;
    signedBySym[p.symbol] = (signedBySym[p.symbol] ?? 0) + (p.sideLabel === "long" ? notional : -notional);
  }
  const equity = account.equity;
  const marginUsage = equity > 0 && account.margin > 0 ? account.margin / equity : 0;
  const leverage = equity > 0 ? gross / equity : 0;
  const singleInstrumentExposure = gross > 0 ? Math.max(0, ...Object.values(signedBySym).map(Math.abs)) / gross : 0;
  const netDirectionalExposure = gross > 0 ? Math.abs(Object.values(signedBySym).reduce((s, v) => s + v, 0)) / gross : 0;
  riskHistory.push({ marginUsage, leverage, singleInstrumentExposure, netDirectionalExposure });

  const cutMs = num("COMP_CUT_MS", 0);
  const now = Date.now();
  const standing = computeStanding({
    equity15m: equityHistory,
    riskSamples: riskHistory,
    riskIntervalMinutes: 15,
    startingEquity: num("COMP_STARTING_EQUITY", 1_000_000),
    phase: cutMs > 0 && now >= cutMs ? "post_cut" : "pre_cut",
    barsToCut: cutMs > 0 ? Math.max(0, Math.round((cutMs - now) / M15_MS)) : undefined,
    cutPercentile: num("COMP_CUT_PCT", 0.8),
    fieldN: num("COMP_FIELD_N", 500),
    liveRisk: { marginUsage, leverage },
    asOf: new Date().toISOString().slice(0, 16).replace("T", " "),
  });
  console.log("\n" + standing.summary);
}

async function main(): Promise<void> {
  const health = await client.health();
  if (!health.ok) {
    console.error(`✗ bridge not healthy: ${health.error ?? "unknown"} — start the sidecar + log MT5 in.`);
    process.exit(1);
  }
  console.log(`── Live standing watch (READ-ONLY) · account ${health.account?.login ?? "?"} · Ctrl-C to stop ──`);
  const intervalMs = num("WATCH_INTERVAL_S", 900) * 1000;
  await poll();
  setInterval(() => {
    poll().catch((e) => console.error(`poll error (continuing): ${(e as Error).message}`));
  }, intervalMs);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
