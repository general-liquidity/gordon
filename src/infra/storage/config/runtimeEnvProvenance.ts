import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isAllowedCwdEnvKey } from "./envTrustPolicy.ts";

const BUN_IMPLICIT_DOTENV_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
]);

export function isBunCompiledMain(main: string): boolean {
  const normalized = main.replace(/\\/g, "/");
  return /^(?:(?:[A-Za-z]:)?\/~BUN\/root\/|\/\$bunfs\/root\/)/.test(normalized);
}

function isCompiledRuntime(): boolean {
  // Bun uses /~BUN/root on Windows and /$bunfs/root on POSIX for the embedded
  // entry. This virtual path is the runtime invariant; argv/execPath layouts
  // differ by platform. Release builds disable both dotenv and bunfig autoload.
  return typeof Bun !== "undefined" && isBunCompiledMain(Bun.main);
}

function forbiddenCwdEnvKeys(): string[] {
  const keys = new Set<string>();
  const cwd = process.cwd();
  // Bun implicitly loads .env, .env.local and NODE_ENV-specific variants,
  // including their mode-local forms.
  // Scan every dotenv-named candidate instead of trusting process.env.NODE_ENV,
  // whose value may itself already have come from one of these files.
  const candidates: string[] = [];
  for (const name of BUN_IMPLICIT_DOTENV_NAMES) {
    const path = join(cwd, name);
    try {
      // Check the exact implicit name, including a symlink. readFileSync below
      // follows it just as Bun does.
      lstatSync(path);
      candidates.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  for (const path of candidates) {
    // readFile follows symlinks, matching Bun. Any unreadable filesystem
    // candidate throws and therefore fails startup closed.
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      const name = match?.[1];
      if (name && !isAllowedCwdEnvKey(name)) keys.add(name);
    }
  }
  return [...keys].sort();
}

/**
 * Refuse ambiguous Bun dotenv state before any Gordon control reads it.
 *
 * Bun loads cwd dotenv files before source modules execute. At that point an
 * identical shell value and an injected value are observationally
 * indistinguishable, so no argv/env/fd marker can safely certify provenance:
 * every source launch rejects a non-credential cwd key. The Node launcher also
 * pre-scans for a clearer error, then starts Bun with --no-env-file and an
 * explicit Gordon-owned config. Compiled releases are trusted because their
 * build disables dotenv autoload in the executable itself.
 */
export function assertRuntimeEnvProvenance(): void {
  if (isCompiledRuntime()) return;

  const forbidden = forbiddenCwdEnvKeys();
  if (forbidden.length === 0) return;
  throw new Error(
    `refusing Gordon startup: an implicit cwd dotenv file contains non-credential keys (${forbidden.join(
      ", ",
    )}). Move those controls to ~/.gordon/.env or the Gordon settings store.`,
  );
}

export function resetRuntimeEnvProvenanceForTesting(): void {
  // Retained for callers that reset adjacent config caches. Provenance has no
  // mutable success token: every source launch is checked from disk.
}
