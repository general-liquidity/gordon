import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getGordonDir } from "./paths.ts";

export interface InstanceLockInfo {
  pid: number;
  startedAt: string;
  cwd: string;
}

export interface InstanceLock {
  path: string;
  pid: number;
  info: InstanceLockInfo;
  release(): void;
}

export class InstanceLockCollisionError extends Error {
  readonly path: string;
  readonly pid: number | null;
  readonly holder: InstanceLockInfo | null;

  constructor(path: string, holder: InstanceLockInfo | null) {
    super(
      holder?.pid
        ? `Another Gordon instance is already running (pid ${holder.pid}).`
        : "Another Gordon instance is already running.",
    );
    this.name = "InstanceLockCollisionError";
    this.path = path;
    this.pid = holder?.pid ?? null;
    this.holder = holder;
  }
}

export function acquireInstanceLock(
  name = "tui",
  options?: { force?: boolean },
): InstanceLock | null {
  if (
    !options?.force &&
    (process.env.NODE_ENV === "test" || process.env.GORDON_ALLOW_MULTI_INSTANCE === "1")
  ) {
    return null;
  }

  const path = join(getGordonDir(), `${name}.lock`);
  mkdirSync(dirname(path), { recursive: true });
  const info: InstanceLockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };

  try {
    writeFileSync(path, JSON.stringify(info), { flag: "wx" });
    return createLock(path, info);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const holder = readLockInfo(path);
    if (holder && holder.pid !== process.pid && isPidAlive(holder.pid)) {
      throw new InstanceLockCollisionError(path, holder);
    }
    try {
      unlinkSync(path);
    } catch {
      throw new InstanceLockCollisionError(path, readLockInfo(path));
    }
    try {
      writeFileSync(path, JSON.stringify(info), { flag: "wx" });
      return createLock(path, info);
    } catch {
      throw new InstanceLockCollisionError(path, readLockInfo(path));
    }
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

function createLock(path: string, info: InstanceLockInfo): InstanceLock {
  let released = false;
  return {
    path,
    pid: info.pid,
    info,
    release() {
      if (released) return;
      released = true;
      if (readLockInfo(path)?.pid !== process.pid) return;
      try {
        unlinkSync(path);
      } catch {
        // Best effort. A stale lock will be recovered on the next launch.
      }
    },
  };
}

function readLockInfo(path: string): InstanceLockInfo | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<InstanceLockInfo>;
    if (!Number.isInteger(parsed.pid) || parsed.pid! <= 0) return null;
    return {
      pid: parsed.pid!,
      startedAt:
        typeof parsed.startedAt === "string" ? parsed.startedAt : new Date(0).toISOString(),
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
    };
  } catch {
    return null;
  }
}
