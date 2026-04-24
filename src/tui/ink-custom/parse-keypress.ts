// parse-keypress — owned port of ink/build/parse-keypress.js.
//
// Originally copied (in ink) from enquirer
// (https://github.com/enquirer/enquirer/blob/36785f3399a41cd61e9d28d1eb9c2fcd73d69b4c/lib/keypress.js).
//
// Parses a single chunk of stdin bytes/string and returns a `ParsedKey`
// describing modifiers, named key (if recognized), raw sequence, and the
// optional CSI/SS3 `code`. Used by useInput-style consumers driven off the
// internal_eventEmitter on StdinContext.

import { Buffer } from "node:buffer";

// eslint-disable-next-line no-control-regex
const metaKeyCodeRe = /^(?:\x1b)([a-zA-Z0-9])$/;
// eslint-disable-next-line no-control-regex
const fnKeyRe = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;

const keyName: Record<string, string> = {
  /* xterm/gnome ESC O letter */
  OP: "f1",
  OQ: "f2",
  OR: "f3",
  OS: "f4",
  /* xterm/rxvt ESC [ number ~ */
  "[11~": "f1",
  "[12~": "f2",
  "[13~": "f3",
  "[14~": "f4",
  /* from Cygwin and used in libuv */
  "[[A": "f1",
  "[[B": "f2",
  "[[C": "f3",
  "[[D": "f4",
  "[[E": "f5",
  /* common */
  "[15~": "f5",
  "[17~": "f6",
  "[18~": "f7",
  "[19~": "f8",
  "[20~": "f9",
  "[21~": "f10",
  "[23~": "f11",
  "[24~": "f12",
  /* xterm ESC [ letter */
  "[A": "up",
  "[B": "down",
  "[C": "right",
  "[D": "left",
  "[E": "clear",
  "[F": "end",
  "[H": "home",
  /* xterm/gnome ESC O letter */
  OA: "up",
  OB: "down",
  OC: "right",
  OD: "left",
  OE: "clear",
  OF: "end",
  OH: "home",
  /* xterm/rxvt ESC [ number ~ */
  "[1~": "home",
  "[2~": "insert",
  "[3~": "delete",
  "[4~": "end",
  "[5~": "pageup",
  "[6~": "pagedown",
  /* putty */
  "[[5~": "pageup",
  "[[6~": "pagedown",
  /* rxvt */
  "[7~": "home",
  "[8~": "end",
  /* rxvt keys with modifiers */
  "[a": "up",
  "[b": "down",
  "[c": "right",
  "[d": "left",
  "[e": "clear",
  "[2$": "insert",
  "[3$": "delete",
  "[5$": "pageup",
  "[6$": "pagedown",
  "[7$": "home",
  "[8$": "end",
  Oa: "up",
  Ob: "down",
  Oc: "right",
  Od: "left",
  Oe: "clear",
  "[2^": "insert",
  "[3^": "delete",
  "[5^": "pageup",
  "[6^": "pagedown",
  "[7^": "home",
  "[8^": "end",
  /* misc. */
  "[Z": "tab",
};

export const nonAlphanumericKeys: string[] = [
  ...Object.values(keyName),
  "backspace",
];

const isShiftKey = (code: string): boolean => {
  return [
    "[a",
    "[b",
    "[c",
    "[d",
    "[e",
    "[2$",
    "[3$",
    "[5$",
    "[6$",
    "[7$",
    "[8$",
    "[Z",
  ].includes(code);
};

const isCtrlKey = (code: string): boolean => {
  return [
    "Oa",
    "Ob",
    "Oc",
    "Od",
    "Oe",
    "[2^",
    "[3^",
    "[5^",
    "[6^",
    "[7^",
    "[8^",
  ].includes(code);
};

export type ParsedKey = {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  sequence: string;
  raw: string | undefined;
  code?: string;
};

const parseKeypress = (input: Buffer | string = ""): ParsedKey => {
  let s: string;
  if (Buffer.isBuffer(input)) {
    // High-bit single byte → ESC + ascii. Same trick enquirer/Node readline use
    // to surface meta-prefixed sequences from a single byte read.
    if (input[0]! > 127 && input[1] === undefined) {
      input[0] = input[0]! - 128;
      s = "\x1b" + String(input);
    } else {
      s = String(input);
    }
  } else if (input !== undefined && typeof input !== "string") {
    s = String(input);
  } else if (!input) {
    s = "";
  } else {
    s = input;
  }

  const key: ParsedKey = {
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: s,
    raw: s,
  };

  key.sequence = key.sequence || s || key.name;

  let parts: RegExpExecArray | null;
  if (s === "\r") {
    // carriage return
    key.raw = undefined;
    key.name = "return";
  } else if (s === "\n") {
    // enter, should have been called linefeed
    key.name = "enter";
  } else if (s === "\t") {
    // tab
    key.name = "tab";
  } else if (s === "\b" || s === "\x1b\b") {
    // backspace or ctrl+h
    key.name = "backspace";
    key.meta = s.charAt(0) === "\x1b";
  } else if (s === "\x7f" || s === "\x1b\x7f") {
    // delete (split from backspace for ink parity)
    key.name = "delete";
    key.meta = s.charAt(0) === "\x1b";
  } else if (s === "\x1b" || s === "\x1b\x1b") {
    // escape key
    key.name = "escape";
    key.meta = s.length === 2;
  } else if (s === " " || s === "\x1b ") {
    key.name = "space";
    key.meta = s.length === 2;
  } else if (s.length === 1 && s <= "\x1a") {
    // ctrl+letter
    key.name = String.fromCharCode(
      s.charCodeAt(0) + "a".charCodeAt(0) - 1,
    );
    key.ctrl = true;
  } else if (s.length === 1 && s >= "0" && s <= "9") {
    // number
    key.name = "number";
  } else if (s.length === 1 && s >= "a" && s <= "z") {
    // lowercase letter
    key.name = s;
  } else if (s.length === 1 && s >= "A" && s <= "Z") {
    // shift+letter
    key.name = s.toLowerCase();
    key.shift = true;
  } else if ((parts = metaKeyCodeRe.exec(s))) {
    // meta+character key
    key.meta = true;
    key.shift = /^[A-Z]$/.test(parts[1]!);
  } else if ((parts = fnKeyRe.exec(s))) {
    const segs = [...s];
    if (segs[0] === "" && segs[1] === "") {
      key.option = true;
    }
    // ansi escape sequence
    // reassemble the key code leaving out leading \x1b's,
    // the modifier key bitflag and any meaningless "1;" sequence
    const code = [parts[1], parts[2], parts[4], parts[6]]
      .filter(Boolean)
      .join("");
    const modifier = (Number(parts[3] || parts[5] || 1)) - 1;
    // Parse the key modifier
    key.ctrl = !!(modifier & 4);
    key.meta = !!(modifier & 10);
    key.shift = !!(modifier & 1);
    key.code = code;
    key.name = keyName[code] ?? "";
    key.shift = isShiftKey(code) || key.shift;
    key.ctrl = isCtrlKey(code) || key.ctrl;
  }

  return key;
};

export default parseKeypress;
