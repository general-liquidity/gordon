import { describe, expect, test } from "bun:test";
import {
  parseMouseSequence,
  MOUSE_ENABLE,
  MOUSE_DISABLE,
} from "./parse-mouse.ts";

describe("parseMouseSequence — happy paths", () => {
  test("left click press, no modifiers", () => {
    const r = parseMouseSequence("\x1b[<0;10;5M");
    expect(r.event).toEqual({
      type: "press",
      button: "left",
      x: 9, // 1-indexed -> 0-indexed
      y: 4,
      shift: false,
      meta: false,
      ctrl: false,
    });
    expect(r.consumed).toBe("\x1b[<0;10;5M".length);
  });

  test("left click release uses 'm' terminator", () => {
    const r = parseMouseSequence("\x1b[<0;10;5m");
    expect(r.event?.type).toBe("release");
    expect(r.event?.button).toBe("left");
  });

  test("middle click press", () => {
    const r = parseMouseSequence("\x1b[<1;1;1M");
    expect(r.event?.button).toBe("middle");
    expect(r.event?.x).toBe(0);
    expect(r.event?.y).toBe(0);
  });

  test("right click press", () => {
    const r = parseMouseSequence("\x1b[<2;3;4M");
    expect(r.event?.button).toBe("right");
  });

  test("wheel up", () => {
    const r = parseMouseSequence("\x1b[<64;20;15M");
    expect(r.event?.button).toBe("wheel-up");
    expect(r.event?.type).toBe("press");
  });

  test("wheel down", () => {
    const r = parseMouseSequence("\x1b[<65;20;15M");
    expect(r.event?.button).toBe("wheel-down");
  });

  test("drag = left + motion bit (32)", () => {
    // 0 (left) + 32 (motion) = 32
    const r = parseMouseSequence("\x1b[<32;10;5M");
    expect(r.event?.type).toBe("drag");
    expect(r.event?.button).toBe("left");
  });

  test("modifiers — shift only (+4)", () => {
    const r = parseMouseSequence("\x1b[<4;1;1M");
    expect(r.event?.shift).toBe(true);
    expect(r.event?.meta).toBe(false);
    expect(r.event?.ctrl).toBe(false);
    expect(r.event?.button).toBe("left");
  });

  test("modifiers — meta only (+8)", () => {
    const r = parseMouseSequence("\x1b[<8;1;1M");
    expect(r.event?.meta).toBe(true);
    expect(r.event?.button).toBe("left");
  });

  test("modifiers — ctrl only (+16)", () => {
    const r = parseMouseSequence("\x1b[<16;1;1M");
    expect(r.event?.ctrl).toBe(true);
    expect(r.event?.button).toBe("left");
  });

  test("modifiers — combined shift+ctrl wheel-up (4+16+64=84)", () => {
    const r = parseMouseSequence("\x1b[<84;1;1M");
    expect(r.event?.button).toBe("wheel-up");
    expect(r.event?.shift).toBe(true);
    expect(r.event?.ctrl).toBe(true);
    expect(r.event?.meta).toBe(false);
  });

  test("returns consumed length so caller can advance buffer", () => {
    const seq = "\x1b[<0;10;5M";
    const trailing = "abc";
    const r = parseMouseSequence(seq + trailing);
    expect(r.consumed).toBe(seq.length);
    expect(seq.slice(r.consumed)).toBe("");
  });

  test("multi-digit coordinates", () => {
    const r = parseMouseSequence("\x1b[<0;123;456M");
    expect(r.event?.x).toBe(122);
    expect(r.event?.y).toBe(455);
  });
});

describe("parseMouseSequence — invalid / incomplete", () => {
  test("empty string -> no match", () => {
    expect(parseMouseSequence("")).toEqual({ event: null, consumed: 0 });
  });

  test("non-mouse keypress -> no match", () => {
    expect(parseMouseSequence("\x1b[A")).toEqual({ event: null, consumed: 0 });
  });

  test("incomplete sequence (no terminator) -> no match", () => {
    expect(parseMouseSequence("\x1b[<0;10;5")).toEqual({ event: null, consumed: 0 });
  });

  test("malformed parameters (letters) -> no match", () => {
    expect(parseMouseSequence("\x1b[<0;ab;5M")).toEqual({ event: null, consumed: 0 });
  });

  test("missing parameter -> no match", () => {
    expect(parseMouseSequence("\x1b[<0;5M")).toEqual({ event: null, consumed: 0 });
  });

  test("unknown button code -> no match", () => {
    // Button 3 (after stripping mods) is not one we surface.
    expect(parseMouseSequence("\x1b[<3;1;1M")).toEqual({ event: null, consumed: 0 });
  });

  test("plain text -> no match", () => {
    expect(parseMouseSequence("hello")).toEqual({ event: null, consumed: 0 });
  });
});

describe("MOUSE_ENABLE / MOUSE_DISABLE constants", () => {
  test("enable enables both 1003 and 1006", () => {
    expect(MOUSE_ENABLE).toBe("\x1b[?1003h\x1b[?1006h");
  });
  test("disable disables both 1003 and 1006", () => {
    expect(MOUSE_DISABLE).toBe("\x1b[?1003l\x1b[?1006l");
  });
});
