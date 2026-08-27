import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  archiveAndResetHaltState,
  haltStateIntegrityError,
  readPortfolioHaltState,
  reloadDurableHaltStateForTesting,
  updatePortfolioHaltState,
} from "./durableHaltState.ts";
import { evaluatePreTradeHaltGates } from "./preTradeHaltGates.ts";
import { recordTradeClosureDebrief } from "../trading/ops/debriefMatrix.ts";

const previous = {
  path: process.env.GORDON_HALT_STATE_PATH,
  key: process.env.GORDON_AUDIT_HMAC_KEY,
};
let dir = "";
let path = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gordon-halt-state-"));
  path = join(dir, "halt-state.json");
  process.env.GORDON_HALT_STATE_PATH = path;
  process.env.GORDON_AUDIT_HMAC_KEY = "test-halt-state-key";
  reloadDurableHaltStateForTesting();
});

afterEach(() => {
  if (previous.path === undefined) delete process.env.GORDON_HALT_STATE_PATH;
  else process.env.GORDON_HALT_STATE_PATH = previous.path;
  if (previous.key === undefined) delete process.env.GORDON_AUDIT_HMAC_KEY;
  else process.env.GORDON_AUDIT_HMAC_KEY = previous.key;
  reloadDurableHaltStateForTesting();
  rmSync(dir, { recursive: true, force: true });
});

describe("durable portfolio halt state", () => {
  test("survives an in-memory reset and reload", () => {
    updatePortfolioHaltState("binance:user-a:live", (state) => ({
      ...state,
      streakLastTrippedAtMs: 123_456,
      barrierState: {
        referenceCapitalUsd: 10_000,
        highWaterMarkUsd: 10_000,
        closedEpisodeLossUsd: 0,
        troughSinceHighWaterUsd: 7_500,
        lastEquityUsd: 7_500,
        tripped: true,
        trippedBy: "inception",
        trippedAtEquityUsd: 7_500,
        trippedAtLossFraction: 0.25,
      },
    }));

    reloadDurableHaltStateForTesting();

    expect(readPortfolioHaltState("binance:user-a:live")).toMatchObject({
      streakLastTrippedAtMs: 123_456,
      barrierState: { tripped: true, troughSinceHighWaterUsd: 7_500 },
    });
  });

  test("isolates state by stable portfolio identity", () => {
    updatePortfolioHaltState("binance:user-a:live", (state) => ({
      ...state,
      streakLastTrippedAtMs: 11,
    }));
    updatePortfolioHaltState("kraken:user-a:live", (state) => ({
      ...state,
      streakLastTrippedAtMs: 22,
    }));

    expect(readPortfolioHaltState("binance:user-a:live").streakLastTrippedAtMs).toBe(11);
    expect(readPortfolioHaltState("kraken:user-a:live").streakLastTrippedAtMs).toBe(22);
    expect(readPortfolioHaltState("binance:user-b:live").streakLastTrippedAtMs).toBeNull();
  });

  test("a stale process merges an account written by another process", () => {
    updatePortfolioHaltState("account-a", (state) => ({ ...state, streakLastTrippedAtMs: 11 }));
    const modulePath = join(import.meta.dir, "durableHaltState.ts").replace(/\\/g, "/");
    const child = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `import { updatePortfolioHaltState } from "file:///${modulePath}"; if (!updatePortfolioHaltState("account-b", s => ({...s, streakLastTrippedAtMs: 22}))) process.exit(2);`,
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          GORDON_HALT_STATE_PATH: path,
          GORDON_AUDIT_HMAC_KEY: "test-halt-state-key",
        },
      },
    );
    expect(child.exitCode).toBe(0);

    // This process still has account-a cached. Its next write must reload and
    // merge account-b under the lock rather than erasing it.
    updatePortfolioHaltState("account-a", (state) => ({ ...state, streakLastTrippedAtMs: 33 }));
    reloadDurableHaltStateForTesting();
    expect(readPortfolioHaltState("account-a").streakLastTrippedAtMs).toBe(33);
    expect(readPortfolioHaltState("account-b").streakLastTrippedAtMs).toBe(22);
  });

  test("the give-back gate survives reload without leaking into another account", () => {
    const env = {
      GORDON_STREAK_CIRCUIT_BREAKER: "0",
      GORDON_GIVE_BACK_STOP: "1",
      GORDON_ABSORBING_BARRIER: "0",
    } as NodeJS.ProcessEnv;
    const evaluate = (portfolioIdentity: string, currentEquityUsd: number) =>
      evaluatePreTradeHaltGates({
        currentEquityUsd,
        exposureReducing: false,
        portfolioIdentity,
        env,
        debriefPath: join(dir, "missing-debriefs.jsonl"),
      });

    expect(evaluate("binance:user-a:live", 10_000).blocks).toEqual([]);
    expect(evaluate("binance:user-a:live", 12_000).blocks).toEqual([]);
    reloadDurableHaltStateForTesting();

    expect(evaluate("binance:user-a:live", 10_500).blocks[0]?.gate).toBe("GORDON_GIVE_BACK_STOP");
    expect(evaluate("binance:user-b:live", 10_500).blocks).toEqual([]);
  });

  test("a corrupt authenticated state reports an integrity error", () => {
    updatePortfolioHaltState("binance:user-a:live", (state) => ({
      ...state,
      streakLastTrippedAtMs: 11,
    }));
    writeFileSync(path, '{"version":1,"portfolios":{},"signature":"tampered"}');

    reloadDurableHaltStateForTesting();

    expect(haltStateIntegrityError()).toContain("signature");
  });

  test("corrupt state refuses new risk but never traps an exposure reduction", () => {
    writeFileSync(path, '{"version":1,"portfolios":{},"signature":"tampered"}');
    reloadDurableHaltStateForTesting();
    const env = {
      GORDON_STREAK_CIRCUIT_BREAKER: "1",
      GORDON_GIVE_BACK_STOP: "1",
      GORDON_ABSORBING_BARRIER: "1",
    } as NodeJS.ProcessEnv;

    const entry = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      portfolioIdentity: "binance:user-a:live",
      env,
      debriefPath: join(dir, "missing-debriefs.jsonl"),
    });
    const exit = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: true,
      portfolioIdentity: "binance:user-a:live",
      env,
      debriefPath: join(dir, "missing-debriefs.jsonl"),
    });

    expect(entry.blocks[0]?.reason).toContain("authenticated halt state unavailable");
    expect(exit.blocks).toEqual([]);
    expect(exit.warnings.join(" ")).toContain("reduces existing exposure");
  });

  test("a file replaced after the process cache was primed is caught before a streak-only gate", () => {
    updatePortfolioHaltState("binance:user-a:live", (state) => ({
      ...state,
      streakLastTrippedAtMs: 11,
    }));
    expect(haltStateIntegrityError()).toBeNull();

    // Models an atomic replacement by another process after this process has
    // already loaded a valid ledger. Give-back and barrier are deliberately
    // off: neither may be required to refresh the file before the fail-closed
    // integrity decision.
    writeFileSync(path, '{"version":1,"portfolios":{},"signature":"tampered"}');
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      portfolioIdentity: "binance:user-a:live",
      env: {
        GORDON_STREAK_CIRCUIT_BREAKER: "1",
        GORDON_GIVE_BACK_STOP: "0",
        GORDON_ABSORBING_BARRIER: "0",
      },
      debriefPath: join(dir, "missing-debriefs.jsonl"),
    });

    expect(verdict.blocks[0]?.reason).toContain("authenticated halt state unavailable");
    expect(verdict.blocks[0]?.reason).toContain("signature");
  });

  test("a ledger deleted after this process observed it stays fail-closed", () => {
    expect(
      updatePortfolioHaltState("binance:user-a:live", (state) => ({
        ...state,
        streakLastTrippedAtMs: 11,
      })),
    ).toBe(true);
    expect(haltStateIntegrityError()).toBeNull();

    rmSync(path);

    expect(haltStateIntegrityError()).toContain("disappeared after it was observed");
    const verdict = evaluatePreTradeHaltGates({
      currentEquityUsd: 10_000,
      exposureReducing: false,
      portfolioIdentity: "binance:user-a:live",
      env: {
        GORDON_STREAK_CIRCUIT_BREAKER: "1",
        GORDON_GIVE_BACK_STOP: "0",
        GORDON_ABSORBING_BARRIER: "0",
      },
      debriefPath: join(dir, "missing-debriefs.jsonl"),
    });
    expect(verdict.blocks[0]?.reason).toContain("authenticated halt state unavailable");
  });

  test("a simulated fresh process cannot distinguish a deleted ledger from first launch", () => {
    expect(
      updatePortfolioHaltState("binance:user-a:live", (state) => ({
        ...state,
        streakLastTrippedAtMs: 11,
      })),
    ).toBe(true);
    rmSync(path);

    reloadDurableHaltStateForTesting();

    expect(haltStateIntegrityError()).toBeNull();
    expect(readPortfolioHaltState("binance:user-a:live").streakLastTrippedAtMs).toBeNull();
  });

  test("bounded lock retry absorbs a short healthy sibling write", async () => {
    const readyPath = join(dir, "lock-ready");
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { writeFileSync, unlinkSync } from "node:fs"; writeFileSync(${JSON.stringify(`${path}.lock`)}, "sibling"); writeFileSync(${JSON.stringify(readyPath)}, "ready"); await Bun.sleep(35); unlinkSync(${JSON.stringify(`${path}.lock`)});`,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    for (let attempts = 0; attempts < 50 && !existsSync(readyPath); attempts += 1) {
      await Bun.sleep(2);
    }
    expect(existsSync(readyPath)).toBe(true);

    expect(
      updatePortfolioHaltState("binance:user-a:live", (state) => ({
        ...state,
        streakLastTrippedAtMs: 11,
      })),
    ).toBe(true);
    expect(await child.exited).toBe(0);
    expect(haltStateIntegrityError()).toBeNull();
  });

  test("a fresh inter-process lock failure stays fail-closed until explicit recovery", () => {
    expect(
      updatePortfolioHaltState("binance:user-a:live", (state) => ({
        ...state,
        streakLastTrippedAtMs: 11,
      })),
    ).toBe(true);

    // A live sibling process owns the lock, so this process cannot durably
    // record the newly observed give-back/barrier state. The old ledger remains
    // valid on disk; re-reading it must not erase the transient write failure.
    writeFileSync(`${path}.lock`, "live sibling");
    expect(
      updatePortfolioHaltState("binance:user-a:live", (state) => ({
        ...state,
        barrierState: {
          referenceCapitalUsd: 10_000,
          highWaterMarkUsd: 12_000,
          closedEpisodeLossUsd: 0,
          troughSinceHighWaterUsd: 10_000,
          lastEquityUsd: 10_000,
          tripped: true,
          trippedBy: "trailing_high_water",
          trippedAtEquityUsd: 10_000,
          trippedAtLossFraction: 1 / 6,
        },
      })),
    ).toBe(false);

    const evaluate = (exposureReducing: boolean) =>
      evaluatePreTradeHaltGates({
        currentEquityUsd: 10_000,
        exposureReducing,
        portfolioIdentity: "binance:user-a:live",
        env: {
          GORDON_STREAK_CIRCUIT_BREAKER: "0",
          GORDON_GIVE_BACK_STOP: "1",
          GORDON_ABSORBING_BARRIER: "1",
        },
        debriefPath: join(dir, "missing-debriefs.jsonl"),
      });

    expect(evaluate(false).blocks[0]?.reason).toContain("authenticated halt state unavailable");
    expect(evaluate(false).blocks[0]?.reason).toContain("locked by another process");
    expect(evaluate(true).blocks).toEqual([]);
    expect(evaluate(true).warnings.join(" ")).toContain("reduces existing exposure");

    rmSync(`${path}.lock`);
    expect(
      updatePortfolioHaltState("binance:user-b:live", (state) => ({
        ...state,
        streakLastTrippedAtMs: 22,
      })),
    ).toBe(true);
    expect(haltStateIntegrityError()).toContain("locked by another process");

    expect(archiveAndResetHaltState("operator reviewed the missed safety observation").ok).toBe(
      true,
    );
    expect(haltStateIntegrityError()).toBeNull();
  });

  test("scoped loss history trips only its account and remains scoped after restart", () => {
    const debriefPath = join(dir, "scoped-debriefs.jsonl");
    const now = Date.now() + 1_000;
    const accountA = "binance:account:acct-a:live";
    const accountB = "binance:account:acct-b:live";
    for (let index = 0; index < 3; index += 1) {
      expect(
        recordTradeClosureDebrief(
          {
            tradeId: `trade-${index}`,
            symbol: "BTCUSDT",
            pnlUsd: -100,
            pnlPercent: -1,
            portfolioIdentity: accountA,
            reason: "stop_loss",
          },
          process.env,
          debriefPath,
        ),
      ).not.toBeNull();
    }
    // The teaching log is explicitly non-authoritative for streak safety.
    // Truncating it before restart must not forgive authenticated losses.
    writeFileSync(debriefPath, "{truncated\n");
    const env = {
      GORDON_STREAK_CIRCUIT_BREAKER: "1",
      GORDON_GIVE_BACK_STOP: "0",
      GORDON_ABSORBING_BARRIER: "0",
    } as NodeJS.ProcessEnv;
    const evaluate = (portfolioIdentity: string) =>
      evaluatePreTradeHaltGates({
        currentEquityUsd: 10_000,
        exposureReducing: false,
        portfolioIdentity,
        nowMs: now,
        env,
        debriefPath,
      });

    expect(evaluate(accountA).blocks[0]?.gate).toBe("GORDON_STREAK_CIRCUIT_BREAKER");
    reloadDurableHaltStateForTesting();
    expect(evaluate(accountA).blocks[0]?.reason).toContain("Cooldown in progress");
    expect(evaluate(accountB).blocks).toEqual([]);
  });

  test("a confirmed-close outcome persistence failure blocks new risk but allows reductions", () => {
    const debriefPath = join(dir, "unwritten-debriefs.jsonl");
    writeFileSync(`${path}.lock`, "live sibling");

    expect(
      recordTradeClosureDebrief(
        {
          tradeId: "trade-write-failure",
          symbol: "BTCUSDT",
          pnlUsd: -100,
          pnlPercent: -1,
          portfolioIdentity: "binance:account:acct-a:live",
          reason: "stop_loss",
        },
        process.env,
        debriefPath,
      ),
    ).toBeNull();
    expect(existsSync(debriefPath)).toBe(false);

    const evaluate = (exposureReducing: boolean) =>
      evaluatePreTradeHaltGates({
        currentEquityUsd: 10_000,
        exposureReducing,
        portfolioIdentity: "binance:account:acct-a:live",
        env: {
          GORDON_STREAK_CIRCUIT_BREAKER: "1",
          GORDON_GIVE_BACK_STOP: "0",
          GORDON_ABSORBING_BARRIER: "0",
        },
        debriefPath,
      });

    expect(evaluate(false).blocks[0]?.reason).toContain("locked by another process");
    expect(evaluate(true).blocks).toEqual([]);
  });

  test("corrupt state can only be replaced through an archived rationale-bearing reset", () => {
    writeFileSync(path, '{"version":1,"portfolios":{},"signature":"tampered"}');
    reloadDurableHaltStateForTesting();
    expect(archiveAndResetHaltState("too short").ok).toBe(false);
    expect(readFileSync(path, "utf8")).toContain("tampered");

    const reset = archiveAndResetHaltState("rotated the operator signing key");

    expect(reset.ok).toBe(true);
    expect(reset.archivePath).toBeTruthy();
    expect(existsSync(reset.archivePath!)).toBe(true);
    expect(readFileSync(reset.archivePath!, "utf8")).toContain("tampered");
    expect(haltStateIntegrityError()).toBeNull();
  });
});
