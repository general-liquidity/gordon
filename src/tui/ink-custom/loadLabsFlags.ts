/**
 * loadLabsFlags — merge persisted experimental flags into process.env.
 *
 * Read once at startup. Precedence:
 *   1. existing process.env value (env var wins) — never overwrite.
 *   2. labs.json persisted value — only set when env is unset.
 *
 * The on-disk format (~/.gordon/labs.json):
 *   { "flags": { "GORDON_CUSTOM_RENDER": "true", ... } }
 *
 * Errors are swallowed. Diagnostics never block startup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface LabsFile {
  flags: Record<string, "true" | "false">;
}

function gordonDir(): string {
  if (process.env.GORDON_HOME) return process.env.GORDON_HOME;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "gordon");
  return path.join(os.homedir(), ".gordon");
}

function labsPath(): string {
  return path.join(gordonDir(), "labs.json");
}

let merged = false;

/**
 * Read labs.json (if present) and merge any flags into process.env that are
 * not already set. Idempotent. Returns the names of flags that were merged.
 */
export function loadLabsFlagsIntoEnv(): string[] {
  if (merged) return [];
  merged = true;
  let file: LabsFile;
  try {
    const raw = fs.readFileSync(labsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LabsFile>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.flags ||
      typeof parsed.flags !== "object"
    ) {
      return [];
    }
    file = { flags: parsed.flags as Record<string, "true" | "false"> };
  } catch {
    // No file yet, or parse error — nothing to do.
    return [];
  }

  const applied: string[] = [];
  for (const [name, value] of Object.entries(file.flags)) {
    // Env var wins; only fill when unset.
    if (process.env[name] !== undefined && process.env[name] !== "") continue;
    if (value === "true") {
      process.env[name] = "1";
      applied.push(name);
    } else {
      // Persisted "false" — leave env unset so downstream truthy checks are unaffected.
    }
  }
  return applied;
}

/** Test-only — reset the idempotency latch. */
export function _resetLoadLabsFlagsLatch(): void {
  merged = false;
}
