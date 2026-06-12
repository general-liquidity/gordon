import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { acquireInstanceLock, InstanceLockCollisionError, isPidAlive } from "./instanceLock.ts";

const dir = join(tmpdir(), `gordon-instance-lock-${process.pid}`);
const file = join(dir, "tui.lock");
let previousHome: string | undefined;
let previousAllow: string | undefined;

describe("instanceLock", () => {
  beforeEach(() => {
    previousHome = process.env.GORDON_HOME;
    previousAllow = process.env.GORDON_ALLOW_MULTI_INSTANCE;
    process.env.GORDON_HOME = dir;
    delete process.env.GORDON_ALLOW_MULTI_INSTANCE;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.GORDON_HOME;
    else process.env.GORDON_HOME = previousHome;
    if (previousAllow === undefined) delete process.env.GORDON_ALLOW_MULTI_INSTANCE;
    else process.env.GORDON_ALLOW_MULTI_INSTANCE = previousAllow;
    rmSync(dir, { recursive: true, force: true });
  });

  test("acquires and releases a lock", () => {
    const lock = acquireInstanceLock("tui", { force: true });
    expect(lock).toBeTruthy();
    expect(existsSync(file)).toBe(true);
    const info = JSON.parse(readFileSync(file, "utf-8"));
    expect(info.pid).toBe(process.pid);
    lock?.release();
    expect(existsSync(file)).toBe(false);
  });

  test("stale and corrupt locks are recovered", () => {
    writeFileSync(file, JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString(), cwd: "/tmp" }));
    const stale = acquireInstanceLock("tui", { force: true });
    expect(stale).toBeTruthy();
    stale?.release();

    writeFileSync(file, "{");
    const corrupt = acquireInstanceLock("tui", { force: true });
    expect(corrupt).toBeTruthy();
    corrupt?.release();
  });

  test("live foreign lock returns null", () => {
    const pid = process.ppid || process.pid;
    writeFileSync(file, JSON.stringify({ pid, startedAt: new Date().toISOString(), cwd: "/foreign" }));
    expect(() => acquireInstanceLock("tui", { force: true })).toThrow(InstanceLockCollisionError);
  });

  test("release does not remove a successor lock", () => {
    const lock = acquireInstanceLock("tui", { force: true });
    writeFileSync(file, JSON.stringify({ pid: 999998, startedAt: new Date().toISOString(), cwd: "/successor" }));
    lock?.release();
    expect(existsSync(file)).toBe(true);
  });

  test("pid liveness helper", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(999999999)).toBe(false);
  });
});
