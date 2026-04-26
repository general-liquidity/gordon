#!/usr/bin/env bun
/**
 * Build script for Gordon CLI.
 *
 * Replaces the monster one-liner in package.json that was echoing 6 externals
 * into every `npm run build` output. Package.json now just calls this file.
 *
 * Modes:
 *   bun scripts/build.ts             → bundle to dist/entry.js (default)
 *   bun scripts/build.ts --binary    → compile standalone binary
 *
 * Externals — native/runtime deps that must not be bundled. Moving these
 * out of the argv list into an array makes them easy to read and keeps
 * the build command short.
 */

import { resolve } from "node:path";

const EXTERNALS = [
  "@lightprotocol/compressed-token",
  "@lightprotocol/stateless.js",
  "@solana-developers/helpers",
  "@galacticcouncil/api-augment/hydradx",
  "@galacticcouncil/api-augment/basilisk",
  "@polkadot-agent-kit/sdk",
];

const ROOT = resolve(import.meta.dirname, "..", "..");
const ENTRY = resolve(ROOT, "src/entry.ts");

const args = process.argv.slice(2);
const binary = args.includes("--binary");

if (binary) {
  // Compile to a single standalone executable via `bun build --compile`.
  // Binary compile still needs the CLI flags, not the Bun.build() API.
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      ENTRY,
      "--compile",
      "--outfile",
      resolve(ROOT, "gordon"),
      ...EXTERNALS.flatMap((e) => ["--external", e]),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await proc.exited;
  process.exit(exitCode);
}

// Library bundle path — use the programmatic Bun.build() API.
const result = await Bun.build({
  entrypoints: [ENTRY],
  outdir: resolve(ROOT, "dist"),
  target: "bun",
  external: EXTERNALS,
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Match `bun build` CLI output format.
let totalBytes = 0;
for (const output of result.outputs) {
  totalBytes += output.size;
}

const sizeStr = totalBytes >= 1_000_000
  ? `${(totalBytes / 1_000_000).toFixed(2)} MB`
  : `${(totalBytes / 1_000).toFixed(0)} KB`;

console.log(`Bundled ${result.outputs.length} output${result.outputs.length === 1 ? "" : "s"} (${sizeStr})`);
