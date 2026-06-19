#!/usr/bin/env bun
/**
 * Competition spread + contract-spec readiness probe (READ-ONLY).
 *
 * The single biggest live unknown for the Best-Sharpe book is the REAL spread we pay — the
 * sweep showed the RV-reversion edge breaks even at ~1bp/side (a quoted spread of ~2bps), so
 * whether the book is net-positive or ~0 hinges entirely on Cypher's actual spreads. This tool
 * queries every one of the 15 competition instruments for its live quote + contract spec and
 * reports the spread in bps with a verdict against that break-even. Run it the MOMENT the live
 * feed turns on (~18–21 Jun); before then bid/ask read 0 and it says so.
 *
 * Pure read-only: only `quote()` + `symbol()` are called — no orders, ever.
 *
 *   bun run scripts/dev/mt5/competition-spread-check.ts
 *
 * Prereq: the sidecar (scripts/mt5-bridge/mt5_bridge.py) is running + MT5 logged into the
 * competition account. Doubles as the per-instrument ContractSpec collector for the live runner.
 */

import { Mt5BridgeClient } from "../../../src/infra/broker/mt5/bridgeClient.ts";
import { COMPETITION_TRADEABLE } from "../../../src/infra/trading/competition/competitionStrategy.ts";
import { RV_GOOD_SPREAD_BPS, RV_NET_NEGATIVE_SPREAD_BPS } from "../../../src/infra/trading/competition/rvReversionCore.ts";

// Empirical break-even from best-sharpe-sweep.ts: gross per-bar edge ~+0.007 is consumed by
// ~1bp/side cost ≈ a quoted spread of ~2bps. Quoted-spread bands → net-Sharpe expectation.
// Sourced from the RV core so this diagnostic and the live entry gate use the SAME cutoffs:
// `>= RV_NET_NEGATIVE_SPREAD_BPS` is exactly what the runner's RV gate refuses to open.
const GOOD_BPS = RV_GOOD_SPREAD_BPS; // < this → half-spread <1bp → potentially net-positive
const MARGINAL_BPS = RV_NET_NEGATIVE_SPREAD_BPS; // 2–4bps → ~break-even; >= this → clearly negative (gate skips)

const client = new Mt5BridgeClient();

interface Row {
  symbol: string;
  bid: number;
  ask: number;
  spreadBps: number | null;
  contractSize: number;
  volMin: number;
  volStep: number;
  verdict: string;
}

function verdictFor(spreadBps: number | null): string {
  if (spreadBps === null) return "feed off";
  if (spreadBps < GOOD_BPS) return "GOOD ✓ (net-positive plausible)";
  if (spreadBps < MARGINAL_BPS) return "MARGINAL ~ (≈break-even)";
  return "POOR ✗ (net-negative)";
}

async function main(): Promise<void> {
  console.log("\n── Competition spread + spec readiness (READ-ONLY) ──\n");
  const health = await client.health();
  if (!health.ok) {
    console.error(`✗ bridge not healthy: ${health.error ?? "unknown"} — start the sidecar + log MT5 in.`);
    process.exit(1);
  }
  console.log(`✓ bridge healthy | account ${health.account?.login ?? "?"} | equity ${health.account?.equity ?? "?"} | trading ${health.tradingEnabled ? "ENABLED" : "read-only"}\n`);

  const rows: Row[] = [];
  for (const symbol of COMPETITION_TRADEABLE) {
    try {
      const [quote, spec] = await Promise.all([client.quote(symbol), client.symbol(symbol)]);
      const mid = quote.bid > 0 && quote.ask > 0 ? (quote.bid + quote.ask) / 2 : 0;
      const spreadBps = mid > 0 ? ((quote.ask - quote.bid) / mid) * 10_000 : null;
      rows.push({
        symbol,
        bid: quote.bid,
        ask: quote.ask,
        spreadBps,
        contractSize: spec.trade_contract_size,
        volMin: spec.volume_min,
        volStep: spec.volume_step,
        verdict: verdictFor(spreadBps),
      });
    } catch (err) {
      rows.push({ symbol, bid: 0, ask: 0, spreadBps: null, contractSize: 0, volMin: 0, volStep: 0, verdict: `error: ${(err as Error).message}` });
    }
  }

  console.log("symbol      spread(bps)  contractSize  volMin/step      verdict");
  console.log("─".repeat(78));
  for (const r of rows) {
    const sp = r.spreadBps === null ? "   —  " : r.spreadBps.toFixed(2).padStart(6);
    console.log(
      `${r.symbol.padEnd(10)} ${sp}      ${String(r.contractSize).padStart(10)}  ${`${r.volMin}/${r.volStep}`.padEnd(14)} ${r.verdict}`,
    );
  }

  const live = rows.filter((r) => r.spreadBps !== null);
  console.log("");
  if (live.length === 0) {
    console.log("Live feed is OFF (all bid/ask 0) — expected before the data turns on (~18–21 Jun).");
    console.log("Re-run the moment quotes go live; historical backtesting is already unblocked.");
    return;
  }
  const good = live.filter((r) => r.spreadBps! < GOOD_BPS).length;
  const marginal = live.filter((r) => r.spreadBps! >= GOOD_BPS && r.spreadBps! < MARGINAL_BPS).length;
  const poor = live.filter((r) => r.spreadBps! >= MARGINAL_BPS).length;
  const cryptoCore = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD", "XAUUSD", "XAGUSD"];
  const coreGood = live.filter((r) => cryptoCore.includes(r.symbol) && r.spreadBps! < GOOD_BPS).length;
  const coreLive = live.filter((r) => cryptoCore.includes(r.symbol)).length;
  console.log(`Spread verdict: ${good} GOOD / ${marginal} MARGINAL / ${poor} POOR (of ${live.length} live).`);
  console.log(`RV-core instruments tight (<${GOOD_BPS}bps): ${coreGood}/${coreLive}.`);
  console.log(
    coreGood >= Math.ceil(coreLive * 0.6)
      ? "→ Spreads support a net-positive Best-Sharpe book. Proceed; size the smooth core."
      : "→ Spreads are too wide for net-positive — the book is the ~0 relative-rank play (smooth + survive),\n  and prune the widest-spread pairs from the RV clusters.",
  );
  console.log("");
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
