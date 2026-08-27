/**
 * Completeness guard for the `/flags` registry.
 *
 * A safety gate the operator cannot see is a gate the operator cannot reason
 * about. Every boolean flag reader under `src/infra/safety/` therefore has to
 * appear in `KEEPER_FLAGS`, and this test derives the expected set from the
 * source rather than from the registry, so a newly added gate fails here
 * instead of quietly shipping invisible.
 *
 * The scan is deliberately structural: it finds `is*Enabled` readers, takes
 * each reader's body, and resolves the GORDON_ flags it touches either as
 * literals or through the module's own `const X_ENV = "GORDON_..."` bindings.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { KEEPER_FLAGS } from "./system.ts";

const SAFETY_DIR = join(import.meta.dir, "../../../../safety");

/** Not toggles: file locations and enum-valued modes are configuration. */
function isToggleName(flag: string): boolean {
  return !flag.endsWith("_PATH") && !flag.endsWith("_MODE") && !flag.endsWith("_URL");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Body of a function starting at `open`, matched by brace depth. */
function functionBody(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

interface ReaderFlag {
  file: string;
  reader: string;
  flag: string;
}

function readerFlags(): ReaderFlag[] {
  const found: ReaderFlag[] = [];
  for (const file of sourceFiles(SAFETY_DIR)) {
    const source = readFileSync(file, "utf8");

    const constants = new Map<string, string>();
    for (const match of source.matchAll(
      /(?:const|let)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*"(GORDON_[A-Z0-9_]+)"/g,
    )) {
      constants.set(match[1] as string, match[2] as string);
    }

    for (const match of source.matchAll(/export function (is[A-Za-z0-9]*Enabled)\s*\(/g)) {
      const brace = source.indexOf("{", match.index + match[0].length);
      if (brace === -1) continue;
      const body = functionBody(source, brace);

      const flags = new Set<string>();
      for (const literal of body.matchAll(/GORDON_[A-Z0-9_]+/g)) flags.add(literal[0]);
      for (const indexed of body.matchAll(/\[\s*([A-Za-z0-9_]+)\s*\]/g)) {
        const resolved = constants.get(indexed[1] as string);
        if (resolved) flags.add(resolved);
      }
      for (const flag of flags) {
        if (isToggleName(flag)) {
          found.push({ file, reader: match[1] as string, flag });
        }
      }
    }
  }
  return found;
}

describe("the /flags registry covers every safety gate", () => {
  const discovered = readerFlags();

  test("the scan actually finds the safety readers", () => {
    // Guards the regexes: an empty or tiny result would make the assertion
    // below pass without checking anything.
    expect(discovered.length).toBeGreaterThanOrEqual(15);
    expect(new Set(discovered.map((d) => d.reader)).size).toBeGreaterThanOrEqual(15);
    expect(discovered.map((d) => d.flag)).toContain("GORDON_KILL_SWITCHES");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_ABSORBING_BARRIER");
  });

  test("every flag a safety reader gates on is listed in /flags", () => {
    const registered = new Set<string>(KEEPER_FLAGS.map((f) => f.name));
    const missing = discovered
      .filter((d) => !registered.has(d.flag))
      .map((d) => `${d.flag} (${d.reader})`);

    expect([...new Set(missing)]).toEqual([]);
  });

  test("registry rows are unique and named GORDON_*", () => {
    const names = KEEPER_FLAGS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith("GORDON_")).toBe(true);
  });
});

describe("registry defaults match their readers", () => {
  /**
   * The rows that must read default-ON, because their reader treats an unset
   * value as enabled (`raw !== "0" && raw !== "false"`). Declaring these off
   * told the operator a protective gate was inactive while it was running.
   */
  const DEFAULT_ON = [
    "GORDON_WIP_LIMIT_ENABLED",
    "GORDON_STREAK_CIRCUIT_BREAKER",
    "GORDON_GIVE_BACK_STOP",
    "GORDON_ABSORBING_BARRIER",
    "GORDON_KILL_SWITCHES",
    "GORDON_NETWORK_ALLOWLIST",
    "GORDON_FILESYSTEM_WRITE_GUARD",
    "GORDON_TOOL_FREE_THINKING",
    "GORDON_ADVERSARIAL_EVALUATOR",
    "GORDON_CITATION_AGENT",
    "GORDON_AUTODREAM_ENABLED",
    "GORDON_REFLECTION_ENABLED",
  ];

  for (const name of DEFAULT_ON) {
    test(`${name} is declared default-on`, () => {
      const row = KEEPER_FLAGS.find((f) => f.name === name);
      expect(row?.defaultOn).toBe(true);
    });
  }

  test("GORDON_PEER_DELEGATION is declared default-off, matching its reader", () => {
    const row = KEEPER_FLAGS.find((f) => f.name === "GORDON_PEER_DELEGATION");
    expect(row?.defaultOn).toBe(false);
  });
});
