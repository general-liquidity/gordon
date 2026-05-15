/**
 * Durable Step (GORDON_DURABLE_STEP).
 *
 * Port of the durable-step pattern from Inngest's "Your Agent Needs a
 * Harness, Not a Framework" (2026):
 *
 *   "Every LLM call or tool call becomes a step — an independently
 *    retryable unit of work."
 *
 * Each step is wrapped in `executeStep(opts)`. The first call executes
 * `fn()` and persists the result keyed by a stable `stepId`. Subsequent
 * calls with the same `stepId` return the cached result (replay), so
 * mid-flight crash + restart picks up from the last completed step
 * instead of redoing everything.
 *
 * Two side effects beyond replay:
 *
 *   - **In-flight dedupe.** If two concurrent calls supply the same
 *     `stepId`, the second one awaits the first's promise rather than
 *     starting a parallel execution. Closest Gordon gets to Inngest's
 *     singleton concurrency without a separate primitive.
 *   - **Input-hash invariant.** Each cached record stores the hash of
 *     its input; a later call with the same `stepId` but a different
 *     input is treated as a *new* step (cache miss) and overwrites.
 *     Prevents accidental cross-step collision.
 *
 * This is the trading-domain analog of "a step's result persists so
 * the workflow can resume from the last completed step on crash." It
 * does NOT replace Gordon's action log (broader audit) or session
 * handoff (cross-session resume); it's the within-session checkpoint
 * primitive that fits between them.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const DURABLE_STEP_FLAG_ENV = "GORDON_DURABLE_STEP";
export const DURABLE_STEP_STORE_PATH_ENV = "GORDON_DURABLE_STEP_PATH";

export interface StepRecord {
  stepId: string;
  startedAt: string;
  completedAt: string | null;
  /** Hash of `input` for idempotency / collision detection. */
  inputHash: string;
  /** Present iff completed without error. Stored as JSON-serializable. */
  result?: unknown;
  /** Present iff the step threw. */
  error?: { name: string; message: string };
}

export interface ExecuteStepOptions<T> {
  stepId: string;
  /** Input — used to compute the hash for idempotency. */
  input: unknown;
  /** Async function to execute on cache miss. */
  fn: () => Promise<T>;
  /** Override storage path. Default ~/.gordon/durable-steps.jsonl. */
  storePath?: string;
  /** Override clock for tests. */
  now?: () => string;
  /** Skip persistence entirely (in-memory only). */
  noLog?: boolean;
}

export interface ExecuteStepResult<T> {
  result: T;
  /** True if the result was replayed from cache (no fn() execution). */
  fromCache: boolean;
  /** Step id for traceability. */
  stepId: string;
}

export function isDurableStepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DURABLE_STEP_FLAG_ENV] === "1" || env[DURABLE_STEP_FLAG_ENV] === "true";
}

export function defaultDurableStepPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[DURABLE_STEP_STORE_PATH_ENV] ?? join(homedir(), ".gordon", "durable-steps.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Stable hash of an input value (JSON-stringified, djb2-ish). */
export function hashInput(input: unknown): string {
  const s = JSON.stringify(input ?? null);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

/** Read all durable-step records from disk (latest-per-stepId wins). */
export function loadStepRecords(path?: string): Map<string, StepRecord> {
  const target = path ?? defaultDurableStepPath();
  const out = new Map<string, StepRecord>();
  if (!existsSync(target)) return out;
  const lines = readFileSync(target, "utf8").split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as StepRecord;
      if (typeof parsed.stepId === "string") {
        out.set(parsed.stepId, parsed);
      }
    } catch {
      // skip malformed
    }
  }
  return out;
}

/** Look up a single record by stepId. */
export function loadStepRecord(stepId: string, path?: string): StepRecord | null {
  return loadStepRecords(path).get(stepId) ?? null;
}

/** Append a record to the JSONL store (last-write-wins for replay reads). */
function persistRecord(record: StepRecord, path?: string): void {
  const target = path ?? defaultDurableStepPath();
  ensureParentDir(target);
  appendFileSync(target, JSON.stringify(record) + "\n", "utf8");
}

// In-memory tracking of in-flight steps for dedupe within a process.
const _inflight = new Map<string, Promise<ExecuteStepResult<unknown>>>();

/** Reset the in-flight registry — tests only. */
export function resetInflightForTesting(): void {
  _inflight.clear();
}

/**
 * Execute a durable step. Returns the cached result if a completed
 * record exists for this `stepId` AND the input hash matches.
 *
 * Crash-recovery: on process restart, calling with the same `stepId`
 * returns the cached result without re-executing.
 *
 * In-flight dedupe: concurrent calls with the same `stepId` share the
 * same promise (the second caller awaits the first's execution).
 */
export async function executeStep<T>(opts: ExecuteStepOptions<T>): Promise<ExecuteStepResult<T>> {
  const stepId = opts.stepId;
  const inputHash = hashInput(opts.input);
  const now = opts.now ?? (() => new Date().toISOString());

  // 1. Check on-disk cache (replay path)
  if (!opts.noLog) {
    const cached = loadStepRecord(stepId, opts.storePath);
    if (cached && cached.completedAt && cached.error === undefined && cached.inputHash === inputHash) {
      return { result: cached.result as T, fromCache: true, stepId };
    }
  }

  // 2. Check in-flight registry (concurrency dedupe)
  const existing = _inflight.get(stepId);
  if (existing) {
    const r = (await existing) as ExecuteStepResult<T>;
    return r;
  }

  // 3. Execute and persist
  const promise = (async (): Promise<ExecuteStepResult<T>> => {
    const startedAt = now();
    let result: T;
    try {
      result = await opts.fn();
    } catch (err) {
      const record: StepRecord = {
        stepId,
        startedAt,
        completedAt: now(),
        inputHash,
        error: {
          name: err instanceof Error ? err.name : "Error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
      if (!opts.noLog) persistRecord(record, opts.storePath);
      throw err;
    }
    const record: StepRecord = {
      stepId,
      startedAt,
      completedAt: now(),
      inputHash,
      result,
    };
    if (!opts.noLog) persistRecord(record, opts.storePath);
    return { result, fromCache: false, stepId };
  })();

  _inflight.set(stepId, promise as Promise<ExecuteStepResult<unknown>>);
  try {
    return await promise;
  } finally {
    _inflight.delete(stepId);
  }
}

export function recordToPayload(record: StepRecord): Record<string, unknown> {
  return {
    kind: "durable_step.record",
    stepId: record.stepId,
    completed: record.completedAt !== null,
    succeeded: record.error === undefined && record.completedAt !== null,
    inputHash: record.inputHash,
    errorMessage: record.error?.message,
  };
}
