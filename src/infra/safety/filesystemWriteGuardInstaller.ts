import type * as Fs from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { createModuleLogger } from "../logger/index.ts";
import {
  enforceWrite,
  getGuardMode,
  isFilesystemWriteGuardEnabled,
  resultToPayload,
  type GuardMode,
} from "./filesystemWriteGuard.ts";

const logger = createModuleLogger("filesystem-write-guard");
const require = createRequire(import.meta.url);
const fs = require("node:fs") as typeof Fs;
const fsPromises = require("node:fs/promises") as typeof FsPromises;

const MAX_RECENT_VIOLATIONS = 20;

let installed = false;
let warnViolations = 0;
const recentViolations: string[] = [];

export interface FilesystemWriteGuardStatus {
  installed: boolean;
  enabled: boolean;
  mode: GuardMode;
  /** Count of allowlist misses observed in warn mode (logged + allowed). */
  warnViolations: number;
  /** Last-N offending resolved paths, oldest first. */
  recentViolations: readonly string[];
}

export function isFilesystemWriteGuardInstalled(): FilesystemWriteGuardStatus {
  return {
    installed,
    enabled: isFilesystemWriteGuardEnabled(),
    mode: getGuardMode(),
    warnViolations,
    recentViolations: [...recentViolations],
  };
}

export function resetFilesystemWriteGuardStatsForTesting(): void {
  warnViolations = 0;
  recentViolations.length = 0;
}

function forwardCall<T extends (...args: never) => unknown>(
  fn: T,
  thisArg: unknown,
  args: unknown[],
): ReturnType<T> {
  return Reflect.apply(fn, thisArg, args) as ReturnType<T>;
}

function pathToString(path: Fs.PathLike): string {
  if (path instanceof URL) return fileURLToPath(path);
  return path.toString();
}

/**
 * Check one write path against the allowlist. Throws `BlockedWriteError`
 * in block mode; in warn mode logs, records the violation, and returns.
 * Exported as the testable seam — tests exercise this without patching
 * `node:fs` or performing real writes.
 */
export function guardWritePath(path: Fs.PathLike, caller: string): void {
  if (!isFilesystemWriteGuardEnabled()) return;
  const result = enforceWrite({ path: pathToString(path), caller });
  if (!result.allowed) {
    // Only reachable in warn mode — block mode throws inside enforceWrite.
    warnViolations += 1;
    recentViolations.push(result.resolvedPath);
    if (recentViolations.length > MAX_RECENT_VIOLATIONS) recentViolations.shift();
    logger.warn("Filesystem write outside allowlist", resultToPayload(result, caller));
  }
}

/** Mutators whose target path is the FIRST argument. */
const DESTINATION_FIRST_MUTATORS = ["unlinkSync", "rmSync", "rmdirSync", "truncateSync"] as const;
/** Mutators whose created/overwritten path is the SECOND argument. */
const DESTINATION_SECOND_MUTATORS = [
  "renameSync",
  "copyFileSync",
  "linkSync",
  "symlinkSync",
] as const;

function patchFirstPathArg(
  target: Record<string, unknown>,
  thisArg: unknown,
  key: string,
  caller: string,
): void {
  const original = target[key];
  if (typeof original !== "function") return;
  const bound = (original as (...a: unknown[]) => unknown).bind(thisArg);
  target[key] = (...args: unknown[]) => {
    const p = args[0];
    if (typeof p === "string" || p instanceof URL || p instanceof Buffer) {
      guardWritePath(p as Fs.PathLike, caller);
    }
    return bound(...args);
  };
}

function patchSecondPathArg(
  target: Record<string, unknown>,
  thisArg: unknown,
  key: string,
  caller: string,
): void {
  const original = target[key];
  if (typeof original !== "function") return;
  const bound = (original as (...a: unknown[]) => unknown).bind(thisArg);
  target[key] = (...args: unknown[]) => {
    const p = args[1];
    if (typeof p === "string" || p instanceof URL || p instanceof Buffer) {
      guardWritePath(p as Fs.PathLike, caller);
    }
    return bound(...args);
  };
}

/**
 * `Bun.write` is the runtime's own file-writing API and bypasses `node:fs`
 * entirely. On Bun it is the shortest path around the guard, so it gets the
 * same allowlist check. No-op on non-Bun runtimes.
 */
function installBunWriteGuard(): void {
  const bun = (globalThis as { Bun?: Record<string, unknown> }).Bun;
  if (!bun || typeof bun.write !== "function") return;
  const originalWrite = bun.write as (...a: unknown[]) => unknown;
  bun.write = (...args: unknown[]) => {
    const dest = args[0];
    if (typeof dest === "string" || dest instanceof URL) {
      guardWritePath(dest as Fs.PathLike, "Bun.write");
    } else if (
      dest &&
      typeof dest === "object" &&
      typeof (dest as { name?: unknown }).name === "string"
    ) {
      // BunFile — its `name` is the path it was opened against.
      guardWritePath((dest as { name: string }).name, "Bun.write");
    }
    return originalWrite(...args);
  };
}

export function installFilesystemWriteGuard(): void {
  if (installed) return;
  installed = true;

  const mutableFs = fs as unknown as Record<string, unknown>;
  const originalWriteFileSync = fs.writeFileSync.bind(fs);
  const originalAppendFileSync = fs.appendFileSync.bind(fs);
  const originalMkdirSync = fs.mkdirSync.bind(fs);
  const originalCreateWriteStream = fs.createWriteStream.bind(fs);

  mutableFs.writeFileSync = ((file: Fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof file !== "number") guardWritePath(file, "fs.writeFileSync");
    return forwardCall(originalWriteFileSync, fs, [file, ...args]);
  }) as typeof fs.writeFileSync;

  mutableFs.appendFileSync = ((file: Fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof file !== "number") guardWritePath(file, "fs.appendFileSync");
    return forwardCall(originalAppendFileSync, fs, [file, ...args]);
  }) as typeof fs.appendFileSync;

  mutableFs.mkdirSync = ((path: Fs.PathLike, ...args: unknown[]) => {
    guardWritePath(path, "fs.mkdirSync");
    return forwardCall(originalMkdirSync, fs, [path, ...args]);
  }) as typeof fs.mkdirSync;

  mutableFs.createWriteStream = ((path: Fs.PathLike, ...args: unknown[]) => {
    guardWritePath(path, "fs.createWriteStream");
    return forwardCall(originalCreateWriteStream, fs, [path, ...args]);
  }) as typeof fs.createWriteStream;

  const mutablePromises = fsPromises as unknown as Record<string, unknown>;
  const originalWriteFile = fsPromises.writeFile.bind(fsPromises);
  const originalAppendFile = fsPromises.appendFile.bind(fsPromises);
  const originalMkdir = fsPromises.mkdir.bind(fsPromises);

  mutablePromises.writeFile = (async (
    file: Fs.PathLike | FsPromises.FileHandle,
    ...args: unknown[]
  ) => {
    if (!(file && typeof file === "object" && "fd" in file))
      guardWritePath(file as Fs.PathLike, "fs.promises.writeFile");
    return forwardCall(originalWriteFile, fsPromises, [file, ...args]);
  }) as typeof fsPromises.writeFile;

  mutablePromises.appendFile = (async (
    file: Fs.PathLike | FsPromises.FileHandle,
    ...args: unknown[]
  ) => {
    if (!(file && typeof file === "object" && "fd" in file))
      guardWritePath(file as Fs.PathLike, "fs.promises.appendFile");
    return forwardCall(originalAppendFile, fsPromises, [file, ...args]);
  }) as typeof fsPromises.appendFile;

  mutablePromises.mkdir = (async (path: Fs.PathLike, ...args: unknown[]) => {
    guardWritePath(path, "fs.promises.mkdir");
    return forwardCall(originalMkdir, fsPromises, [path, ...args]);
  }) as typeof fsPromises.mkdir;

  // Mutating entry points that are not "write a buffer to a file" but still
  // change the filesystem outside the allowlist. Without these the guard is
  // trivially walked around: renameSync into ~/.ssh, unlink of /etc/hosts,
  // or a symlink planted to redirect a later allowlisted write.
  //
  // For two-path calls (rename, copyFile, link, symlink) the guarded path is
  // the DESTINATION — that is what gets created or overwritten. `symlink`
  // takes (target, path), so its destination is the second argument.
  for (const name of DESTINATION_FIRST_MUTATORS) {
    patchFirstPathArg(mutableFs, fs, name, `fs.${name}`);
    patchFirstPathArg(
      mutablePromises,
      fsPromises,
      name.replace(/Sync$/, ""),
      `fs.promises.${name.replace(/Sync$/, "")}`,
    );
  }
  for (const name of DESTINATION_SECOND_MUTATORS) {
    patchSecondPathArg(mutableFs, fs, name, `fs.${name}`);
    patchSecondPathArg(
      mutablePromises,
      fsPromises,
      name.replace(/Sync$/, ""),
      `fs.promises.${name.replace(/Sync$/, "")}`,
    );
  }

  installBunWriteGuard();

  try {
    syncBuiltinESMExports();
  } catch (err) {
    logger.warn("Could not sync patched fs exports", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
