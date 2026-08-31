import { createHmac, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { resolveAuditHmacKey } from "../../core/audit/signing.ts";
import type { AbsorbingBarrierState } from "./absorbingBarrier.ts";
import { getGordonDir } from "../storage/paths.ts";
import { replaceFileCrashDurably } from "../storage/crashDurableFile.ts";

export const HALT_STATE_PATH_ENV = "GORDON_HALT_STATE_PATH";

export interface DurableTradeOutcome {
  tradeId: string;
  outcome: "win" | "loss" | "scratch";
  recordedAtMs: number;
}

export interface PortfolioHaltState {
  streakLastTrippedAtMs: number | null;
  barrierState: AbsorbingBarrierState | null;
  /** Authenticated, account-scoped observations consumed by the streak gate. */
  recentTradeOutcomes: DurableTradeOutcome[];
}

interface HaltStatePayload {
  version: 1;
  portfolios: Record<string, PortfolioHaltState>;
}

interface SignedHaltState extends HaltStatePayload {
  signature: string;
}

const EMPTY_STATE: PortfolioHaltState = {
  streakLastTrippedAtMs: null,
  barrierState: null,
  recentTradeOutcomes: [],
};
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_ATTEMPTS = 10;
const LOCK_RETRY_MS = 10;
const MAX_DURABLE_TRADE_OUTCOMES = 20;
const lockWait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function withStateLock<T>(path: string, operation: () => T): T | null {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let fd: number | null = null;
  try {
    for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS && fd === null; attempt += 1) {
      try {
        fd = openSync(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
            unlinkSync(lockPath);
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
          return null;
        }
        if (attempt + 1 < LOCK_RETRY_ATTEMPTS) {
          Atomics.wait(lockWait, 0, 0, LOCK_RETRY_MS);
        }
      }
    }
    if (fd === null) return null;
    return operation();
  } finally {
    if (fd !== null) {
      closeSync(fd);
      try {
        unlinkSync(lockPath);
      } catch {
        // Another safety operation will recover a stale lock after the TTL.
      }
    }
  }
}

let loadedPath: string | null | undefined;
let payload: HaltStatePayload = { version: 1, portfolios: {} };
let integrityError: string | null = null;
// A valid old ledger cannot prove that a newer halt observation was persisted.
// Keep write/lock failures separate from file-integrity errors so refreshing
// the old file cannot accidentally clear the fail-closed condition.
let persistenceError: string | null = null;
const observedLedgerPaths = new Set<string>();

function statePath(): string | null {
  const override = process.env[HALT_STATE_PATH_ENV];
  if (override) return override;
  if (process.env.NODE_ENV === "test") return null;
  return join(getGordonDir(), "safety-halt-state.json");
}

function sign(value: HaltStatePayload): string {
  return createHmac("sha256", resolveAuditHmacKey()).update(JSON.stringify(value)).digest("hex");
}

function validBarrierState(value: unknown): value is AbsorbingBarrierState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  const finite = (key: string) => typeof state[key] === "number" && Number.isFinite(state[key]);
  return (
    finite("referenceCapitalUsd") &&
    finite("highWaterMarkUsd") &&
    finite("closedEpisodeLossUsd") &&
    finite("troughSinceHighWaterUsd") &&
    finite("lastEquityUsd") &&
    typeof state.tripped === "boolean" &&
    (state.trippedBy === null ||
      state.trippedBy === "inception" ||
      state.trippedBy === "trailing_high_water") &&
    (state.trippedAtEquityUsd === null || finite("trippedAtEquityUsd")) &&
    (state.trippedAtLossFraction === null || finite("trippedAtLossFraction"))
  );
}

function validPortfolioState(value: unknown): value is PortfolioHaltState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    (state.streakLastTrippedAtMs === null ||
      (typeof state.streakLastTrippedAtMs === "number" &&
        Number.isFinite(state.streakLastTrippedAtMs) &&
        state.streakLastTrippedAtMs > 0)) &&
    (state.barrierState === null || validBarrierState(state.barrierState)) &&
    (state.recentTradeOutcomes === undefined ||
      (Array.isArray(state.recentTradeOutcomes) &&
        state.recentTradeOutcomes.length <= MAX_DURABLE_TRADE_OUTCOMES &&
        state.recentTradeOutcomes.every((outcome) => {
          if (!outcome || typeof outcome !== "object") return false;
          const item = outcome as Record<string, unknown>;
          return (
            typeof item.tradeId === "string" &&
            item.tradeId.length > 0 &&
            (item.outcome === "win" || item.outcome === "loss" || item.outcome === "scratch") &&
            typeof item.recordedAtMs === "number" &&
            Number.isFinite(item.recordedAtMs) &&
            item.recordedAtMs > 0
          );
        })))
  );
}

function load(path: string | null): void {
  payload = { version: 1, portfolios: {} };
  integrityError = null;
  if (!path) return;
  if (!existsSync(path)) {
    if (observedLedgerPaths.has(path)) {
      integrityError = "safety-halt state disappeared after it was observed";
    }
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SignedHaltState>;
    if (parsed.version !== 1 || !parsed.portfolios || typeof parsed.portfolios !== "object") {
      throw new Error("unsupported or malformed safety-halt state");
    }
    if (typeof parsed.signature !== "string" || !/^[0-9a-f]{64}$/.test(parsed.signature)) {
      throw new Error("safety-halt state signature is missing or malformed");
    }
    const unsigned: HaltStatePayload = { version: 1, portfolios: parsed.portfolios };
    const expected = sign(unsigned);
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parsed.signature, "hex"))) {
      throw new Error("safety-halt state signature does not verify");
    }
    for (const [identity, state] of Object.entries(unsigned.portfolios)) {
      if (!identity || !validPortfolioState(state)) {
        throw new Error(`invalid safety-halt state for ${identity || "empty identity"}`);
      }
    }
    // Version-1 ledgers written before authenticated streak observations did
    // not contain recentTradeOutcomes. Verify their original bytes first, then
    // normalize the optional field in memory; the next successful write signs
    // the upgraded shape.
    payload = {
      ...unsigned,
      portfolios: Object.fromEntries(
        Object.entries(unsigned.portfolios).map(([identity, state]) => [
          identity,
          { ...state, recentTradeOutcomes: state.recentTradeOutcomes ?? [] },
        ]),
      ),
    };
    observedLedgerPaths.add(path);
  } catch (error) {
    integrityError = error instanceof Error ? error.message : String(error);
  }
}

function ensureLoaded(): string | null {
  const path = statePath();
  if (loadedPath !== path) {
    loadedPath = path;
    load(path);
  }
  return path;
}

function persist(path: string, next: HaltStatePayload): boolean {
  try {
    const signed: SignedHaltState = { ...next, signature: sign(next) };
    replaceFileCrashDurably(path, JSON.stringify(signed, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function haltStateIntegrityError(): string | null {
  const path = ensureLoaded();
  // The file is replaced atomically and may be updated by a sibling Gordon
  // process after this module cached a valid payload. Refresh at the exact
  // fail-closed decision point so a replacement cannot remain invisible until
  // a later state read, after new risk has already been admitted.
  if (path) load(path);
  return persistenceError ?? integrityError;
}

export function readPortfolioHaltState(identity: string): PortfolioHaltState {
  const path = ensureLoaded();
  // Atomic rename makes an unlocked read safe; refreshing here ensures a
  // second process's trip is visible before this process evaluates a gate.
  if (path) load(path);
  const state = payload.portfolios[identity];
  return state
    ? {
        ...state,
        barrierState: state.barrierState ? { ...state.barrierState } : null,
        recentTradeOutcomes: [...state.recentTradeOutcomes],
      }
    : { ...EMPTY_STATE, recentTradeOutcomes: [] };
}

/**
 * Durably record one confirmed close for the account-scoped streak breaker.
 * Dedupe makes multiple close observers safe; write/lock failure latches the
 * same fail-closed persistence error as barrier and trip updates.
 */
export function recordPortfolioTradeOutcome(
  identity: string,
  outcome: DurableTradeOutcome,
): boolean {
  if (
    !identity ||
    !outcome.tradeId ||
    !validPortfolioState({ ...EMPTY_STATE, recentTradeOutcomes: [outcome] })
  ) {
    return false;
  }
  return updatePortfolioHaltState(identity, (state) => {
    if (state.recentTradeOutcomes.some((existing) => existing.tradeId === outcome.tradeId)) {
      return state;
    }
    return {
      ...state,
      recentTradeOutcomes: [...state.recentTradeOutcomes, outcome].slice(
        -MAX_DURABLE_TRADE_OUTCOMES,
      ),
    };
  });
}

export function updatePortfolioHaltState(
  identity: string,
  updater: (state: PortfolioHaltState) => PortfolioHaltState,
): boolean {
  const path = ensureLoaded();
  const update = (): boolean => {
    // Reload after acquiring the inter-process lock. A long-running process
    // must merge a sibling process's newer account entry rather than replacing
    // it from its cached snapshot.
    if (path) load(path);
    if (integrityError) return false;
    const current = payload.portfolios[identity] ?? EMPTY_STATE;
    const nextState = updater({
      ...current,
      barrierState: current.barrierState ? { ...current.barrierState } : null,
      recentTradeOutcomes: [...current.recentTradeOutcomes],
    });
    if (!validPortfolioState(nextState)) return false;
    const next: HaltStatePayload = {
      version: 1,
      portfolios: { ...payload.portfolios, [identity]: nextState },
    };
    if (path && !persist(path, next)) {
      persistenceError = "safety-halt state could not be persisted";
      return false;
    }
    if (path) observedLedgerPaths.add(path);
    payload = next;
    return true;
  };
  if (!path) return update();
  const result = withStateLock(path, update);
  if (result === null) persistenceError = "safety-halt state is locked by another process";
  return result ?? false;
}

export interface HaltStateResetResult {
  ok: boolean;
  archivePath?: string;
  error?: string;
}

/**
 * Archive the exact prior bytes and replace the ledger with a clean signed
 * state. This is the only recovery path for corruption or HMAC-key rotation;
 * it is intentionally explicit and requires an operator rationale.
 */
export function archiveAndResetHaltState(rationale: string): HaltStateResetResult {
  const reason = rationale.trim();
  if (reason.length < 10)
    return { ok: false, error: "reset rationale must be at least 10 characters" };
  const path = ensureLoaded();
  if (!path) return { ok: false, error: "durable halt-state persistence is not active" };
  const result = withStateLock(path, () => {
    let archivePath: string | undefined;
    if (existsSync(path)) {
      archivePath = `${path}.archive-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
      try {
        // Copy before replacement. Renaming the canonical ledger away creates
        // a crash window where the next process interprets an absent file as
        // clean state. Keep the old signed ledger canonical until persist's
        // atomic rename replaces it.
        const original = readFileSync(path);
        copyFileSync(path, archivePath);
        if (!original.equals(readFileSync(archivePath))) {
          return { ok: false, error: "archived safety-halt state did not verify byte-for-byte" };
        }
      } catch (error) {
        return {
          ok: false,
          error: `safety-halt state could not be archived: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    const empty: HaltStatePayload = { version: 1, portfolios: {} };
    if (!persist(path, empty)) {
      return { ok: false, error: "replacement safety-halt state could not be persisted" };
    }
    payload = empty;
    integrityError = null;
    persistenceError = null;
    loadedPath = path;
    observedLedgerPaths.add(path);
    return { ok: true, archivePath };
  });
  return result ?? { ok: false, error: "safety-halt state is locked by another process" };
}

export function clearPortfolioHaltStateForTesting(identity?: string): void {
  ensureLoaded();
  if (identity) delete payload.portfolios[identity];
  else payload = { version: 1, portfolios: {} };
  integrityError = null;
  persistenceError = null;
}

/** Drops only process memory; the next access reloads the authenticated file. */
export function reloadDurableHaltStateForTesting(): void {
  loadedPath = undefined;
  payload = { version: 1, portfolios: {} };
  integrityError = null;
  persistenceError = null;
  observedLedgerPaths.clear();
  ensureLoaded();
}
