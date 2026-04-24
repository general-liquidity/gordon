// parse-mouse — SGR 1006/1003 mouse event parser.
//
// Terminal mouse modes emit events as ANSI CSI sequences. We parse the
// "extended SGR" form (DECSET 1006) which is the only mode worth
// supporting today: it has unbounded coordinate range and a clean text
// encoding. Format:
//
//   \x1b[<{button};{x};{y}M    — press / motion (1003 reports motion)
//   \x1b[<{button};{x};{y}m    — release
//
// Button byte semantics (after subtracting modifier bits):
//   0  left
//   1  middle
//   2  right
//   64 wheel-up
//   65 wheel-down
//
// Modifier bits ORed into the button byte:
//   +4   shift
//   +8   meta / alt
//   +16  ctrl
//   +32  motion (drag if a button is held, plain motion otherwise)
//
// Coordinates in the wire format are 1-indexed; we normalize to 0-indexed
// to match the rest of our DOM/cell-grid code. The parser is buffer-aware
// — it returns `{ event, consumed }` so the caller can advance the read
// buffer and handle interleaved keypress chunks.

export interface MouseEvent {
  type: "press" | "release" | "drag" | "motion";
  button: "left" | "middle" | "right" | "wheel-up" | "wheel-down";
  /** 0-indexed column. */
  x: number;
  /** 0-indexed row. */
  y: number;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

export interface ParseResult {
  event: MouseEvent | null;
  /** Number of bytes the parser consumed from the start of the buffer.
   *  0 means the buffer either does not contain a complete sequence or
   *  does not start with a mouse-event prefix at all. */
  consumed: number;
}

const NO_MATCH: ParseResult = { event: null, consumed: 0 };

/** SGR 1006 prefix: ESC [ < */
const PREFIX = "\x1b[<";

function decodeButton(rawCode: number): {
  button: MouseEvent["button"] | null;
  isDrag: boolean;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
} {
  const shift = (rawCode & 4) !== 0;
  const meta = (rawCode & 8) !== 0;
  const ctrl = (rawCode & 16) !== 0;
  const isMotion = (rawCode & 32) !== 0;
  // Strip the modifier bits to recover the raw button code.
  const base = rawCode & ~(4 | 8 | 16 | 32);
  let button: MouseEvent["button"] | null;
  switch (base) {
    case 0:
      button = "left";
      break;
    case 1:
      button = "middle";
      break;
    case 2:
      button = "right";
      break;
    case 64:
      button = "wheel-up";
      break;
    case 65:
      button = "wheel-down";
      break;
    default:
      // Unknown button code (e.g. button 3 = release-with-no-button on some
      // terminals). We surface as null and let the caller skip the event.
      button = null;
  }
  return { button, isDrag: isMotion, shift, meta, ctrl };
}

/**
 * Try to parse a single SGR-encoded mouse event from the start of `buffer`.
 *
 * On a successful parse, returns `{ event, consumed }` where `consumed`
 * is the byte length of the matched sequence. On any failure (no prefix,
 * incomplete sequence, malformed coordinates, unknown button), returns
 * `{ event: null, consumed: 0 }` — the caller is then free to fall through
 * to the keypress parser without losing bytes.
 */
export function parseMouseSequence(buffer: string): ParseResult {
  if (!buffer.startsWith(PREFIX)) return NO_MATCH;
  // Look for the terminating M / m byte.
  // Scan only up to a reasonable upper bound to avoid pathological loops on
  // garbled input — a real SGR mouse sequence is at most ~20 bytes.
  const maxScan = Math.min(buffer.length, 64);
  let endIdx = -1;
  let endChar = "";
  for (let i = PREFIX.length; i < maxScan; i++) {
    const ch = buffer[i];
    if (ch === "M" || ch === "m") {
      endIdx = i;
      endChar = ch;
      break;
    }
    // Bail early on bytes that can't appear inside the parameter list.
    // Parameters are digits + ';'.
    if (!(ch === ";" || (ch! >= "0" && ch! <= "9"))) {
      return NO_MATCH;
    }
  }
  if (endIdx === -1) return NO_MATCH;

  const params = buffer.slice(PREFIX.length, endIdx).split(";");
  if (params.length !== 3) return NO_MATCH;

  const codeNum = Number(params[0]);
  const xNum = Number(params[1]);
  const yNum = Number(params[2]);
  if (!Number.isFinite(codeNum) || !Number.isFinite(xNum) || !Number.isFinite(yNum)) {
    return NO_MATCH;
  }

  const decoded = decodeButton(codeNum);
  if (!decoded.button) return NO_MATCH;

  // Wire format is 1-indexed; clamp at 0 to be safe against a buggy emitter.
  const x = Math.max(0, xNum - 1);
  const y = Math.max(0, yNum - 1);

  let type: MouseEvent["type"];
  if (endChar === "m") {
    type = "release";
  } else if (decoded.isDrag) {
    // Motion bit is set: drag iff a real button is held; wheel events never
    // have the motion bit set in practice, but if they do we still call it
    // "motion" rather than "drag" since wheels don't drag.
    if (decoded.button === "wheel-up" || decoded.button === "wheel-down") {
      type = "motion";
    } else {
      type = "drag";
    }
  } else {
    type = "press";
  }

  const event: MouseEvent = {
    type,
    button: decoded.button,
    x,
    y,
    shift: decoded.shift,
    meta: decoded.meta,
    ctrl: decoded.ctrl,
  };
  return { event, consumed: endIdx + 1 };
}

/** ANSI sequence to enable SGR 1003 (any-event) + 1006 (extended). */
export const MOUSE_ENABLE = "\x1b[?1003h\x1b[?1006h";

/** ANSI sequence to disable both modes. Pair with MOUSE_ENABLE. */
export const MOUSE_DISABLE = "\x1b[?1003l\x1b[?1006l";

export default parseMouseSequence;
