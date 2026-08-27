/**
 * statusLineHook — pure execution + sanitization. The status row must NEVER
 * break on a bad hook, so the key assertions are the fail-closed paths
 * (timeout / spawn-fail / non-zero exit → null) and the sanitizer (ANSI strip,
 * control-char scrub, single-line collapse, render cap).
 */

import { describe, expect, it } from "bun:test";

import {
  runStatusLineHook,
  sanitizeStatusLineOutput,
  STATUS_LINE_RENDER_CAP,
  type StatusLineRunner,
  type StatusLineRunResult,
} from "./statusLineHook.ts";

// Build control sequences from char codes so no raw bytes live in the source.
const ESC = String.fromCharCode(27); // ANSI escape introducer
const BEL = String.fromCharCode(7); // a C0 control char

const ok = (stdout: string): StatusLineRunResult => ({
  stdout,
  exitCode: 0,
  timedOut: false,
  spawnFailed: false,
});
const runnerReturning =
  (r: StatusLineRunResult): StatusLineRunner =>
  async () =>
    r;

describe("sanitizeStatusLineOutput", () => {
  it("returns null for empty / whitespace-only", () => {
    expect(sanitizeStatusLineOutput("")).toBeNull();
    expect(sanitizeStatusLineOutput("   \n  ")).toBeNull();
  });

  it("takes the first line only and collapses whitespace", () => {
    expect(sanitizeStatusLineOutput("PnL +2.3%\nsecond line")).toBe("PnL +2.3%");
    expect(sanitizeStatusLineOutput("a    b\t c")).toBe("a b c");
  });

  it("strips ANSI escapes and control chars (cannot corrupt the frame)", () => {
    expect(sanitizeStatusLineOutput(`${ESC}[31mRED${ESC}[0m`)).toBe("RED");
    expect(sanitizeStatusLineOutput(`x${BEL}y`)).toBe("x y"); // BEL → space
  });

  it("clamps to the render cap with an ellipsis", () => {
    const long = "x".repeat(STATUS_LINE_RENDER_CAP + 50);
    const out = sanitizeStatusLineOutput(long)!;
    expect(out.length).toBe(STATUS_LINE_RENDER_CAP);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("runStatusLineHook — fail-closed safety", () => {
  it("returns null when no command is set", async () => {
    expect(await runStatusLineHook(undefined)).toBeNull();
    expect(await runStatusLineHook("   ")).toBeNull();
  });

  it("returns the sanitized segment on a clean run", async () => {
    const out = await runStatusLineHook("whatever", {
      runner: runnerReturning(ok(`margin 41% ${ESC}[2mfree${ESC}[0m`)),
    });
    expect(out).toBe("margin 41% free");
  });

  it("returns null on timeout", async () => {
    const out = await runStatusLineHook("slow", {
      runner: runnerReturning({
        stdout: "partial",
        exitCode: null,
        timedOut: true,
        spawnFailed: false,
      }),
    });
    expect(out).toBeNull();
  });

  it("returns null on spawn failure", async () => {
    const out = await runStatusLineHook("missing-bin", {
      runner: runnerReturning({ stdout: "", exitCode: null, timedOut: false, spawnFailed: true }),
    });
    expect(out).toBeNull();
  });

  it("returns null on non-zero exit", async () => {
    const out = await runStatusLineHook("fails", {
      runner: runnerReturning({
        stdout: "noise",
        exitCode: 1,
        timedOut: false,
        spawnFailed: false,
      }),
    });
    expect(out).toBeNull();
  });

  it("never throws even if the runner rejects", async () => {
    const throwingRunner: StatusLineRunner = async () => {
      throw new Error("runner blew up");
    };
    expect(await runStatusLineHook("x", { runner: throwingRunner })).toBeNull();
  });
});
