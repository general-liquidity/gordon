import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { enterAltScreen, forceLeaveAltScreen, isAltScreenActive, leaveAltScreen } from "./altScreen.ts";

class FakeTty {
  isTTY = true;
  chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
}

let previousTerm: string | undefined;

beforeEach(() => {
  previousTerm = process.env.TERM;
  process.env.TERM = "xterm-256color";
});

afterEach(() => {
  forceLeaveAltScreen();
  if (previousTerm === undefined) delete process.env.TERM;
  else process.env.TERM = previousTerm;
});

describe("altScreen", () => {
  test("writes enter once and leave once for a TTY with alternate-screen support", () => {
    const out = new FakeTty();

    expect(enterAltScreen(out as unknown as NodeJS.WriteStream)).toBe(true);
    expect(enterAltScreen(out as unknown as NodeJS.WriteStream)).toBe(true);
    leaveAltScreen(out as unknown as NodeJS.WriteStream);
    leaveAltScreen(out as unknown as NodeJS.WriteStream);

    expect(out.chunks).toEqual(["\x1b[?1049h\x1b[H\x1b[2J", "\x1b[?1049l"]);
  });

  test("does nothing for TERM=dumb", () => {
    process.env.TERM = "dumb";
    const out = new FakeTty();

    expect(enterAltScreen(out as unknown as NodeJS.WriteStream)).toBe(false);
    leaveAltScreen(out as unknown as NodeJS.WriteStream);

    expect(out.chunks).toEqual([]);
  });

  test("does nothing for non-TTY output", () => {
    const out = new FakeTty();
    out.isTTY = false;

    expect(enterAltScreen(out as unknown as NodeJS.WriteStream)).toBe(false);
    expect(out.chunks).toEqual([]);
  });

  test("refcounts: nested overlay leave never restores the main buffer while the app owns the screen", () => {
    const out = new FakeTty();
    const tty = out as unknown as NodeJS.WriteStream;

    // App owns the screen for the session (fullscreen mode).
    expect(enterAltScreen(tty)).toBe(true);
    // Overlay (TradeQueueView / SafetyDashboard / pager) nests on top.
    expect(enterAltScreen(tty)).toBe(true);
    // Overlay closes — must NOT write ALT_LEAVE.
    leaveAltScreen(tty);
    expect(out.chunks).toEqual(["\x1b[?1049h\x1b[H\x1b[2J"]);
    expect(isAltScreenActive()).toBe(true);

    // Re-open and close another overlay — still no restore.
    expect(enterAltScreen(tty)).toBe(true);
    leaveAltScreen(tty);
    expect(out.chunks).toEqual(["\x1b[?1049h\x1b[H\x1b[2J"]);

    // Final (app) leave restores exactly once.
    leaveAltScreen(tty);
    expect(out.chunks).toEqual(["\x1b[?1049h\x1b[H\x1b[2J", "\x1b[?1049l"]);
    expect(isAltScreenActive()).toBe(false);
  });

  test("forceLeaveAltScreen restores regardless of depth, exactly once", () => {
    const out = new FakeTty();
    const tty = out as unknown as NodeJS.WriteStream;

    enterAltScreen(tty);
    enterAltScreen(tty);
    enterAltScreen(tty);
    forceLeaveAltScreen();
    expect(out.chunks).toEqual(["\x1b[?1049h\x1b[H\x1b[2J", "\x1b[?1049l"]);
    expect(isAltScreenActive()).toBe(false);

    // Idempotent — no second restore write.
    forceLeaveAltScreen();
    leaveAltScreen(tty);
    expect(out.chunks).toEqual(["\x1b[?1049h\x1b[H\x1b[2J", "\x1b[?1049l"]);
  });

  test("leave without enter is a no-op", () => {
    const out = new FakeTty();
    leaveAltScreen(out as unknown as NodeJS.WriteStream);
    expect(out.chunks).toEqual([]);
    expect(isAltScreenActive()).toBe(false);
  });
});
