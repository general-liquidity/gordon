/**
 * Centralized path management for Gordon CLI
 *
 * Respects XDG Base Directory spec and GORDON_HOME override.
 * All modules should import GORDON_DIR from here instead of computing it locally.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolveGordonDir(): string {
  if (process.env.GORDON_HOME) return process.env.GORDON_HOME;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "gordon");
  return join(homedir(), ".gordon");
}

let ensuredDir: string | null = null;

/**
 * Idempotently creates the Gordon home directory so any subsequent write under
 * it succeeds. On a fresh install (and in clean CI where ~/.gordon does not yet
 * exist) the directory is absent, and flat-file writers that target
 * GORDON_DIR/<file> would otherwise fail with ENOENT. Subdir writers already
 * recursive-mkdir their own subdirectory (which creates the base too); this
 * closes the gap for the base directory and every flat-file writer.
 *
 * Best-effort: individual write sites still guard their own directories, so a
 * transient failure here never blocks a write that can create its own path.
 */
export function ensureGordonHome(): string {
  const dir = resolveGordonDir();
  // Re-check whenever the resolved dir changes (tests point GORDON_HOME at a
  // temp dir per case) or the directory has since been removed.
  if (dir !== ensuredDir || !existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
      ensuredDir = dir;
    } catch {
      /* best-effort; write sites still guard */
    }
  }
  return dir;
}

/**
 * Resolves the Gordon data directory path, creating it if it does not exist.
 *
 * Resolution order:
 * 1. GORDON_HOME env var (explicit override)
 * 2. XDG_CONFIG_HOME/gordon (XDG Base Directory spec)
 * 3. ~/.gordon (backward-compatible default)
 *
 * The directory is ensured on resolution so every consumer that computes a
 * ~/.gordon path can write into it on a fresh install without ENOENT.
 */
export function getGordonDir(): string {
  return ensureGordonHome();
}

/**
 * Pre-resolved Gordon directory for the current process.
 *
 * Deliberately a PURE path computation: doing filesystem I/O at module-import
 * time runs before any test's setup can redirect the home, and the resulting
 * first-import path would be cached for the whole process. Directory creation
 * happens at write time via ensureGordonHome() / getGordonDir() instead.
 */
export const GORDON_DIR = resolveGordonDir();
