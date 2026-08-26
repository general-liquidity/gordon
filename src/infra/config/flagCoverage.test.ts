/**
 * Phantom-flag guard.
 *
 * Every flag the `manage_flags` tool advertises is an operator-facing promise:
 * "set this and behavior changes". A flag that no code READS is a phantom —
 * the operator toggles it, the UI reports it on, and nothing happens. For a
 * safety toggle that is worse than having no toggle at all, because the
 * operator believes they are protected.
 *
 * This test scans the source for an actual read of each advertised flag.
 * Mentions in comments, docstrings and slash-command help text do NOT count;
 * that is exactly how GORDON_SPRINT_CONTRACT stayed phantom while appearing
 * in four documents.
 *
 * Recognized reads:
 *   resolveFlag("GORDON_X") / resolveFlag(SOME_CONST)
 *   env.GORDON_X / env["GORDON_X"] / env[SOME_CONST]
 *   process.env.GORDON_X / process.env["GORDON_X"]
 * where SOME_CONST is any identifier assigned the flag's literal string.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dir, "..", "..");
const FLAG_DECLARATION_FILE = join(
  SRC_ROOT,
  "infra",
  "agents",
  "tools",
  "runtime",
  "flow",
  "system.ts",
);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
      out.push(full);
    }
  }
  return out;
}

/**
 * Flag names advertised by the `manage_flags` KEEPER_FLAGS table. Parsed out
 * of the declaring file rather than imported, because the table is a private
 * const. Parsing keeps this test in sync when a flag is added or removed.
 */
function advertisedFlags(): string[] {
  const src = readFileSync(FLAG_DECLARATION_FILE, "utf-8");
  const start = src.indexOf("const KEEPER_FLAGS");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("] as const;", start);
  expect(end).toBeGreaterThan(start);
  const table = src.slice(start, end);
  return [...table.matchAll(/name:\s*"(GORDON_[A-Z0-9_]+)"/g)].map((m) => m[1]!);
}

/** Identifiers bound to a flag literal, e.g. `const X_ENV = "GORDON_X";`. */
function aliasesFor(flag: string, files: string[]): Set<string> {
  const aliases = new Set<string>();
  const pattern = new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*"${flag}"`, "g");
  for (const file of files) {
    for (const m of readFileSync(file, "utf-8").matchAll(pattern)) {
      aliases.add(m[1]!);
    }
  }
  return aliases;
}

function readPatterns(flag: string, aliases: Set<string>): RegExp[] {
  const names = [`"${flag}"`, `'${flag}'`, ...aliases];
  const patterns: RegExp[] = [
    new RegExp(`\\benv\\.${flag}\\b`),
    new RegExp(`\\bprocess\\.env\\.${flag}\\b`),
  ];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patterns.push(new RegExp(`resolveFlag\\(\\s*${escaped}\\s*\\)`));
    patterns.push(new RegExp(`env\\[\\s*${escaped}\\s*\\]`));
  }
  return patterns;
}

/** Strip line and block comments so a docstring mention never counts as a read. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("advertised flags are actually read", () => {
  const files = collectSourceFiles(SRC_ROOT).filter((f) => f !== FLAG_DECLARATION_FILE);
  const bodies = new Map(files.map((f) => [f, stripComments(readFileSync(f, "utf-8"))]));
  const flags = advertisedFlags();

  test("the flag table parses", () => {
    expect(flags.length).toBeGreaterThan(10);
  });

  for (const flag of flags) {
    test(`${flag} is read by at least one module`, () => {
      const aliases = aliasesFor(flag, files);
      const patterns = readPatterns(flag, aliases);
      const readers = [...bodies.entries()]
        .filter(([, body]) => patterns.some((p) => p.test(body)))
        .map(([file]) => file);
      expect(readers.length).toBeGreaterThan(0);
    });
  }
});
