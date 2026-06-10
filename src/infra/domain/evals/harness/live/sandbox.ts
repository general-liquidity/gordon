/**
 * Eval sandbox — isolated temp environment for live eval runs.
 *
 * Redirects Gordon's persistent stores (SQLite audit/action-log, JSONL
 * ledgers, shadow fills) into a disposable directory so eval harness runs
 * never pollute production ~/.gordon state.
 *
 * Path overrides:
 *   - GORDON_HOME              → temp homedir (covers modules using getGordonDir())
 *   - GORDON_TRADE_LEDGER_PATH → temp trade-ledger.jsonl
 *   - GORDON_SHADOW_FILLS_PATH → temp shadow-fills.jsonl
 *   - GORDON_DECISION_JOURNAL_PATH → temp decision-journal.jsonl
 *   - setDatabasePathForTesting  → temp gordon.db (audit log + action log)
 *
 * Modules without path env vars (documented for callers):
 *   - trustTrajectory: no GORDON_*_PATH; pass sandbox.paths.trustLedger as
 *     TrustTrajectoryOptions.persistPath when wiring a runtime factory.
 *   - core/audit store: shares the sandbox SQLite DB via setDatabasePathForTesting.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GordonContext } from "../../../../agents/types.ts";
import { GordonConfigSchema } from "../../../../../types/index.ts";
import { setDatabasePathForTesting } from "../../../../storage/database.ts";
import { DECISION_JOURNAL_PATH_ENV } from "../../../../trading/ops/dailyDecisionJournal.ts";
import { SHADOW_PATH_ENV } from "../../../../trading/ops/shadowMode.ts";
import { TRADE_LEDGER_PATH_ENV } from "../../../../safety/tradeLedger.ts";

export const EVAL_SANDBOX_MARKER_ENV = "GORDON_EVAL_SANDBOX";
export const EVAL_DRY_RUN_ENV = "GORDON_EVAL_DRY_RUN";

export interface EvalSandboxPaths {
  home: string;
  database: string;
  trustLedger: string;
  tradeLedger: string;
  shadowFills: string;
  decisionJournal: string;
}

export interface EvalSandboxOptions {
  /** Temp dir name prefix. Default "gordon-eval-sandbox-". */
  prefix?: string;
  /** When true, sets GORDON_EVAL_DRY_RUN=1 (no LLM calls). */
  dryRun?: boolean;
}

const ENV_KEYS_MANAGED = [
  EVAL_SANDBOX_MARKER_ENV,
  EVAL_DRY_RUN_ENV,
  "GORDON_HOME",
  "GORDON_AUDIT_HMAC_KEY",
  TRADE_LEDGER_PATH_ENV,
  SHADOW_PATH_ENV,
  DECISION_JOURNAL_PATH_ENV,
] as const;

export class EvalSandbox {
  readonly paths: EvalSandboxPaths;
  private readonly savedEnv = new Map<string, string | undefined>();
  private readonly dryRun: boolean;
  private applied = false;
  private disposed = false;

  constructor(rootDir: string, opts: EvalSandboxOptions = {}) {
    this.dryRun = opts.dryRun ?? false;
    this.paths = {
      home: rootDir,
      database: join(rootDir, "gordon.db"),
      trustLedger: join(rootDir, "trust-ledger.jsonl"),
      tradeLedger: join(rootDir, "trade-ledger.jsonl"),
      shadowFills: join(rootDir, "shadow-fills.jsonl"),
      decisionJournal: join(rootDir, "decision-journal.jsonl"),
    };
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }

  apply(): void {
    if (this.applied) return;
    for (const key of ENV_KEYS_MANAGED) {
      this.savedEnv.set(key, process.env[key]);
    }
    process.env[EVAL_SANDBOX_MARKER_ENV] = "1";
    if (this.dryRun) {
      process.env[EVAL_DRY_RUN_ENV] = "1";
    } else {
      delete process.env[EVAL_DRY_RUN_ENV];
    }
    process.env.GORDON_HOME = this.paths.home;
    process.env.GORDON_AUDIT_HMAC_KEY = "eval-sandbox-hmac-key";
    process.env[TRADE_LEDGER_PATH_ENV] = this.paths.tradeLedger;
    process.env[SHADOW_PATH_ENV] = this.paths.shadowFills;
    process.env[DECISION_JOURNAL_PATH_ENV] = this.paths.decisionJournal;
    setDatabasePathForTesting(this.paths.database);
    this.applied = true;
  }

  restore(): void {
    if (!this.applied) return;
    for (const [key, prev] of this.savedEnv) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    setDatabasePathForTesting(null);
    this.savedEnv.clear();
    this.applied = false;
  }

  cleanup(): void {
    if (this.disposed) return;
    this.restore();
    rmSync(this.paths.home, { recursive: true, force: true });
    this.disposed = true;
  }
}

export function createEvalSandbox(opts: EvalSandboxOptions = {}): EvalSandbox {
  const prefix = opts.prefix ?? "gordon-eval-sandbox-";
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  const sandbox = new EvalSandbox(rootDir, opts);
  sandbox.apply();
  return sandbox;
}

export async function withEvalSandbox<T>(
  fn: (sandbox: EvalSandbox) => Promise<T> | T,
  opts: EvalSandboxOptions = {},
): Promise<T> {
  const sandbox = createEvalSandbox(opts);
  try {
    return await fn(sandbox);
  } finally {
    sandbox.cleanup();
  }
}

/** Minimal GordonContext for paper / read-only eval runs inside a sandbox. */
export function buildPaperContext(
  sandbox: EvalSandbox,
  overrides: { threadId?: string; userId?: string } = {},
): GordonContext {
  const config = GordonConfigSchema.parse({ permissionMode: "paper" });
  void sandbox;
  return {
    binance: null,
    exchange: null,
    broker: null,
    llm: {} as GordonContext["llm"],
    config,
    portfolioValue: 10_000,
    availableCash: 5_000,
    userId: overrides.userId ?? "eval-user",
    threadId: overrides.threadId ?? "eval-thread",
  };
}