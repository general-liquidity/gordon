import { describe, expect, test } from "bun:test";
import ansiEscapes from "ansi-escapes";

import { installAlternateScreen, type Instance } from "./render.ts";

const ENTER = ansiEscapes.enterAlternativeScreen;
const EXIT = ansiEscapes.exitAlternativeScreen;

class FakeTty {
  isTTY: boolean;
  chunks: string[] = [];
  constructor(isTTY = true) {
    this.isTTY = isTTY;
  }
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
}

function fakeInstance(calls: string[]): Instance {
  let resolveExit: () => void = () => {};
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  return {
    rerender: () => calls.push("rerender"),
    unmount: () => calls.push("unmount"),
    waitUntilExit: () => exitPromise,
    cleanup: () => calls.push("cleanup"),
    clear: () => calls.push("clear"),
    // Expose the exit resolver for the waitUntilExit test.
    __resolveExit: resolveExit,
  } as unknown as Instance & { __resolveExit: () => void };
}

describe("installAlternateScreen", () => {
  test("enters the alt buffer on mount and restores the primary screen on unmount", () => {
    const out = new FakeTty();
    const calls: string[] = [];
    const wrapped = installAlternateScreen(
      fakeInstance(calls),
      out as unknown as NodeJS.WriteStream,
      true,
    );

    expect(out.chunks).toEqual([ENTER]);

    wrapped.unmount();

    // Underlying unmount ran, then the alt buffer was left.
    expect(calls).toContain("unmount");
    expect(out.chunks).toEqual([ENTER, EXIT]);
  });

  test("restores at most once across unmount + cleanup", () => {
    const out = new FakeTty();
    const wrapped = installAlternateScreen(
      fakeInstance([]),
      out as unknown as NodeJS.WriteStream,
      true,
    );
    wrapped.unmount();
    wrapped.cleanup();
    // Only a single exit sequence, even though two teardown paths fired.
    expect(out.chunks.filter((c) => c === EXIT)).toHaveLength(1);
  });

  test("restores when the app exits via waitUntilExit", async () => {
    const out = new FakeTty();
    const inst = fakeInstance([]) as Instance & { __resolveExit: () => void };
    const wrapped = installAlternateScreen(
      inst,
      out as unknown as NodeJS.WriteStream,
      true,
    );
    const done = wrapped.waitUntilExit();
    inst.__resolveExit();
    await done;
    expect(out.chunks).toEqual([ENTER, EXIT]);
  });

  test("is a no-op when disabled", () => {
    const out = new FakeTty();
    const wrapped = installAlternateScreen(
      fakeInstance([]),
      out as unknown as NodeJS.WriteStream,
      false,
    );
    wrapped.unmount();
    expect(out.chunks).toEqual([]);
  });

  test("is a no-op when stdout is not a TTY", () => {
    const out = new FakeTty(false);
    const wrapped = installAlternateScreen(
      fakeInstance([]),
      out as unknown as NodeJS.WriteStream,
      true,
    );
    wrapped.unmount();
    expect(out.chunks).toEqual([]);
  });
});
