import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  BlockedWriteError,
  FILESYSTEM_WRITE_GUARD_FLAG_ENV,
  FILESYSTEM_WRITE_GUARD_MODE_ENV,
  resetGuardForTesting,
} from "./filesystemWriteGuard.ts";
import {
  guardWritePath,
  installFilesystemWriteGuard,
  isFilesystemWriteGuardInstalled,
  resetFilesystemWriteGuardStatsForTesting,
} from "./filesystemWriteGuardInstaller.ts";

// Outside the default allowlist (~/.gordon, tmp/gordon-, cwd) on every platform.
const OUTSIDE_PATH = join(homedir(), ".ssh", "gordon-guard-test-not-real");
const ALLOWED_PATH = join(homedir(), ".gordon", "guard-test.json");

beforeEach(() => {
  resetGuardForTesting();
  resetFilesystemWriteGuardStatsForTesting();
  delete process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV];
  delete process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV];
});

afterEach(() => {
  resetFilesystemWriteGuardStatsForTesting();
  delete process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV];
  delete process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV];
});

describe("isFilesystemWriteGuardInstalled — status accessor", () => {
  test("reports mode from env (warn default, block override)", () => {
    expect(isFilesystemWriteGuardInstalled().mode).toBe("warn");
    process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV] = "block";
    expect(isFilesystemWriteGuardInstalled().mode).toBe("block");
  });

  test("reports enabled flag from env", () => {
    expect(isFilesystemWriteGuardInstalled().enabled).toBe(true);
    process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV] = "0";
    expect(isFilesystemWriteGuardInstalled().enabled).toBe(false);
  });

  test("reports installed=true after installFilesystemWriteGuard", () => {
    installFilesystemWriteGuard();
    expect(isFilesystemWriteGuardInstalled().installed).toBe(true);
  });
});

describe("guardWritePath — warn-mode violation counter", () => {
  test("counts a warn-mode miss and records the resolved path", () => {
    guardWritePath(OUTSIDE_PATH, "test");
    const status = isFilesystemWriteGuardInstalled();
    expect(status.warnViolations).toBe(1);
    expect(status.recentViolations).toEqual([resolve(OUTSIDE_PATH)]);
  });

  test("does not count allowed paths", () => {
    guardWritePath(ALLOWED_PATH, "test");
    expect(isFilesystemWriteGuardInstalled().warnViolations).toBe(0);
  });

  test("caps recent violations at 20, dropping oldest first", () => {
    for (let i = 0; i < 25; i++) {
      guardWritePath(`${OUTSIDE_PATH}-${i}`, "test");
    }
    const status = isFilesystemWriteGuardInstalled();
    expect(status.warnViolations).toBe(25);
    expect(status.recentViolations).toHaveLength(20);
    expect(status.recentViolations[0]).toBe(resolve(`${OUTSIDE_PATH}-5`));
    expect(status.recentViolations[19]).toBe(resolve(`${OUTSIDE_PATH}-24`));
  });

  test("no-ops when the guard is disabled", () => {
    process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV] = "0";
    guardWritePath(OUTSIDE_PATH, "test");
    expect(isFilesystemWriteGuardInstalled().warnViolations).toBe(0);
  });

  test("block mode throws and does not count as a warn violation", () => {
    process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV] = "block";
    expect(() => guardWritePath(OUTSIDE_PATH, "test")).toThrow(BlockedWriteError);
    expect(isFilesystemWriteGuardInstalled().warnViolations).toBe(0);
  });
});
