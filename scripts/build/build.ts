#!/usr/bin/env bun
/**
 * Build script for Gordon CLI.
 *
 * Replaces the monster one-liner in package.json that was echoing 6 externals
 * into every `npm run build` output. Package.json now just calls this file.
 *
 * Modes:
 *   bun scripts/build.ts             → bundle to dist/entry.js (default)
 *   bun scripts/build.ts --binary    → compile standalone binary (host target)
 *   bun scripts/build.ts --binary --target bun-linux-x64 --outfile gordon-linux-x64
 *                                    → cross-compile a named target (release matrix)
 *
 * Externals — native/runtime deps that must not be bundled. Gordon currently
 * has none: the old list existed solely for Solana packages that were declared
 * but never imported. Keeping the array makes that decision explicit and keeps
 * the release and local build paths identical if a real native dependency is
 * added later.
 */

import { resolve } from "node:path";

const EXTERNALS: string[] = [];

const ROOT = resolve(import.meta.dirname, "..", "..");
const ENTRY = resolve(ROOT, "src/entry.ts");
const ACP_ENTRY = resolve(ROOT, "src/app/acp-entry.ts");
const MCP_ENTRY = resolve(ROOT, "src/infra/ai/mcp/serveCli.ts");

const args = process.argv.slice(2);
const binary = args.includes("--binary");

function flagValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

if (binary) {
  // Compile to a single standalone executable via `bun build --compile`.
  // Binary compile still needs the CLI flags, not the Bun.build() API.
  //
  // --target / --outfile let the release matrix cross-compile every platform
  // through THIS script, so the shipped binary carries the exact same EXTERNALS
  // list as a local `bun run build:binary` (no drift between CI and local).
  const target = flagValue("--target"); // e.g. bun-linux-x64, bun-windows-x64
  const outfile = flagValue("--outfile") ?? resolve(ROOT, "gordon");

  const compileArgs = [
    process.execPath,
    "build",
    ENTRY,
    "--compile",
    // Compiled Bun executables otherwise autoload <cwd>/.env and bunfig.toml
    // before Gordon can apply its source-aware trust-boundary checks.
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--outfile",
    outfile,
    ...(target ? ["--target", target] : []),
    ...EXTERNALS.flatMap((e) => ["--external", e]),
  ];

  const proc = Bun.spawn(compileArgs, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}

// Library bundle path — use the programmatic Bun.build() API.
const result = await Bun.build({
  entrypoints: [ENTRY, ACP_ENTRY, MCP_ENTRY],
  outdir: resolve(ROOT, "dist"),
  naming: "[name].[ext]",
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

const sizeStr =
  totalBytes >= 1_000_000
    ? `${(totalBytes / 1_000_000).toFixed(2)} MB`
    : `${(totalBytes / 1_000).toFixed(0)} KB`;

console.log(
  `Bundled ${result.outputs.length} output${result.outputs.length === 1 ? "" : "s"} (${sizeStr})`,
);
