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
 *   - GORDON_RISK_MODE=paper   → risk-gate re-reads this per evaluation and
 *     threads it into kernel.evaluate as modeOverride, forcing paper-mode
 *     decisions even though the riskKernel singleton captured the operator's
 *     mode at import time
 *   - GORDON_TRUST_LEDGER_PATH → temp trust-ledger.jsonl (consumed once
 *     getDefaultTrustTrajectory honors it; set defensively meanwhile)
 *   - setDatabasePathForTesting  → temp gordon.db (audit log + action log)
 *
 * Trust isolation: the default TrustTrajectory is a module singleton with no
 * setter, so apply()/restore() reset it at both boundaries — eval-run trust
 * events never mix with the operator's in-process ledger, and vice versa.
 * `sandbox.trustTrajectory` is a sandbox-persisted instance for explicit
 * threading into runtime factories.
 *
 * core/audit store: shares the sandbox SQLite DB via setDatabasePathForTesting.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GordonContext } from "../../../../agents/types.ts";
import { GordonConfigSchema } from "../../../../../types/index.ts";
import {
  TrustTrajectory,
  _resetDefaultTrustTrajectoryForTests,
} from "../../../../../runtime/permissions/trustTrajectory.ts";
import { setDatabasePathForTesting } from "../../../../storage/database.ts";
import { DECISION_JOURNAL_PATH_ENV } from "../../../../trading/ops/dailyDecisionJournal.ts";
import { SHADOW_PATH_ENV } from "../../../../trading/ops/shadowMode.ts";
import { TRADE_LEDGER_PATH_ENV } from "../../../../safety/tradeLedger.ts";

export const EVAL_SANDBOX_MARKER_ENV = "GORDON_EVAL_SANDBOX";
export const EVAL_DRY_RUN_ENV = "GORDON_EVAL_DRY_RUN";
export const RISK_MODE_ENV = "GORDON_RISK_MODE";
export const TRUST_LEDGER_PATH_ENV = "GORDON_TRUST_LEDGER_PATH";

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
  RISK_MODE_ENV,
  TRUST_LEDGER_PATH_ENV,
] as const;

export class EvalSandbox {
  readonly paths: EvalSandboxPaths;
  private readonly savedEnv = new Map<string, string | undefined>();
  private readonly dryRun: boolean;
  private applied = false;
  private disposed = false;
  private trustInstance: TrustTrajectory | undefined;

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

  get isActive(): boolean {
    return this.applied && !this.disposed;
  }

  /**
   * Trust trajectory persisted to the sandbox ledger. Thread this into
   * runtime factories instead of getDefaultTrustTrajectory() when wiring
   * a sandboxed run.
   */
  get trustTrajectory(): TrustTrajectory {
    if (!this.trustInstance) {
      this.trustInstance = new TrustTrajectory({ persistPath: this.paths.trustLedger });
    }
    return this.trustInstance;
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
    process.env[RISK_MODE_ENV] = "paper";
    process.env[TRUST_LEDGER_PATH_ENV] = this.paths.trustLedger;
    // The default TrustTrajectory singleton has no persistPath and no
    // setter — resetting at both sandbox boundaries is the only lever that
    // keeps eval trust events out of the operator's in-process ledger.
    _resetDefaultTrustTrajectoryForTests();
    setDatabasePathForTesting(this.paths.database);
    this.applied = true;
  }

  restore(): void {
    if (!this.applied) return;
    for (const [key, prev] of this.savedEnv) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    _resetDefaultTrustTrajectoryForTests();
    setDatabasePathForTesting(null);
    this.savedEnv.clear();
    this.applied = false;
  }

  cleanup(): void {
    if (this.disposed) return;
    this.restore();
    // Windows can briefly retain filesystem metadata after SQLite closes;
    // bounded retries keep cleanup deterministic without hiding a real leak.
    rmSync(this.paths.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  if (!sandbox.isActive) {
    throw new Error(
      "buildPaperContext requires an applied, undisposed EvalSandbox — call sandbox.apply() (or createEvalSandbox) first.",
    );
  }
  if (process.env[EVAL_SANDBOX_MARKER_ENV] !== "1") {
    throw new Error(
      `buildPaperContext refused: ${EVAL_SANDBOX_MARKER_ENV} is not set. Live eval contexts must run inside an installed eval sandbox.`,
    );
  }
  const config = GordonConfigSchema.parse({ permissionMode: "paper" });
  return {
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
