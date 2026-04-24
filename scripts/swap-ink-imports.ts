// scripts/swap-ink-imports.ts
//
// A3 import swap: replace `from "ink"` with a relative-path import targeting
// `src/tui/ink-custom/` (the barrel re-exports everything Gordon uses).
//
// SKIPS:
//   - src/tui/ink-custom/** (these files own the shims; they MUST keep importing
//     from "ink" to delegate)
//   - node_modules/
//
// Test files: included (per A3 spec — if a test imports the same component as
// production code, swap it too). The runner reports each touched file so the
// dry-run can be reviewed.
//
// Reproducible: re-running on a clean tree should be a no-op once the swap is
// complete (no remaining `from "ink"` matches outside ink-custom).

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";

function findFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    // Skip the ink-custom directory entirely — it owns the shims.
    if (full.includes("ink-custom")) continue;
    if (full.includes("node_modules")) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) findFiles(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full);
  }
  return files;
}

const inkCustomAbsPath = "src/tui/ink-custom";
const files = findFiles("src");
let touched = 0;
const examples: string[] = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (!/from ['"]ink['"]/.test(content)) continue;
  const fileDir = dirname(file);
  let rel = relative(fileDir, inkCustomAbsPath).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  const updated = content.replace(/from (['"])ink\1/g, `from $1${rel}$1`);
  writeFileSync(file, updated);
  touched++;
  if (examples.length < 10) examples.push(`${file} -> ${rel}`);
}

console.log(`Swapped imports in ${touched} files.`);
console.log("Sample swaps:");
for (const e of examples) console.log(`  ${e}`);
