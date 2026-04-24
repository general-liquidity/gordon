#!/usr/bin/env bun
/**
 * Sweep every .tsx file in src/ through the React Compiler and report:
 *   - how many compiled cleanly,
 *   - how many bailed out (compiler refused — usually a hook violation),
 *   - the first ~20 bail-out reasons grouped by message.
 *
 * Usage:
 *   bun scripts/sweep-react-compiler.ts            # walks src/, prints summary
 *   bun scripts/sweep-react-compiler.ts --verbose  # also prints per-file errors
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "src");
const VERBOSE = process.argv.includes("--verbose");

const { transformAsync } = require("@babel/core") as {
  transformAsync: (code: string, opts: Record<string, unknown>) => Promise<{ code?: string | null } | null>;
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (s.isFile() && p.endsWith(".tsx")) yield p;
  }
}

const files = [...walk(SRC)];
const warnings: { file: string; msg: string }[] = [];
let compiled = 0;
let skipped = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  try {
    const result = await transformAsync(source, {
      configFile: false,
      babelrc: false,
      filename: file,
      sourceType: "module",
      presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
      plugins: [["babel-plugin-react-compiler", { target: "19" }]],
    });
    const code = result?.code ?? "";
    if (code.includes("react/compiler-runtime") || code.includes("useMemoCache")) {
      compiled++;
    } else {
      // Compiler ran but emitted no memoization — likely the file has
      // no React component or the compiler bailed silently.
      skipped++;
    }
  } catch (err) {
    const msg = (err as Error).message.split("\n")[0] ?? "(no message)";
    warnings.push({ file: relative(ROOT, file), msg });
  }
}

console.log("");
console.log(`React Compiler sweep: ${files.length} .tsx files`);
console.log(`  compiled (memo emitted): ${compiled}`);
console.log(`  skipped  (no JSX/components): ${skipped}`);
console.log(`  warnings (bail-out): ${warnings.length}`);

if (warnings.length > 0) {
  console.log("\nTop bail-out reasons:");
  const grouped = new Map<string, string[]>();
  for (const { file, msg } of warnings) {
    // Strip variable bits to group similar messages.
    const key = msg.replace(/\(\d+:\d+\)/g, "(_:_)").slice(0, 120);
    const arr = grouped.get(key) ?? [];
    arr.push(file);
    grouped.set(key, arr);
  }
  const sorted = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [msg, fileList] of sorted.slice(0, 20)) {
    console.log(`\n  [${fileList.length}] ${msg}`);
    if (VERBOSE) {
      for (const f of fileList.slice(0, 5)) console.log(`        ${f}`);
      if (fileList.length > 5) console.log(`        ... +${fileList.length - 5} more`);
    }
  }
}
