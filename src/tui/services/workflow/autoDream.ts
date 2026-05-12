// ============================================================================
// Auto-Dream — Background memory consolidation after N sessions
// ============================================================================

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const LOCK_PATH = join(homedir(), ".gordon", "dream.lock");

export class AutoDreamManager {
  async checkAndConsolidate(sessionCount: number, lastConsolidatedAt: Date | null): Promise<boolean> {
    // Gate 1: Time (24h since last)
    if (lastConsolidatedAt && Date.now() - lastConsolidatedAt.getTime() < 24 * 60 * 60 * 1000) return false;
    // Gate 2: Session count (5+)
    if (sessionCount < 5) return false;
    // Gate 3: Lock
    if (!this.acquireLock()) return false;

    try {
      // Consolidation would run here — merge memory files, extract patterns
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
        } else { return false; }
      } catch { unlinkSync(LOCK_PATH); }
    }
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    return true;
  }

  private releaseLock(): void {
    try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch {}
  }
}
