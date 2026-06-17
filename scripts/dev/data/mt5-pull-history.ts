#!/usr/bin/env bun
/**
 * Pull the competition's tradable catalog + historical bars straight through the
 * MT5 bridge (no manual parquet download needed). Run once, with the sidecar up:
 *
 *   bun run scripts/dev/data/mt5-pull-history.ts                       # full catalog, M15, ~1 month
 *   bun run scripts/dev/data/mt5-pull-history.ts --timeframe M5 --count 8640
 *   bun run scripts/dev/data/mt5-pull-history.ts --symbols XAUUSD,EURUSD,BTCUSD
 *
 * Writes to data/momq/:
 *   catalog.json              — every tradable symbol + contract specs
 *   bars/<symbol>_<tf>.json   — OHLC bars per symbol
 *   manifest.json             — what was pulled, counts, date ranges
 *
 * data/momq/ is gitignored — competition data stays local.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Mt5BridgeClient } from "../../../src/infra/broker/mt5/bridgeClient.ts";

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const timeframe = arg("--timeframe", "M15")!;
const count = Number(arg("--count", "3000")); // ~1 month of 24h M15 bars
const outDir = arg("--out", "data/momq")!;
const symbolFilter = arg("--symbols");
const group = arg("--group"); // e.g. "*USD*" to narrow the catalog

const client = new Mt5BridgeClient();

async function main(): Promise<void> {
  mkdirSync(join(outDir, "bars"), { recursive: true });

  console.log("\n── pulling MT5 history ──\n");
  const health = await client.health();
  if (!health.ok) throw new Error(`bridge not healthy: ${health.error ?? "unknown"}`);
  console.log(`✓ account ${health.account?.login} (${health.account?.currency})`);

  const { symbols: catalog } = await client.symbols(group);
  writeFileSync(join(outDir, "catalog.json"), JSON.stringify(catalog, null, 2));
  console.log(`✓ catalog — ${catalog.length} instruments → ${outDir}/catalog.json`);

  const wanted = symbolFilter
    ? symbolFilter.split(",").map((s) => s.trim())
    : catalog.map((s) => s.name);

  const manifest: Array<{ symbol: string; bars: number; from?: number; to?: number; error?: string }> = [];
  for (const symbol of wanted) {
    try {
      const bars = await client.bars({ symbol, timeframe, count });
      writeFileSync(join(outDir, "bars", `${symbol}_${timeframe}.json`), JSON.stringify(bars));
      const from = bars[0]?.time;
      const to = bars[bars.length - 1]?.time;
      manifest.push({ symbol, bars: bars.length, from, to });
      const span = from && to ? `${new Date(from * 1000).toISOString().slice(0, 10)}…${new Date(to * 1000).toISOString().slice(0, 10)}` : "—";
      console.log(`  ${symbol.padEnd(12)} ${String(bars.length).padStart(5)} bars  ${span}`);
    } catch (e) {
      manifest.push({ symbol, bars: 0, error: (e as Error).message });
      console.log(`  ${symbol.padEnd(12)} ✗ ${(e as Error).message}`);
    }
  }

  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify({ timeframe, count, pulledSymbols: manifest.length, instruments: manifest }, null, 2),
  );
  const ok = manifest.filter((m) => m.bars > 0).length;
  console.log(`\n✓ pulled ${ok}/${manifest.length} symbols (${timeframe}) → ${outDir}/bars/\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
