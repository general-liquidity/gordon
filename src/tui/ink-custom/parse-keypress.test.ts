// parse-keypress.test — Lane 1 / Phase B1.
//
// Smoke coverage for the owned parse-keypress port. We don't try to be
// exhaustive — the original was forked from enquirer and is essentially
// frozen — but we exercise each parsing branch so a regression against
// the upstream behavior surfaces immediately.

import { describe, expect, test } from "bun:test";
import parseKeypress, { nonAlphanumericKeys } from "./parse-keypress.ts";

describe("parseKeypress", () => {
  test("carriage return -> name=return, raw=undefined", () => {
    const k = parseKeypress("\r");
    expect(k.name).toBe("return");
    expect(k.raw).toBeUndefined();
  });

  test("newline -> name=enter", () => {
    expect(parseKeypress("\n").name).toBe("enter");
  });

  test("tab -> name=tab", () => {
    expect(parseKeypress("\t").name).toBe("tab");
  });

  test("backspace (\\b) -> name=backspace, meta=false", () => {
    const k = parseKeypress("\b");
    expect(k.name).toBe("backspace");
    expect(k.meta).toBe(false);
  });

  test("ESC+backspace -> name=backspace, meta=true", () => {
    const k = parseKeypress("\x1b\b");
    expect(k.name).toBe("backspace");
    expect(k.meta).toBe(true);
  });

  test("delete (\\x7f) -> name=delete, meta=false", () => {
    const k = parseKeypress("\x7f");
    expect(k.name).toBe("delete");
    expect(k.meta).toBe(false);
  });

  test("escape -> name=escape, meta=false", () => {
    const k = parseKeypress("\x1b");
    expect(k.name).toBe("escape");
    expect(k.meta).toBe(false);
  });

  test("ESC ESC -> name=escape, meta=true", () => {
    const k = parseKeypress("\x1b\x1b");
    expect(k.name).toBe("escape");
    expect(k.meta).toBe(true);
  });

  test("space -> name=space, meta=false", () => {
    expect(parseKeypress(" ").name).toBe("space");
    expect(parseKeypress(" ").meta).toBe(false);
  });

  test("ctrl+letter (\\x01 -> a) -> name=a, ctrl=true", () => {
    const k = parseKeypress("\x01");
    expect(k.name).toBe("a");
    expect(k.ctrl).toBe(true);
  });

  test("digit -> name=number", () => {
    expect(parseKeypress("5").name).toBe("number");
  });

  test("lowercase letter -> name = letter", () => {
    expect(parseKeypress("k").name).toBe("k");
  });

  test("uppercase letter -> name=lower, shift=true", () => {
    const k = parseKeypress("K");
    expect(k.name).toBe("k");
    expect(k.shift).toBe(true);
  });

  test("arrow up (CSI A) -> name=up, code='[A'", () => {
    const k = parseKeypress("\x1b[A");
    expect(k.name).toBe("up");
    expect(k.code).toBe("[A");
  });

  test("arrow with shift modifier (CSI 1;2A) -> shift=true", () => {
    const k = parseKeypress("\x1b[1;2A");
    expect(k.name).toBe("up");
    expect(k.shift).toBe(true);
  });

  test("F1 (ESC O P) -> name=f1", () => {
    expect(parseKeypress("\x1bOP").name).toBe("f1");
  });

  test("rxvt shift-up (CSI a) -> name=up, shift=true via isShiftKey", () => {
    const k = parseKeypress("\x1b[a");
    expect(k.name).toBe("up");
    expect(k.shift).toBe(true);
  });

  test("rxvt ctrl-up (ESC O a) -> name=up, ctrl=true via isCtrlKey", () => {
    const k = parseKeypress("\x1bOa");
    expect(k.name).toBe("up");
    expect(k.ctrl).toBe(true);
  });

  test("Buffer with high-bit single byte gets ESC-prefixed", () => {
    // \xe1 (225) is > 127. Per the parser convention, this becomes ESC + 'a'
    // (225 - 128 = 97). The result should be a meta-prefixed letter.
    const buf = Buffer.from([0xe1]);
    const k = parseKeypress(buf);
    // Match a meta+letter sequence — exact name set depends on the regex
    // path; we only care that the meta flag flipped on.
    expect(k.meta).toBe(true);
  });

  test("nonAlphanumericKeys includes named keys + 'backspace'", () => {
    expect(nonAlphanumericKeys).toContain("up");
    expect(nonAlphanumericKeys).toContain("down");
    expect(nonAlphanumericKeys).toContain("left");
    expect(nonAlphanumericKeys).toContain("right");
    expect(nonAlphanumericKeys).toContain("backspace");
  });
});
