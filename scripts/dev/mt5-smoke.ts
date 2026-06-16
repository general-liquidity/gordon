#!/usr/bin/env bun
/**
 * MT5 bridge smoke test — proves the Gordon↔MT5 transport against a real account.
 *
 * Prereq: the sidecar is running (scripts/mt5-bridge/mt5_bridge.py) and the MT5
 * terminal is logged into your competition account.
 *
 *   bun run scripts/dev/mt5-smoke.ts                 # read-only: account, quote, depth, bars
 *   bun run scripts/dev/mt5-smoke.ts --symbol EURUSD
 *   bun run scripts/dev/mt5-smoke.ts --trade         # also place+cancel a tiny far-from-market limit
 *
 * The --trade path only fires if the sidecar was started with
 * MT5_BRIDGE_ALLOW_TRADING=1; otherwise it reports the guard and does nothing.
 */

import { Mt5BridgeClient } from "../../src/infra/broker/mt5/bridgeClient.ts";

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}

const symbol = arg("--symbol", "XAUUSD")!;
const doTrade = process.argv.includes("--trade");
const client = new Mt5BridgeClient();

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(16)} ${typeof value === "object" ? JSON.stringify(value) : value}`);
}

async function main(): Promise<void> {
  console.log(`\n── MT5 bridge smoke test (symbol ${symbol}) ──\n`);

  const health = await client.health();
  if (!health.ok) {
    console.error(`✗ bridge not healthy: ${health.error ?? "unknown"}`);
    process.exit(1);
  }
  console.log("✓ health");
  line("account", health.account?.login);
  line("equity", health.account?.equity);
  line("trading", health.tradingEnabled ? "ENABLED" : "disabled (read/validate only)");

  const quote = await client.quote(symbol);
  console.log("✓ quote");
  line("bid / ask", `${quote.bid} / ${quote.ask}`);

  const depth = await client.depth(symbol).catch((e) => {
    console.log(`  (depth unavailable: ${(e as Error).message})`);
    return null;
  });
  if (depth) {
    console.log("✓ depth (L2)");
    line("top bid", depth.bids[0]);
    line("top ask", depth.asks[0]);
  }

  const bars = await client.bars({ symbol, timeframe: "M15", count: 5 });
  console.log(`✓ bars — ${bars.length} × M15`);
  if (bars.length) line("last close", bars[bars.length - 1]!.close);

  const spec = await client.symbol(symbol);
  console.log("✓ symbol spec");
  line("min / step", `${spec.volume_min} / ${spec.volume_step} lots`);

  if (doTrade) {
    console.log("\n── trade round-trip (tiny limit, far from market) ──");
    const farPrice = Number((quote.bid * 0.8).toFixed(spec.digits)); // ~20% below → won't fill
    const placed = await client.placeOrder({
      symbol,
      side: "buy",
      type: "limit",
      volume: spec.volume_min,
      price: farPrice,
      clientOrderId: `smoke_${symbol}`,
    });
    line("place", placed);
    if (placed.executed && placed.order) {
      const canceled = await client.cancel(placed.order);
      line("cancel", canceled);
    } else if (placed.guard) {
      console.log(`  (trading guard active — start the sidecar with MT5_BRIDGE_ALLOW_TRADING=1 to test fills)`);
    }
  }

  console.log("\n✓ smoke test complete\n");
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
