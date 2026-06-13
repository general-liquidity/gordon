import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { enterAltScreen, leaveAltScreen } from "./altScreen.ts";

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
  leaveAltScreen();
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
});
