#!/usr/bin/env bun
/**
 * ARMED-PATH taker smoke — validates the ONE thing the competition account can't (trading is
 * disabled there until launch): that when ARMED, a single market order round-trips the full
 * chain — place → fill → position → slippage-vs-mid → close — and leaves NO residual.
 *
 * Run it against a free MetaQuotes-Demo account (trading enabled) to prove the plumbing fires
 * before you ever arm against the real competition account. This is PLUMBING validation, NOT
 * performance: demo fills/slippage do NOT predict competition fills (different broker + the
 * competition's blended/simulated pricing).
 *
 *   bun run scripts/dev/mt5/armed-order-smoke.ts                       # DRY unless GORDON_LIVE_TRADING=1
 *   GORDON_LIVE_TRADING=1 bun run scripts/dev/mt5/armed-order-smoke.ts
 *
 * DOUBLE SAFETY GUARD — both required for a real order:
 *   GORDON_LIVE_TRADING=1       (this process)
 *   MT5_BRIDGE_ALLOW_TRADING=1  (the sidecar; mt5_bridge.py)
 * Point the sidecar at a DEMO account for this. NEVER run it armed against the competition
 * account before launch.
 *
 * Config: SMOKE_SYMBOL (default EURUSD), SMOKE_SIDE (buy|sell, default buy),
 *         SMOKE_LOTS (default = the symbol's volume_min).
 */

import { Mt5BridgeClient, type Mt5Position } from "../../../src/infra/broker/mt5/bridgeClient.ts";

const SYMBOL = process.env.SMOKE_SYMBOL ?? "EURUSD";
const SIDE = (process.env.SMOKE_SIDE ?? "buy") as "buy" | "sell";
const LOTS_OVERRIDE = process.env.SMOKE_LOTS ? Number(process.env.SMOKE_LOTS) : undefined;
const ARMED = process.env.GORDON_LIVE_TRADING === "1";
const WAIT_S = 15;
const POLL_MS = 1_000;

const client = new Mt5BridgeClient();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("\n── ARMED-PATH taker smoke (single tiny market order, self-closing) ──\n");

  let health;
  try {
    health = await client.health();
  } catch (err) {
    console.error(`✗ MT5 bridge unreachable: ${(err as Error).message} — is mt5_bridge.py running?`);
    process.exit(1);
  }
  if (!health.ok) {
    console.error(`✗ bridge not healthy: ${health.error ?? "unknown"}`);
    process.exit(1);
  }
  console.log(`✓ bridge healthy — account ${health.account?.login ?? "?"} — trading ${health.tradingEnabled ? "ENABLED" : "disabled (read/validate only)"}`);

  if (!ARMED) {
    console.log("\nDRY: set GORDON_LIVE_TRADING=1 to actually place ONE tiny market order.");
    console.log("     Point the sidecar at a MetaQuotes-Demo account and start it with MT5_BRIDGE_ALLOW_TRADING=1.");
    console.log("     NEVER arm this against the competition account before launch.\n");
    process.exit(0);
  }
  if (!health.tradingEnabled) {
    console.error("✗ GORDON_LIVE_TRADING=1 but the bridge has trading disabled — start mt5_bridge.py with MT5_BRIDGE_ALLOW_TRADING=1 (demo account).");
    process.exit(1);
  }

  const spec = await client.symbol(SYMBOL);
  const lots = LOTS_OVERRIDE ?? spec.volume_min;
  const q0 = await client.quote(SYMBOL);
  if (!(q0.bid > 0 && q0.ask > 0)) {
    console.error(`✗ ${SYMBOL} feed off (bid/ask 0) — pick a liquid SMOKE_SYMBOL or check Market Watch.`);
    process.exit(1);
  }
  const mid0 = (q0.bid + q0.ask) / 2;
  console.log(`\nplacing ${SIDE} ${lots} ${SYMBOL} @ market (pre-trade mid ${mid0})`);

  const placed = await client.placeOrder({
    symbol: SYMBOL,
    side: SIDE,
    type: "market",
    volume: lots,
    filling: "ioc",
    clientOrderId: `armedsmoke_${SYMBOL}`,
  });
  if (!placed.executed) {
    const why = placed.guard ? `guard=${placed.guard}` : placed.comment ?? `retcode=${placed.retcode ?? "?"}`;
    console.error(`✗ order REJECTED (${why})`);
    process.exit(1);
  }
  console.log(`✓ order accepted (ticket ${placed.order ?? "?"})`);

  const wantSide = SIDE === "buy" ? "long" : "short";
  let posn: Mt5Position | undefined;
  const deadline = Date.now() + WAIT_S * 1000;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const positions = await client.positions();
    posn = positions.find((p) => p.symbol === SYMBOL && p.sideLabel === wantSide);
    if (posn) break;
  }
  if (!posn) {
    console.error(`✗ no ${wantSide} ${SYMBOL} position appeared within ${WAIT_S}s — CHECK THE TERMINAL MANUALLY`);
    process.exit(1);
  }
  // Taker slippage vs the pre-trade mid: a buy fills at/above mid, a sell at/below → both POSITIVE = paid.
  const slipBps = ((posn.price_open - mid0) / mid0) * 1e4 * (SIDE === "buy" ? 1 : -1);
  console.log(`✓ FILLED @ ${posn.price_open} (ticket ${posn.ticket}) — slippage vs mid ${slipBps.toFixed(2)}bps (taker pays ~½-spread)`);

  const closed = await client.close(posn.ticket, posn.volume);
  if (!closed.executed) {
    console.error(`✗ CLOSE not confirmed (${closed.comment ?? closed.guard ?? "?"}) — FLATTEN ticket ${posn.ticket} MANUALLY NOW`);
    process.exit(1);
  }
  console.log(`✓ closed — book flat again`);

  console.log("\n✓ ARMED-PATH SMOKE PASSED — place → fill → position → slippage → close round-tripped cleanly.");
  console.log("  PLUMBING only: demo fills/slippage do NOT predict competition fills.\n");
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
