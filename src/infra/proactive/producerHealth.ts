/**
 * Producer Health Tracker (Liveness + Heartbeat)
 *
 * Lightweight liveness tracking for proactive-mode producers. Each producer
 * reports a heartbeat when it runs; the tracker detects producers that have
 * gone quiet and surfaces that in the health status tool. This is the
 * narrow version of AI-Trader's heartbeat polling pattern, adapted for a
 * single-process CLI where "is my radar still alive?" is the real question.
 *
 * Not a full heartbeat server — no HTTP endpoint, no cross-process
 * coordination. Just in-memory state updated on every producer tick and
 * read via a status tool. Complements the existing proactive status tool
 * by answering "which producers have actually run in the last N minutes?"
 */

import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("producer-health");

// ============================================================================
// Types
// ============================================================================

export interface ProducerHeartbeat {
  name: string;
  lastSeenAt: number;
  totalRuns: number;
  totalCandidatesFired: number;
  totalErrors: number;
  lastError?: string;
}

export interface ProducerHealthReport {
  producers: Array<{
    name: string;
    lastSeenAt: string | null;
    ageSeconds: number | null;
    status: "active" | "stale" | "silent" | "errored" | "never_run";
    totalRuns: number;
    totalCandidatesFired: number;
    totalErrors: number;
    lastError?: string;
  }>;
  overall: "healthy" | "degraded" | "down";
  staleCount: number;
  erroredCount: number;
  totalCandidatesFired: number;
}

// Age thresholds for status classification
const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 min
const STALE_THRESHOLD_MS = 15 * 60 * 1000;   // 15 min
const SILENT_THRESHOLD_MS = 60 * 60 * 1000;  // 1 hour

// ============================================================================
// Tracker (singleton)
// ============================================================================

class ProducerHealthTracker {
  private heartbeats = new Map<string, ProducerHeartbeat>();
  private startedAt: number | null = null;
  private expectedProducers = new Set<string>();

  start(): void {
    this.startedAt = Date.now();
  }

  stop(): void {
    this.startedAt = null;
    this.heartbeats.clear();
  }

  /** Register a producer so it appears in the report even before it first runs. */
  registerProducer(name: string): void {
    this.expectedProducers.add(name);
  }

  /** Producer calls this on each successful tick. */
  recordHeartbeat(name: string, candidatesFired = 0): void {
    const cur = this.heartbeats.get(name) ?? {
      name,
      lastSeenAt: 0,
      totalRuns: 0,
      totalCandidatesFired: 0,
      totalErrors: 0,
    };
    cur.lastSeenAt = Date.now();
    cur.totalRuns += 1;
    cur.totalCandidatesFired += candidatesFired;
    this.heartbeats.set(name, cur);
  }

  /** Producer calls this when it throws or returns an error. */
  recordError(name: string, error: string): void {
    const cur = this.heartbeats.get(name) ?? {
      name,
      lastSeenAt: Date.now(),
      totalRuns: 0,
      totalCandidatesFired: 0,
      totalErrors: 0,
    };
    cur.totalErrors += 1;
    cur.lastError = error.slice(0, 200);
    this.heartbeats.set(name, cur);
    logger.debug("Producer error recorded", { name, error: cur.lastError });
  }

  /** Build a health report including producers registered but never run yet. */
  report(): ProducerHealthReport {
    const now = Date.now();
    const producerNames = new Set([
      ...this.heartbeats.keys(),
      ...this.expectedProducers,
    ]);
    const producers: ProducerHealthReport["producers"] = [];
    let staleCount = 0;
    let erroredCount = 0;
    let totalCandidatesFired = 0;

    for (const name of producerNames) {
      const hb = this.heartbeats.get(name);
      if (!hb || hb.lastSeenAt === 0) {
        producers.push({
          name,
          lastSeenAt: null,
          ageSeconds: null,
          status: "never_run",
          totalRuns: 0,
          totalCandidatesFired: 0,
          totalErrors: 0,
        });
        continue;
      }

      const age = now - hb.lastSeenAt;
      const errorRate = hb.totalRuns > 0 ? hb.totalErrors / hb.totalRuns : 0;
      let status: ProducerHealthReport["producers"][number]["status"];
      if (errorRate > 0.5 && hb.totalRuns >= 3) {
        status = "errored";
        erroredCount += 1;
      } else if (age < ACTIVE_THRESHOLD_MS) {
        status = "active";
      } else if (age < STALE_THRESHOLD_MS) {
        status = "stale";
        staleCount += 1;
      } else {
        status = "silent";
        staleCount += 1;
      }

      totalCandidatesFired += hb.totalCandidatesFired;

      producers.push({
        name: hb.name,
        lastSeenAt: new Date(hb.lastSeenAt).toISOString(),
        ageSeconds: Math.floor(age / 1000),
        status,
        totalRuns: hb.totalRuns,
        totalCandidatesFired: hb.totalCandidatesFired,
        totalErrors: hb.totalErrors,
        lastError: hb.lastError,
      });
    }

    producers.sort((a, b) => a.name.localeCompare(b.name));

    let overall: "healthy" | "degraded" | "down" = "healthy";
    if (erroredCount > 0 || staleCount > producers.length / 2) {
      overall = "degraded";
    }
    if (producers.length === 0 || producers.every((p) => p.status === "never_run" || p.status === "silent")) {
      overall = "down";
    }

    return {
      producers,
      overall,
      staleCount,
      erroredCount,
      totalCandidatesFired,
    };
  }
}

const tracker = new ProducerHealthTracker();

export function getProducerHealthTracker(): ProducerHealthTracker {
  return tracker;
}
