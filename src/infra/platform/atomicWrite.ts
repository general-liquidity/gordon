/**
 * Lock-Based Atomic File Writes
 *
 * Safe concurrent file writes using advisory locks. Prevents corruption
 * when multiple agents write to the same audit file simultaneously.
 *
 * Claude Code pattern: file locking with stale detection, retries, and
 * graceful fallback on lock timeout.
 *
 * Lock files: {target}.lock — contains PID + timestamp.
 * Stale detection: if lock file is older than staleMs, it's considered
 * abandoned and forcibly removed.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

// ============================================================================
// Types
// ============================================================================

export interface LockOptions {
  /** Max time a lock is valid before considered stale. Default 10000ms. */
  staleMs?: number;
  /** Number of retry attempts. Default 3. */
  retries?: number;
  /** Min wait between retries. Default 50ms. */
  minTimeout?: number;
  /** Max wait between retries. Default 500ms. */
  maxTimeout?: number;
}

const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  staleMs: 10_000,
  retries: 3,
  minTimeout: 50,
  maxTimeout: 500,
};

// ============================================================================
// Lock Acquisition
// ============================================================================

function lockPath(filePath: string): string {
  return `${resolve(filePath)}.lock`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Try to acquire an advisory lock. Returns true if acquired.
 */
function tryAcquireLock(filePath: string, staleMs: number): boolean {
  const lock = lockPath(filePath);

  // Check for existing lock
  if (existsSync(lock)) {
    try {
      const content = readFileSync(lock, "utf-8");
      const [, timestampStr] = content.split(":");
      const timestamp = parseInt(timestampStr ?? "0", 10);
      const age = Date.now() - timestamp;

      if (age < staleMs) {
        return false; // Lock is valid, someone else holds it
      }

      // Stale lock — remove it
      unlinkSync(lock);
    } catch {
      // Corrupt lock file — remove it
      try {
        unlinkSync(lock);
      } catch {
        /* ignore */
      }
    }
  }

  // Try to create lock atomically
  try {
    writeFileSync(lock, `${process.pid}:${Date.now()}`, { flag: "wx", encoding: "utf-8" });
    return true;
  } catch {
    return false; // Another process beat us
  }
}

/**
 * Release the advisory lock.
 */
function releaseLock(filePath: string): void {
  try {
    unlinkSync(lockPath(filePath));
  } catch {
    // Already released or never acquired
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Write to a file with advisory locking. Retries on lock contention.
 *
 * @param filePath - Target file path
 * @param writer - Function that performs the actual write (receives filePath)
 * @param options - Lock options
 * @returns true if write succeeded, false if lock could not be acquired
 */
export async function withFileLock(
  filePath: string,
  writer: (path: string) => void,
  options?: LockOptions,
): Promise<boolean> {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (tryAcquireLock(filePath, opts.staleMs)) {
      try {
        writer(filePath);
        return true;
      } finally {
        releaseLock(filePath);
      }
    }

    if (attempt < opts.retries) {
      await sleep(randomBetween(opts.minTimeout, opts.maxTimeout));
    }
  }

  return false; // All retries exhausted
}

/**
 * Atomic write: write content to file with lock protection.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  options?: LockOptions,
): Promise<boolean> {
  return withFileLock(
    filePath,
    (path) => {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
    },
    options,
  );
}

/**
 * Atomic append: append content to file with lock protection.
 */
export async function atomicAppendFile(
  filePath: string,
  content: string,
  options?: LockOptions,
): Promise<boolean> {
  return withFileLock(
    filePath,
    (path) => {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
    },
    options,
  );
}

/**
 * Atomic JSON write: read-modify-write a JSON file with lock protection.
 */
export async function atomicJsonUpdate<T>(
  filePath: string,
  updater: (current: T | null) => T,
  options?: LockOptions,
): Promise<boolean> {
  return withFileLock(
    filePath,
    (path) => {
      let current: T | null = null;
      if (existsSync(path)) {
        try {
          current = JSON.parse(readFileSync(path, "utf-8")) as T;
        } catch {
          current = null;
        }
      }
      const updated = updater(current);
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify(updated, null, 2), { encoding: "utf-8", mode: 0o600 });
    },
    options,
  );
}
