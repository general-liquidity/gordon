/**
 * Centralized path management for Gordon CLI
 *
 * Respects XDG Base Directory spec and GORDON_HOME override.
 * All modules should import GORDON_DIR from here instead of computing it locally.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the Gordon data directory path.
 *
 * Resolution order:
 * 1. GORDON_HOME env var (explicit override)
 * 2. XDG_CONFIG_HOME/gordon (XDG Base Directory spec)
 * 3. ~/.gordon (backward-compatible default)
 */
export function getGordonDir(): string {
  if (process.env.GORDON_HOME) return process.env.GORDON_HOME;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "gordon");
  return join(homedir(), ".gordon");
}

/** Pre-resolved Gordon directory for the current process */
export const GORDON_DIR = getGordonDir();
