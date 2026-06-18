#!/usr/bin/env bun
/**
 * Maker-fill LIVE probe — measures whether RESTING LIMIT orders actually fill on
 * the competition venue (Syphonix/MT5), and how badly adverse-selected.
 *
 * This is the data that decides whether we flip the core from TAKER to MAKER. A
 * maker core only pays off if (a) resting limits fill at a useful rate and (b)
 * they don't get systematically picked off (negative adverse-selection). We post
 * a FEW SMALL resting limits at the touch, wait, measure time-to-fill + realized
 * adverse-selection, then CANCEL the rest and CLOSE anything that filled so the
 * probe leaves no residual.
 *
 *   bun run scripts/competition/maker-probe.ts                 # DRY unless GORDON_LIVE_TRADING=1
 *   GORDON_LIVE_TRADING=1 bun run scripts/competition/maker-probe.ts
 *
 * Config via env:
 *   PROBE_SYMBOLS     comma list                 (default "BTCUSD,ETHUSD")
 *   PROBE_LOTS        lots per order             (default = each symbol's volume_min)
 *   PROBE_WAIT_S      seconds to wait for a fill (default 60)
 *   PROBE_CYCLES      cycles per symbol          (default 5)
 *   PROBE_INSIDE_BPS  improve the maker price toward mid, in bps (default 0 = rest at touch)
 *
 * DOUBLE SAFETY GUARD — both required for a real order to fill:
 *   GORDON_LIVE_TRADING=1      (this process)
 *   MT5_BRIDGE_ALLOW_TRADING=1 (the sidecar; mt5_bridge.py)
 * Unset GORDON_LIVE_TRADING ⇒ DRY: nothing is sent.
 *
 * All probe orders are BUY (rest at/below bid). Realized adverse-selection for a
 * filled BUY is (mid_at_post − fill) / mid_at_post · 1e4 bps; POSITIVE = favorable
 * (we bought below where the market was when we posted), NEGATIVE = we got picked off.
 */

import { Mt5BridgeClient, type Mt5Position } from "../../src/infra/broker/mt5/bridgeClient.ts";

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const SYMBOLS = (process.env.PROBE_SYMBOLS ?? "BTCUSD,ETHUSD")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LOTS_OVERRIDE = process.env.PROBE_LOTS ? Number(process.env.PROBE_LOTS) : undefined;
const WAIT_S = Math.max(1, envNum("PROBE_WAIT_S", 60));
const CYCLES = Math.max(1, Math.floor(envNum("PROBE_CYCLES", 5)));
const INSIDE_BPS = Math.max(0, envNum("PROBE_INSIDE_BPS", 0));
const POLL_MS = 3_000;
const ARMED = process.env.GORDON_LIVE_TRADING === "1";

const client = new Mt5BridgeClient();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ProbeResult {
  symbol: string;
  cycle: number;
  mid: number;
  postedPrice: number;
  filled: boolean;
  timeToFillS: number | null;
  fillPrice: number | null;
  adverseBps: number | null;
}

/** Round a price to the symbol's tick grid so MT5 accepts the limit. */
function roundToTick(price: number, tickSize: number, digits: number): number {
  const grid = tickSize > 0 ? Math.round(price / tickSize) * tickSize : price;
  return Number(grid.toFixed(digits));
}

/** Find a position opened by this probe for `symbol` (a filled BUY/long). */
function findProbePosition(positions: Mt5Position[], symbol: string): Mt5Position | undefined {
  return positions.find((p) => p.symbol === symbol && p.sideLabel === "long");
}

async function probeOne(symbol: string, cycle: number, lots: number, tickSize: number, digits: number): Promise<ProbeResult> {
  const quote = await client.quote(symbol);
  const mid = (quote.bid + quote.ask) / 2;
  // Maker BUY: rest at bid, improved toward mid by INSIDE_BPS (but never crossing the mid → still a maker order).
  const improvement = mid * (INSIDE_BPS / 1e4);
  const rawPrice = Math.min(quote.bid + improvement, mid);
  const postedPrice = roundToTick(rawPrice, tickSize, digits);

  const result: ProbeResult = {
    symbol,
    cycle,
    mid,
    postedPrice,
    filled: false,
    timeToFillS: null,
    fillPrice: null,
    adverseBps: null,
  };

  if (!mid || !quote.bid) {
    console.log(`  [${symbol} #${cycle}] live feed OFF (bid/ask 0) — skipping`);
    return result;
  }

  const placed = await client.placeOrder({
    symbol,
    side: "buy",
    type: "limit",
    volume: lots,
    price: postedPrice,
    filling: "return",
    clientOrderId: `makerprobe_${symbol}_${cycle}`,
  });

  if (!placed.executed || !placed.order) {
    const why = placed.guard ? `guard=${placed.guard}` : placed.comment ?? `retcode=${placed.retcode ?? "?"}`;
    console.log(`  [${symbol} #${cycle}] post REJECTED (${why}) — mid=${mid} price=${postedPrice}`);
    return result;
  }

  const ticket = placed.order;
  console.log(`  [${symbol} #${cycle}] posted limit ticket=${ticket} @ ${postedPrice} (mid=${mid.toFixed(digits)}) — waiting up to ${WAIT_S}s`);

  const t0 = Date.now();
  const deadline = t0 + WAIT_S * 1000;
  let fillPrice: number | null = null;

  // Poll: a fill means the ticket left the pending book AND a long position appeared.
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let stillPending: boolean;
    let positions: Mt5Position[];
    try {
      const [orders, pos] = await Promise.all([client.orders(), client.positions()]);
      stillPending = orders.some((o) => o.ticket === ticket);
      positions = pos;
    } catch (err) {
      console.log(`  [${symbol} #${cycle}] poll error: ${(err as Error).message}`);
      continue;
    }
    if (!stillPending) {
      const posn = findProbePosition(positions, symbol);
      if (posn) {
        fillPrice = posn.price_open;
        result.filled = true;
        result.timeToFillS = (Date.now() - t0) / 1000;
        result.fillPrice = fillPrice;
        result.adverseBps = ((mid - fillPrice) / mid) * 1e4;
        console.log(`  [${symbol} #${cycle}] FILLED @ ${fillPrice} after ${result.timeToFillS.toFixed(1)}s — adverse=${result.adverseBps.toFixed(2)}bps`);
        // Flatten the residual immediately (market close of this tiny long).
        try {
          const closed = await client.close(posn.ticket, posn.volume);
          if (!closed.executed) {
            console.log(`  [${symbol} #${cycle}] ⚠ CLOSE not confirmed (${closed.comment ?? closed.guard ?? "?"}) — FLATTEN ticket ${posn.ticket} MANUALLY`);
          }
        } catch (err) {
          console.log(`  [${symbol} #${cycle}] ⚠ CLOSE failed (${(err as Error).message}) — FLATTEN ticket ${posn.ticket} MANUALLY`);
        }
      } else {
        // Order left the book but no long position — treat as not-filled (cancelled/expired externally).
        console.log(`  [${symbol} #${cycle}] ticket left book with no matching position — treating as unfilled`);
      }
      return result;
    }
  }

  // Timed out still resting → cancel.
  console.log(`  [${symbol} #${cycle}] NO fill in ${WAIT_S}s — cancelling ticket ${ticket}`);
  try {
    const cancelled = await client.cancel(ticket);
    if (!cancelled.executed) {
      console.log(`  [${symbol} #${cycle}] ⚠ CANCEL not confirmed (${cancelled.comment ?? cancelled.guard ?? "?"}) — CANCEL ticket ${ticket} MANUALLY`);
    }
  } catch (err) {
    console.log(`  [${symbol} #${cycle}] ⚠ CANCEL failed (${(err as Error).message}) — CANCEL ticket ${ticket} MANUALLY`);
  }
  return result;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function report(results: ProbeResult[]): void {
  console.log(`\n── maker-probe results ──\n`);
  const header = ["symbol", "cyc", "mid", "posted", "filled", "ttf(s)", "fill", "adverse(bps)"];
  console.log("  " + header.map((h, i) => h.padEnd([8, 4, 12, 12, 7, 7, 12, 13][i]!)).join(""));
  for (const r of results) {
    const row = [
      r.symbol,
      String(r.cycle),
      r.mid ? r.mid.toPrecision(8) : "-",
      r.postedPrice ? String(r.postedPrice) : "-",
      r.filled ? "y" : "n",
      r.timeToFillS != null ? r.timeToFillS.toFixed(1) : "-",
      r.fillPrice != null ? String(r.fillPrice) : "-",
      r.adverseBps != null ? r.adverseBps.toFixed(2) : "-",
    ];
    console.log("  " + row.map((c, i) => c.padEnd([8, 4, 12, 12, 7, 7, 12, 13][i]!)).join(""));
  }

  // Per-symbol + aggregate.
  console.log(`\n── per-symbol ──`);
  const bySymbol = new Map<string, ProbeResult[]>();
  for (const r of results) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol)!.push(r);
  }
  for (const [symbol, rs] of bySymbol) {
    const fills = rs.filter((r) => r.filled);
    const fillRate = rs.length ? fills.length / rs.length : 0;
    const meanAdv = fills.length ? fills.reduce((s, r) => s + (r.adverseBps ?? 0), 0) / fills.length : NaN;
    console.log(`  ${symbol.padEnd(8)} fillRate=${pct(fillRate)} (${fills.length}/${rs.length})  meanAdverse=${Number.isNaN(meanAdv) ? "n/a" : meanAdv.toFixed(2) + "bps"}`);
  }

  const allFills = results.filter((r) => r.filled);
  const aggFillRate = results.length ? allFills.length / results.length : 0;
  const aggMeanAdv = allFills.length ? allFills.reduce((s, r) => s + (r.adverseBps ?? 0), 0) / allFills.length : NaN;
  console.log(`\n── aggregate ──`);
  console.log(`  fill rate         ${pct(aggFillRate)} (${allFills.length}/${results.length})`);
  console.log(`  mean adverse-sel  ${Number.isNaN(aggMeanAdv) ? "n/a (no fills)" : aggMeanAdv.toFixed(2) + " bps"}`);

  // Verdict: maker only viable if it actually fills AND isn't systematically picked off.
  const FILL_RATE_FLOOR = 0.5;
  const viable = aggFillRate >= FILL_RATE_FLOOR && allFills.length > 0 && aggMeanAdv >= 0;
  console.log(
    `\n  VERDICT: ${
      viable
        ? "maker viable — fills land and adverse-selection ≥ 0; worth testing a maker core"
        : `maker NOT viable — stay taker (need fillRate ≥ ${pct(FILL_RATE_FLOOR)} AND meanAdverse ≥ 0)`
    }\n`,
  );
}

async function main(): Promise<void> {
  console.log(`\n── maker-fill probe ──`);
  console.log(`  symbols=${SYMBOLS.join(",")} cycles=${CYCLES} wait=${WAIT_S}s insideBps=${INSIDE_BPS} lots=${LOTS_OVERRIDE ?? "volume_min"}\n`);

  // health() first — fail cleanly if the bridge is down (true even on the DRY path).
  let health;
  try {
    health = await client.health();
  } catch (err) {
    console.error(`✗ MT5 bridge unreachable: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!health.ok) {
    console.error(`✗ MT5 bridge not healthy: ${health.error ?? "unknown"} — is mt5_bridge.py running?`);
    process.exit(1);
  }
  console.log(`✓ bridge healthy — trading ${health.tradingEnabled ? "ENABLED" : "disabled (read/validate only)"}`);

  if (!ARMED) {
    console.log(`\nDRY: set GORDON_LIVE_TRADING=1 to actually probe (this posts real, tiny resting limits).`);
    console.log(`     Also start the sidecar with MT5_BRIDGE_ALLOW_TRADING=1, or the bridge guard blocks fills.\n`);
    process.exit(0);
  }

  if (!health.tradingEnabled) {
    console.error(`✗ GORDON_LIVE_TRADING=1 but the bridge has trading disabled — start mt5_bridge.py with MT5_BRIDGE_ALLOW_TRADING=1.`);
    process.exit(1);
  }

  // Resolve per-symbol specs (lots + tick grid).
  const specs = new Map<string, { lots: number; tickSize: number; digits: number }>();
  for (const symbol of SYMBOLS) {
    try {
      const spec = await client.symbol(symbol);
      const lots = LOTS_OVERRIDE ?? spec.volume_min;
      specs.set(symbol, { lots, tickSize: spec.trade_tick_size, digits: spec.digits });
      console.log(`  ${symbol}: lots=${lots} (min ${spec.volume_min}/step ${spec.volume_step}) tick=${spec.trade_tick_size} digits=${spec.digits}`);
    } catch (err) {
      console.log(`  ${symbol}: ⚠ spec unavailable (${(err as Error).message}) — skipping`);
    }
  }

  const results: ProbeResult[] = [];
  for (const symbol of SYMBOLS) {
    const spec = specs.get(symbol);
    if (!spec) continue;
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      try {
        results.push(await probeOne(symbol, cycle, spec.lots, spec.tickSize, spec.digits));
      } catch (err) {
        console.log(`  [${symbol} #${cycle}] cycle error: ${(err as Error).message}`);
      }
    }
  }

  report(results);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
