/**
 * Structural test isolation for Gordon's persistent stores.
 *
 * Any test file that can reach the positions / plans / trades SQLite store —
 * directly or transitively (e.g. through execute_plan, whose position-FSM
 * sync is fire-and-forget) — MUST call installTempGordonHome() at module
 * scope. Without it, unit tests write rows into the operator's REAL
 * ~/.gordon/gordon.db (39 phantom positions were traced to exactly this).
 *
 * beforeEach: fresh temp GORDON_HOME + temp SQLite path + position-store
 * singleton reset — isolation is structural, not per-test cleanup.
 * afterAll: restores env + DB override and removes the temp dirs. The real
 * DB path is only restored after a short settle so trailing fire-and-forget
 * writes from the last test land in a temp DB (or fail on a closed handle),
 * never in the operator's database.
 */

import { afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDatabasePathForTesting } from "../infra/storage/database.ts";
import { _resetPositionStoreForTests } from "../core/positions/store.ts";
import { resetPositionManager } from "../core/positions/manager.ts";

export interface TempGordonHome {
  /** The temp GORDON_HOME of the currently running test. */
  current(): string;
}

export function installTempGordonHome(prefix = "gordon-test-home-"): TempGordonHome {
  const prevHome = process.env.GORDON_HOME;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const dirs: string[] = [];
  let current = "";

  beforeEach(() => {
    current = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(current);
    process.env.GORDON_HOME = current;
    // GORDON_HOME wins over XDG in getGordonDir(), but clear it anyway so a
    // misconfigured resolution order can never fall back to a real dir.
    delete process.env.XDG_CONFIG_HOME;
    setDatabasePathForTesting(join(current, "gordon.db"));
    _resetPositionStoreForTests();
    resetPositionManager();
  });

  afterAll(async () => {
    // Let fire-and-forget writes from the last test settle against the temp
    // DB before the real database path becomes reachable again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    setDatabasePathForTesting(null);
    _resetPositionStoreForTests();
    resetPositionManager();
    if (prevHome === undefined) delete process.env.GORDON_HOME;
    else process.env.GORDON_HOME = prevHome;
    if (prevXdg !== undefined) process.env.XDG_CONFIG_HOME = prevXdg;
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Windows keeps SQLite WAL handles open briefly after close;
        // leftover temp dirs are harmless.
      }
    }
  });

  return { current: () => current };
}
