import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface DurableFileOperations {
  platform: NodeJS.Platform;
  mkdir(path: string): void;
  open(path: string, flags: string, mode?: number): number;
  write(fd: number, contents: string): void;
  sync(fd: number): void;
  close(fd: number): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
}

const nodeFileOperations: DurableFileOperations = {
  platform: process.platform,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  open: (path, flags, mode) => openSync(path, flags, mode),
  write: (fd, contents) => writeFileSync(fd, contents, { encoding: "utf8" }),
  sync: fsyncSync,
  close: closeSync,
  rename: renameSync,
  unlink: unlinkSync,
};

let writeSequence = 0;

/**
 * Replace a file only after its bytes and the resulting name are flushed.
 * Windows cannot fsync a directory through Bun/Node, so FlushFileBuffers is
 * issued on the renamed destination handle instead.
 */
export function replaceFileCrashDurably(
  path: string,
  contents: string,
  operations: DurableFileOperations = nodeFileOperations,
): void {
  const parent = dirname(path);
  operations.mkdir(parent);
  const temporary = `${path}.${process.pid}.${Date.now()}.${writeSequence++}.tmp`;
  let temporaryFd: number | null = null;
  let postRenameFd: number | null = null;
  let temporaryCreated = false;
  let renamed = false;

  try {
    temporaryFd = operations.open(temporary, "wx", 0o600);
    temporaryCreated = true;
    operations.write(temporaryFd, contents);
    operations.sync(temporaryFd);
    operations.close(temporaryFd);
    temporaryFd = null;

    operations.rename(temporary, path);
    renamed = true;
    postRenameFd = operations.open(
      operations.platform === "win32" ? path : parent,
      operations.platform === "win32" ? "r+" : "r",
    );
    operations.sync(postRenameFd);
    operations.close(postRenameFd);
    postRenameFd = null;
  } catch (error) {
    if (temporaryFd !== null) {
      try {
        operations.close(temporaryFd);
      } catch {
        // Preserve the persistence failure that caused cleanup.
      }
      temporaryFd = null;
    }
    if (temporaryCreated && !renamed) {
      try {
        operations.unlink(temporary);
      } catch {
        // A stale exclusive temp file is harmless and never treated as state.
      }
    }
    throw error;
  } finally {
    if (postRenameFd !== null) {
      try {
        operations.close(postRenameFd);
      } catch {
        // The caller already receives the failed flush/open operation.
      }
    }
  }
}
