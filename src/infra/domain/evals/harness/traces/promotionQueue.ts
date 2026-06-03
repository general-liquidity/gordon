/**
 * Promotion queue (Phase 1) — silver→gold candidate bucket for flagged traces.
 *
 * Sibling of reviewQueue.ts: where the review queue captures *regression*
 * failures (a candidate variant scored worse than baseline), this captures
 * flagged *production/paper traces* that are candidates to become permanent
 * scenarios. The operator triages this file and promotes "silver" candidates
 * to "gold" (a frozen EvalScenario via promoteTraceToScenario).
 *
 * Same JSONL-append, never-throw discipline as the review queue. Default
 * location `~/.gordon/eval-promotions.jsonl` (override via arg or
 * GORDON_EVAL_PROMOTION_QUEUE_PATH).
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("eval-promotion-queue");

export interface PromotionEntry {
  traceId: string;
  /** Provenance for the eventual promoted scenario, e.g. "trace:<id>". */
  derivedFrom: string;
  /** Worst severity among the flagged process violations. */
  severity: "block" | "warn";
  reason: string;
  violations: ReadonlyArray<{ rule: string; severity: string; detail: string }>;
  /** Triage status; defaults to "candidate" (silver). */
  status?: "candidate" | "promoted" | "rejected";
  metadata?: Record<string, string | number | boolean>;
}

export function defaultPromotionQueuePath(): string {
  const fromEnv = process.env.GORDON_EVAL_PROMOTION_QUEUE_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "eval-promotions.jsonl");
}

export function appendToPromotionQueue(
  entries: ReadonlyArray<PromotionEntry>,
  path: string = defaultPromotionQueuePath(),
): { written: number; path: string; error?: string } {
  if (entries.length === 0) return { written: 0, path };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const now = new Date().toISOString();
    const lines =
      entries
        .map((e) => JSON.stringify({ status: "candidate", ...e, appendedAt: now }))
        .join("\n") + "\n";
    appendFileSync(path, lines, { encoding: "utf-8" });
    return { written: entries.length, path };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("Promotion-queue append failed — scoring continues without persistence", {
      path,
      err: msg,
    });
    return { written: 0, path, error: msg };
  }
}

export function readPromotionQueue(
  path: string = defaultPromotionQueuePath(),
): ReadonlyArray<PromotionEntry & { appendedAt: string }> {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, { encoding: "utf-8" });
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const parsed: Array<PromotionEntry & { appendedAt: string }> = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Skip malformed line.
      }
    }
    return parsed.reverse();
  } catch (err) {
    logger.warn("Promotion-queue read failed", {
      path,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
