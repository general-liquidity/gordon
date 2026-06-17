#!/usr/bin/env bun
/**
 * Launch-night GO / NO-GO preflight (READ-ONLY).
 *
 * One command the operator runs before arming live trading on competition night.
 * It runs every readiness check against the live MT5 bridge and prints a single
 * GO / NO-GO checklist, so nothing is forgotten before the live book goes hot.
 *
 * Pure read-only: only `health()`, `account()`, `quote()`, `symbol()` are ever
 * called — this script NEVER places, modifies, or cancels an order.
 *
 *   bun run scripts/competition/preflight.ts
 *
 * Prereq: the sidecar (scripts/mt5-bridge/mt5_bridge.py) is running + MT5 logged
 * into the competition account. Before launch the bridge is unreachable and/or
 * the feed is off — both are EXPECTED and reported as notes, not blockers.
 *
 * Critical checks (must pass for GO): bridge health + account + per-instrument
 * contract specs. The live feed being off and the trading guards being disarmed
 * are the RESTING state pre-launch — noted, not failed. GO additionally requires
 * the operator to have deliberately armed both guards (this process'
 * GORDON_LIVE_TRADING and the sidecar's MT5_BRIDGE_ALLOW_TRADING via
 * health.tradingEnabled).
 */

import { Mt5BridgeClient } from "../../src/infra/broker/mt5/bridgeClient.ts";
import { COMPETITION_TRADEABLE } from "../../src/infra/trading/competition/competitionStrategy.ts";

// Mirrors the break-even band from competition-spread-check.ts: the RV edge breaks
// even around ~1bp/side (~2bps quoted); flag anything materially wider than that.
const WIDE_SPREAD_BPS = 5;

const client = new Mt5BridgeClient();

interface CheckResult {
  /** True = passed; false = failed. */
  ok: boolean;
  /** Critical checks block GO when they fail; non-critical only note. */
  critical: boolean;
  label: string;
  detail: string;
}

const results: CheckResult[] = [];
const notes: string[] = [];

function record(r: CheckResult): void {
  results.push(r);
  const mark = r.ok ? "✓ PASS" : r.critical ? "✗ FAIL" : "• NOTE";
  console.log(`${mark}  ${r.label.padEnd(28)} ${r.detail}`);
}

async function main(): Promise<void> {
  console.log("\n── Competition launch preflight — GO / NO-GO (READ-ONLY) ──\n");

  // 1. Bridge health + account login + equity present.
  const health = await client.health();
  if (!health.ok) {
    record({
      ok: false,
      critical: true,
      label: "bridge health",
      detail: `bridge not healthy: ${health.error ?? "unknown"}`,
    });
    finish();
    return;
  }
  const login = health.account?.login;
  const equity = health.account?.equity;
  const haveAccount = login !== undefined && equity !== undefined;
  record({
    ok: haveAccount,
    critical: true,
    label: "bridge health + account",
    detail: haveAccount
      ? `healthy | account ${login} | equity ${equity}`
      : "healthy but account/equity missing — is MT5 logged in?",
  });

  // 2. Live feed: at least one tradeable returns bid>0 && ask>0.
  const quotes = new Map<string, { bid: number; ask: number }>();
  for (const symbol of COMPETITION_TRADEABLE) {
    try {
      const q = await client.quote(symbol);
      quotes.set(symbol, { bid: q.bid, ask: q.ask });
    } catch {
      // Per-symbol quote failures surface in the spec/spread checks below.
    }
  }
  const liveSymbols = [...quotes.entries()].filter(([, q]) => q.bid > 0 && q.ask > 0).map(([s]) => s);
  const feedOn = liveSymbols.length > 0;
  record({
    ok: feedOn,
    critical: false,
    label: "live feed",
    detail: feedOn
      ? `ON — ${liveSymbols.length}/${COMPETITION_TRADEABLE.length} instruments quoting`
      : "feed OFF (all bid/ask 0) — expected pre-launch",
  });
  if (!feedOn) {
    notes.push("Live feed is OFF — re-run the moment quotes go live to validate spreads.");
  }

  // 3. Per-instrument contract specs present for all 15.
  const missingSpecs: string[] = [];
  const specs = new Map<string, { volMin: number; volStep: number; contractSize: number }>();
  for (const symbol of COMPETITION_TRADEABLE) {
    try {
      const spec = await client.symbol(symbol);
      const have = spec.volume_min > 0 && spec.volume_step > 0 && spec.trade_contract_size > 0;
      if (have) {
        specs.set(symbol, {
          volMin: spec.volume_min,
          volStep: spec.volume_step,
          contractSize: spec.trade_contract_size,
        });
      } else {
        missingSpecs.push(symbol);
      }
    } catch {
      missingSpecs.push(symbol);
    }
  }
  const specsOk = missingSpecs.length === 0;
  record({
    ok: specsOk,
    critical: true,
    label: "contract specs (15)",
    detail: specsOk
      ? `all ${COMPETITION_TRADEABLE.length} present (volume_min/step + contract_size)`
      : `MISSING for: ${missingSpecs.join(", ")}`,
  });

  // 4. Spread sanity: flag any live instrument wider than WIDE_SPREAD_BPS.
  if (feedOn) {
    const wide: string[] = [];
    for (const symbol of liveSymbols) {
      const q = quotes.get(symbol)!;
      const mid = (q.bid + q.ask) / 2;
      const spreadBps = ((q.ask - q.bid) / mid) * 10_000;
      if (spreadBps > WIDE_SPREAD_BPS) wide.push(`${symbol} ${spreadBps.toFixed(2)}bps`);
    }
    record({
      ok: wide.length === 0,
      critical: false,
      label: "spread sanity",
      detail:
        wide.length === 0
          ? `all ${liveSymbols.length} live instruments ≤ ${WIDE_SPREAD_BPS}bps`
          : `WIDE (> ${WIDE_SPREAD_BPS}bps): ${wide.join(", ")}`,
    });
    if (wide.length > 0) {
      notes.push("Wide spreads detected — prune the widest pairs or size down before arming.");
    }
  } else {
    record({
      ok: true,
      critical: false,
      label: "spread sanity",
      detail: "skipped — feed off (no live quotes to measure)",
    });
  }

  // 5. Trading-guard state. RESTING state is OFF until the operator deliberately arms.
  const processArmed = process.env.GORDON_LIVE_TRADING === "1" || process.env.GORDON_LIVE_TRADING === "true";
  const sidecarArmed = health.tradingEnabled === true;
  const armed = processArmed && sidecarArmed;
  record({
    ok: armed,
    critical: false,
    label: "trading guards",
    detail: `GORDON_LIVE_TRADING=${processArmed ? "ON" : "off"} (this process) | MT5_BRIDGE_ALLOW_TRADING=${
      sidecarArmed ? "ON" : "off"
    } (sidecar, via health.tradingEnabled)`,
  });
  if (!armed) {
    notes.push(
      "Trading guards are DISARMED (resting state) — set GORDON_LIVE_TRADING here AND " +
        "MT5_BRIDGE_ALLOW_TRADING on the sidecar to arm. This is expected until you deliberately go live.",
    );
  }

  finish(armed);
}

function finish(armed = false): void {
  const criticalBlockers = results.filter((r) => r.critical && !r.ok);
  const criticalPass = criticalBlockers.length === 0;

  console.log("");
  for (const n of notes) console.log(`  note: ${n}`);
  if (notes.length) console.log("");

  if (criticalPass && armed) {
    console.log("══════════════════════════════════════════");
    console.log("  GO  ✓  — critical checks pass and guards are armed. Live trading is ready.");
    console.log("══════════════════════════════════════════\n");
    process.exit(0);
  }

  console.log("══════════════════════════════════════════");
  console.log("  NO-GO  ✗");
  if (!criticalPass) {
    console.log("  Critical blockers:");
    for (const b of criticalBlockers) console.log(`    - ${b.label}: ${b.detail}`);
  } else {
    console.log("  Critical checks pass, but trading is not yet armed (expected pre-launch).");
    console.log("    - arm GORDON_LIVE_TRADING here AND MT5_BRIDGE_ALLOW_TRADING on the sidecar when ready.");
  }
  console.log("══════════════════════════════════════════\n");
  // Exit 0 when the only thing missing is the deliberate arm (a clean, expected
  // pre-launch state); exit 1 only when a genuine critical check failed.
  process.exit(criticalPass ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  console.error("  (If this is pre-launch, the bridge is simply not running yet — start the sidecar and retry.)\n");
  process.exit(1);
});
