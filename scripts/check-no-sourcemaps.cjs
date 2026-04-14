#!/usr/bin/env node
/**
 * CI Source Map Guardrail
 *
 * Fails the build if ANY .map file exists under dist/ or npm/lib/.
 *
 * This is the single most important guardrail against the Claude Code class
 * of leak: Anthropic shipped cli.mjs.map files containing sourcesContent
 * (the full TypeScript source) on npm. Once published, you can't take it
 * back. Better to fail the release than ship a leak.
 *
 * Usage:
 *   node scripts/check-no-sourcemaps.cjs
 *
 * Exit codes:
 *   0  no .map files found
 *   1  one or more .map files found (build should fail)
 *   2  one of the directories doesn't exist (warn, treated as soft pass —
 *      the directory may not have been built yet)
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIRECTORIES_TO_CHECK = [
  path.join(ROOT, "dist"),
  path.join(ROOT, "npm", "lib"),
  path.join(ROOT, "npm", "vendor"),
];

function findMapFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findMapFiles(full));
    } else if (entry.name.endsWith(".map")) {
      found.push(full);
    }
  }
  return found;
}

let totalFound = 0;
const allFound = [];
let anyDirExists = false;

for (const dir of DIRECTORIES_TO_CHECK) {
  if (!fs.existsSync(dir)) continue;
  anyDirExists = true;
  const found = findMapFiles(dir);
  totalFound += found.length;
  allFound.push(...found);
}

if (!anyDirExists) {
  console.warn("[check-no-sourcemaps] no build output found — soft pass");
  console.warn("[check-no-sourcemaps] expected one of:");
  for (const dir of DIRECTORIES_TO_CHECK) {
    console.warn(`  ${path.relative(ROOT, dir)}`);
  }
  process.exit(2);
}

if (totalFound > 0) {
  console.error("");
  console.error("┌──────────────────────────────────────────────────────────────────┐");
  console.error("│  SOURCE MAP LEAK GUARDRAIL — BUILD FAILED                        │");
  console.error("├──────────────────────────────────────────────────────────────────┤");
  console.error("│  .map files were found in the build output. Source maps with     │");
  console.error("│  embedded sourcesContent are equivalent to publishing source     │");
  console.error("│  code. This is exactly how Claude Code's source leaked in 2026.  │");
  console.error("│                                                                  │");
  console.error("│  Either:                                                         │");
  console.error("│    1. Pass --no-sourcemap to your bundler (Bun: don't pass       │");
  console.error("│       --sourcemap; esbuild: --sourcemap=false)                   │");
  console.error("│    2. Delete the .map files before publish                       │");
  console.error("│    3. Add .map to .npmignore (less safe — files field is        │");
  console.error("│       stronger but only works if files whitelist is correct)    │");
  console.error("└──────────────────────────────────────────────────────────────────┘");
  console.error("");
  console.error("Files found:");
  for (const f of allFound) {
    console.error(`  ✗ ${path.relative(ROOT, f)}`);
  }
  console.error("");
  process.exit(1);
}

console.log(`[check-no-sourcemaps] ✓ no .map files in ${DIRECTORIES_TO_CHECK.map((d) => path.relative(ROOT, d)).join(", ")}`);
process.exit(0);
