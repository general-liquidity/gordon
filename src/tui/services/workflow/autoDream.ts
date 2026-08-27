// ============================================================================
// Auto-Dream — Background memory consolidation after N sessions
// ============================================================================
//
// Claude Code runs a forked read-only agent on an idle/session cadence that
// prunes/dedupes/indexes memory. Gordon drives its EXISTING machinery instead
// of spawning a parallel store:
//   1. ACE distillation (Reflector → Curator) — the same audited path /reflect
//      and the run_ace_cycle tool use. Distills the action log into lessons,
//      regression-gated and revision-stamped. No-op unless GORDON_ACE_ENABLED.
//   2. Session-memory dedupe — supersedes restated facts in the categorized
//      JSON store using its existing supersededBy pointer (non-destructive).
//
// Opt-in: only runs when the `autodream` experimental flag
// (GORDON_AUTODREAM_ENABLED) is on AND the gates below pass. Read-only-safe:
// the only writes are memory curation the manual paths already perform.

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import { runACECycle } from "../../../infra/agents/ace/index.ts";
import { dedupeSessionMemories } from "../../../infra/memory/sessionMemory.ts";
import { createModuleLogger } from "../../../infra/logger/index.ts";

const LOCK_PATH = join(homedir(), ".gordon", "dream.lock");
const logger = createModuleLogger("auto-dream");

/**
 * The consolidation work performed once the gates + lock pass. Injectable so
 * tests can substitute a fake (the real one's ACE leg reads the action log and
 * may distill lessons — keeping it behind a seam lets the gating logic be
 * verified without that side effect). Mirrors how the rest of the codebase
 * injects such dependencies.
 */
export interface DreamConsolidator {
  /** ACE distillation — Reflector → Curator over recent action-log entries. */
  runACE(lookbackEntries: number): void;
  /** Session-memory dedupe/supersede over the categorized JSON store. */
  dedupeSessionMemory(): void;
}

/** The production consolidator — drives Gordon's audited memory machinery. */
const REAL_CONSOLIDATOR: DreamConsolidator = {
  runACE: (lookbackEntries) => {
    // Same path as /reflect and the run_ace_cycle tool. No-op when ACE is
    // disabled (runReflector/runCurator both guard on GORDON_ACE_ENABLED).
    runACECycle({ lookbackEntries });
  },
  dedupeSessionMemory: () => {
    const result = dedupeSessionMemories();
    if (result.superseded > 0) {
      logger.info("auto-dream session-memory dedupe", {
        superseded: result.superseded,
        remaining: result.remaining,
      });
    }
  },
};

export class AutoDreamManager {
  private readonly consolidator: DreamConsolidator;

  constructor(consolidator: DreamConsolidator = REAL_CONSOLIDATOR) {
    this.consolidator = consolidator;
  }

  async checkAndConsolidate(
    sessionCount: number,
    lastConsolidatedAt: Date | null,
  ): Promise<boolean> {
    // Gate 1: Time (24h since last)
    if (lastConsolidatedAt && Date.now() - lastConsolidatedAt.getTime() < 24 * 60 * 60 * 1000)
      return false;
    // Gate 2: Session count (5+)
    if (sessionCount < 5) return false;
    // Gate 3: Lock
    if (!this.acquireLock()) return false;

    try {
      // Consolidation — drive Gordon's existing memory machinery (no parallel
      // store). ACE distillation first (action log → lessons), then session-
      // memory dedupe (supersede restated facts). Each leg is isolated so a
      // failure in one doesn't strand the lock or skip the other.
      try {
        this.consolidator.runACE(200);
      } catch (err) {
        logger.warn("auto-dream ACE distillation failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        this.consolidator.dedupeSessionMemory();
      } catch (err) {
        logger.warn("auto-dream session-memory dedupe failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    } finally {
      this.releaseLock();
    }
  }

  private acquireLock(): boolean {
    if (existsSync(LOCK_PATH)) {
      try {
        const lockData = JSON.parse(readFileSync(LOCK_PATH, "utf-8"));
        // Stale lock detection (> 1 hour)
        if (Date.now() - lockData.timestamp > 3600000) {
          unlinkSync(LOCK_PATH);
        } else {
          return false;
        }
      } catch {
        unlinkSync(LOCK_PATH);
      }
    }
    // Default-on feature: on a fresh install ~/.gordon may not exist yet.
    // Create the lock's parent dir rather than ENOENT-crashing consolidation.
    mkdirSync(dirname(LOCK_PATH), { recursive: true });
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    return true;
  }

  private releaseLock(): void {
    try {
      if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
    } catch {}
  }
}
