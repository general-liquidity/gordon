/**
 * Filesystem write-guard escape coverage.
 *
 * The guard's docstring claims that a tool trying to write `~/.ssh/...` or
 * `/etc/passwd` is caught. It only patched writeFileSync / appendFileSync /
 * mkdirSync / createWriteStream and their promise twins, which left four ways
 * out: `Bun.write` (the runtime's own writer), path-moving calls
 * (rename / copyFile / link / symlink), deletion calls (unlink / rm / rmdir /
 * truncate), and symlink traversal (no realpath resolution, so a link planted
 * inside the allowlist redirected writes anywhere).
 *
 * Every test here failed before those holes were closed.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  addAllowedPath,
  checkWrite,
  FILESYSTEM_WRITE_GUARD_FLAG_ENV,
  FILESYSTEM_WRITE_GUARD_MODE_ENV,
  resetGuardForTesting,
} from "./filesystemWriteGuard.ts";
import {
  installFilesystemWriteGuard,
  resetFilesystemWriteGuardStatsForTesting,
} from "./filesystemWriteGuardInstaller.ts";

const OUTSIDE_PATH = join(homedir(), ".ssh", "gordon-guard-escape-not-real");
const tempDirs: string[] = [];

beforeEach(() => {
  resetGuardForTesting();
  resetFilesystemWriteGuardStatsForTesting();
  delete process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV];
  process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV] = "block";
});

afterEach(() => {
  delete process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV];
  resetFilesystemWriteGuardStatsForTesting();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("symlink traversal", () => {
  test("a symlink inside the allowlist cannot redirect a write outside it", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "gordon-guard-real-"));
    const outside = mkdtempSync(join(tmpdir(), "gordon-guard-target-"));
    tempDirs.push(sandbox, outside);

    // Only `sandbox` is allowlisted. `outside` is not.
    resetGuardForTesting();
    addAllowedPath({ prefix: sandbox, reason: "test sandbox" });

    const link = join(sandbox, "escape");
    try {
      symlinkSync(outside, link, "dir");
    } catch {
      // Symlink creation needs privileges on some Windows configs. Nothing to
      // assert if the escape cannot be constructed in the first place.
      return;
    }
    expect(existsSync(link)).toBe(true);

    const throughLink = join(link, "stolen.txt");
    const result = checkWrite(
      { path: throughLink },
      { mode: "warn", rules: [{ prefix: sandbox }] },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("symlink");
  });

  test("an ordinary path inside the allowlist is still allowed", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "gordon-guard-plain-"));
    tempDirs.push(sandbox);
    mkdirSync(join(sandbox, "nested"), { recursive: true });
    const result = checkWrite(
      { path: join(sandbox, "nested", "ok.txt") },
      { mode: "warn", rules: [{ prefix: sandbox }] },
    );
    expect(result.allowed).toBe(true);
  });
});

describe("patched fs entry points", () => {
  // The guard patches node:fs in place and cannot be uninstalled, so every
  // assertion below runs against the installed guard in block mode.
  installFilesystemWriteGuard();
  const fs = require("node:fs") as typeof import("node:fs");

  test("renameSync destination is guarded", () => {
    expect(() => fs.renameSync(join(homedir(), ".gordon", "x"), OUTSIDE_PATH)).toThrow(
      /Filesystem write blocked/,
    );
  });

  test("copyFileSync destination is guarded", () => {
    expect(() => fs.copyFileSync(join(homedir(), ".gordon", "x"), OUTSIDE_PATH)).toThrow(
      /Filesystem write blocked/,
    );
  });

  test("symlinkSync destination is guarded", () => {
    expect(() => fs.symlinkSync(join(homedir(), ".gordon"), OUTSIDE_PATH)).toThrow(
      /Filesystem write blocked/,
    );
  });

  test("unlinkSync target is guarded", () => {
    expect(() => fs.unlinkSync(OUTSIDE_PATH)).toThrow(/Filesystem write blocked/);
  });

  test("rmSync target is guarded", () => {
    expect(() => fs.rmSync(OUTSIDE_PATH, { force: true })).toThrow(/Filesystem write blocked/);
  });

  test("truncateSync target is guarded", () => {
    expect(() => fs.truncateSync(OUTSIDE_PATH)).toThrow(/Filesystem write blocked/);
  });

  test("an allowlisted rename destination still passes the guard", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "gordon-"));
    tempDirs.push(sandbox);
    const src = join(sandbox, "a.txt");
    const dst = join(sandbox, "b.txt");
    writeFileSync(src, "x", "utf-8");
    expect(() => fs.renameSync(src, dst)).not.toThrow();
    expect(existsSync(dst)).toBe(true);
  });

  test("Bun.write destination is guarded", async () => {
    const bunWrite = (globalThis as { Bun?: { write?: unknown } }).Bun?.write;
    if (typeof bunWrite !== "function") return;
    let threw: unknown = null;
    try {
      await (bunWrite as (p: string, d: string) => Promise<number>)(OUTSIDE_PATH, "data");
    } catch (err) {
      threw = err;
    }
    expect(String(threw)).toContain("Filesystem write blocked");
  });
});
