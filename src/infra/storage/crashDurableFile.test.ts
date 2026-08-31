import { describe, expect, test } from "bun:test";

import { replaceFileCrashDurably, type DurableFileOperations } from "./crashDurableFile.ts";

function recordingOperations(
  platform: NodeJS.Platform,
  failSyncCall?: number,
): { operations: DurableFileOperations; calls: string[] } {
  const calls: string[] = [];
  let nextFd = 10;
  let syncCalls = 0;
  const operations: DurableFileOperations = {
    platform,
    mkdir: (path) => calls.push(`mkdir:${path}`),
    open: (path, flags, mode) => {
      calls.push(`open:${path}:${flags}:${mode ?? ""}`);
      return nextFd++;
    },
    write: (fd, contents) => calls.push(`write:${fd}:${contents}`),
    sync: (fd) => {
      syncCalls += 1;
      calls.push(`sync:${fd}`);
      if (syncCalls === failSyncCall) throw new Error(`sync ${syncCalls} failed`);
    },
    close: (fd) => calls.push(`close:${fd}`),
    rename: (from, to) => calls.push(`rename:${from}:${to}`),
    unlink: (path) => calls.push(`unlink:${path}`),
  };
  return { operations, calls };
}

describe("crash-durable file replacement", () => {
  test("flushes bytes before rename and the parent directory after it on POSIX", () => {
    const { operations, calls } = recordingOperations("linux");

    replaceFileCrashDurably("/state/halt.json", "signed", operations);

    expect(calls[0]).toBe("mkdir:/state");
    expect(calls[1]).toMatch(/^open:\/state\/halt\.json\..+\.tmp:wx:384$/);
    expect(calls.slice(2, 5)).toEqual(["write:10:signed", "sync:10", "close:10"]);
    expect(calls[5]).toMatch(/^rename:\/state\/halt\.json\..+\.tmp:\/state\/halt\.json$/);
    expect(calls.slice(6)).toEqual(["open:/state:r:", "sync:11", "close:11"]);
  });

  test("flushes the renamed destination on Windows where directory fsync is unavailable", () => {
    const { operations, calls } = recordingOperations("win32");

    replaceFileCrashDurably("C:\\state\\halt.json", "signed", operations);

    expect(calls.slice(-3)).toEqual(["open:C:\\state\\halt.json:r+:", "sync:11", "close:11"]);
  });

  test("never renames bytes whose file flush failed and removes the exclusive temp", () => {
    const { operations, calls } = recordingOperations("linux", 1);

    expect(() => replaceFileCrashDurably("/state/halt.json", "signed", operations)).toThrow(
      "sync 1 failed",
    );
    expect(calls.some((call) => call.startsWith("rename:"))).toBe(false);
    expect(calls.at(-1)).toMatch(/^unlink:\/state\/halt\.json\..+\.tmp$/);
  });

  test("reports a post-rename metadata flush failure instead of claiming durability", () => {
    const { operations, calls } = recordingOperations("linux", 2);

    expect(() => replaceFileCrashDurably("/state/halt.json", "signed", operations)).toThrow(
      "sync 2 failed",
    );
    expect(calls.some((call) => call.startsWith("rename:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("unlink:"))).toBe(false);
  });
});
