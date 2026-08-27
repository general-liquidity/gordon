/**
 * Review Queue — fail-bucket for regressed scenarios.
 *
 * Borrows the CREAO Harness's "a score with no ticket is just a
 * dashboard" principle: when a scenario regresses, append a JSONL row
 * to a local review file so the user has something to grep, triage,
 * and promote into the gold scenario set.
 *
 * No Linear / no GitHub integration — Gordon is a single-operator tool
 * today. This file is the local equivalent of a bug tracker for eval
 * failures.
 *
 * Format: one JSON object per line, UTF-8. Each row carries the
 * scenarioId, the score delta, the baseline and candidate variant
 * labels, optional metadata (model, prompt hash), and a timestamp.
 *
 * Default location: `~/.gordon/eval-failures.jsonl`. Override via the
 * `path` argument or `GORDON_EVAL_REVIEW_QUEUE_PATH` env var.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createModuleLogger } from "../../../logger/index.ts";
import { FAILURE_MODES } from "./types.ts";
import type { FailureMode } from "./types.ts";

const logger = createModuleLogger("eval-review-queue");

export interface ReviewQueueEntry {
  scenarioId: string;
  baselineLabel: string;
  candidateLabel: string;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  /**
   * Judge-assigned failure-mode label for the regressed (candidate)
   * trajectory, from the fixed taxonomy. Optional — absent when the judge
   * did not classify a failure. Rolled up by `rollupFailureModes`.
   */
  failureMode?: FailureMode;
  /** Free-form metadata: judge model, prompt hash, env flags, etc. */
  metadata?: Record<string, string | number | boolean>;
}

export function defaultReviewQueuePath(): string {
  const fromEnv = process.env.GORDON_EVAL_REVIEW_QUEUE_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "eval-failures.jsonl");
}

/**
 * Append entries to the review queue file. Creates parent directory if
 * needed. Each entry becomes a single JSONL line with `appendedAt`
 * timestamp stamped automatically.
 *
 * Never throws — write failures are logged and swallowed (the eval
 * pipeline should never crash because the review-queue disk is full).
 */
export function appendToReviewQueue(
  entries: ReadonlyArray<ReviewQueueEntry>,
  path: string = defaultReviewQueuePath(),
): { written: number; path: string; error?: string } {
  if (entries.length === 0) return { written: 0, path };
  try {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const lines = `${entries.map((e) => JSON.stringify({ ...e, appendedAt: now })).join("\n")}\n`;
    appendFileSync(path, lines, { encoding: "utf-8" });
    return { written: entries.length, path };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("Review-queue append failed — eval continues without persistence", {
      path,
      err: msg,
    });
    return { written: 0, path, error: msg };
  }
}

/**
 * Read the queue back, newest-first. Used for `/eval review` style
 * inspection. Returns [] when the file doesn't exist or can't be parsed.
 */
export function readReviewQueue(
  path: string = defaultReviewQueuePath(),
): ReadonlyArray<ReviewQueueEntry & { appendedAt: string }> {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, { encoding: "utf-8" });
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const parsed: Array<ReviewQueueEntry & { appendedAt: string }> = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Skip malformed line, keep going.
      }
    }
    return parsed.reverse();
  } catch (err) {
    logger.warn("Review-queue read failed", {
      path,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Suite-level error-mode rollup (SWE-bench-Pro error_analysis analog). Counts
 * review-queue entries by their judge-assigned `failureMode`, giving an
 * at-a-glance view of WHICH reasoning failures dominate the regressions.
 *
 * Returns a count for every taxonomy member (zero when unseen) plus an
 * `unclassified` bucket for entries the judge left unlabeled and a `total`.
 * Reads the default queue when no entries are supplied.
 */
export function rollupFailureModes(
  entries?: ReadonlyArray<Pick<ReviewQueueEntry, "failureMode">>,
): { byMode: Record<FailureMode, number>; unclassified: number; total: number } {
  const rows = entries ?? readReviewQueue();
  const byMode = Object.fromEntries(FAILURE_MODES.map((m) => [m, 0])) as Record<
    FailureMode,
    number
  >;
  let unclassified = 0;
  for (const row of rows) {
    if (row.failureMode) byMode[row.failureMode] += 1;
    else unclassified += 1;
  }
  return { byMode, unclassified, total: rows.length };
}
