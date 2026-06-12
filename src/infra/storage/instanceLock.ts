import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getGordonDir } from "./paths.ts";

export interface InstanceLock {
  path: string;
  pid: number;
  release(): void;
}

export class InstanceLockCollisionError extends Error {
  readonly path: string;
  readonly pid: number | null;

  constructor(path: string, pid: number | null) {
    super(pid ? `Another Gordon instance is already running (pid ${pid}).` : "Another Gordon instance is already running.");
    this.name = "InstanceLockCollisionError";
    this.path = path;
    this.pid = pid;
  }
}

export function acquireInstanceLock(name = "tui"): InstanceLock | null {
  if (process.env.NODE_ENV === "test" || process.env.GORDON_ALLOW_MULTI_INSTANCE === "1") {
    return null;
  }

  const path = join(getGordonDir(), `${name}.lock`);
  mkdirSync(dirname(path), { recursive: true });

  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return createLock(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const existingPid = readLockPid(path);
    if (existingPid !== null && isPidAlive(existingPid)) {
      throw new InstanceLockCollisionError(path, existingPid);
    }
    try {
      unlinkSync(path);
    } catch {
      const retryPid = readLockPid(path);
      throw new InstanceLockCollisionError(path, retryPid);
    }
    return acquireInstanceLock(name);
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function createLock(path: string): InstanceLock {
  let released = false;
  return {
    path,
    pid: process.pid,
    release() {
      if (released) return;
      released = true;
      if (readLockPid(path) !== process.pid) return;
      try {
        unlinkSync(path);
      } catch {
        // Best effort. A stale lock will be recovered on the next launch.
      }
    },
  };
}

function readLockPid(path: string): number | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}
