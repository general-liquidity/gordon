// stdin-tokenizer — streaming, cross-read escape-sequence boundary detection.
//
// Ported from Claude Code's `src/ink/termio/tokenize.ts`. Terminal input
// arrives in arbitrary chunks: a single arrow key (`\x1b[A`) can split across
// two reads (`\x1b[` then `A`), an escape sequence can be embedded mid-text
// (`ab\x1b[A`), and a mouse report can straddle a chunk boundary. Feeding each
// raw chunk straight into `parseKeypress` loses the split/embedded/partial
// sequences.
//
// This tokenizer keeps a state machine (ground/escape/csi/ss3/osc/dcs/apc)
// across `feed()` calls, buffering an incomplete sequence until the next chunk
// completes it, then emits COMPLETE tokens (text runs + whole sequences). The
// higher-level `createInputPipeline` layers ESC-vs-alt disambiguation and
// bracketed-paste coalescing on top and routes finished tokens to keypress /
// mouse / paste consumers.

import parseMouseSequence, { type MouseEvent } from "./parse-mouse.ts";

// --- Minimal ANSI/CSI byte helpers (inlined; ink-custom has no ansi/csi module) ---

const ESC_BYTE = 0x1b;
const BEL_BYTE = 0x07;

// Byte after ESC that opens a longer sequence.
const ESC_CSI = 0x5b; // [
const ESC_OSC = 0x5d; // ]
const ESC_DCS = 0x50; // P
const ESC_APC = 0x5f; // _
const ESC_SS3 = 0x4f; // O
const ESC_ST = 0x5c; // \  (string terminator, second byte of ESC \)

/** ESC-sequence final byte: 0-9 : ; < = > ? @ .. ~ (wider range than CSI final). */
function isEscFinal(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x7e;
}

/** CSI parameter byte: 0-9 : ; < = > ? */
function isCSIParam(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x3f;
}

/** CSI intermediate byte: SP ! " # $ % & ' ( ) * + , - . / */
function isCSIIntermediate(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x2f;
}

/** CSI final byte: @ A .. Z [ \ ] ^ _ ` a .. z { | } ~ */
function isCSIFinal(byte: number): boolean {
  return byte >= 0x40 && byte <= 0x7e;
}

export type Token = { type: "text"; value: string } | { type: "sequence"; value: string };

type State = "ground" | "escape" | "escapeIntermediate" | "csi" | "ss3" | "osc" | "dcs" | "apc";

export type Tokenizer = {
  /** Feed a chunk; returns complete tokens, buffering any trailing incomplete sequence. */
  feed(input: string): Token[];
  /** Force-emit any buffered incomplete sequence as a token. */
  flush(): Token[];
  /** Reset to ground state, dropping the buffer. */
  reset(): void;
  /** The currently buffered incomplete sequence (empty when in ground state). */
  buffer(): string;
};

type TokenizerOptions = {
  /**
   * Treat `CSI M` as an X10 mouse prefix and consume 3 payload bytes. Only
   * safe for stdin. Default false — Gordon requests SGR mouse (1006) so the
   * legacy X10 form never arrives, and leaving this off keeps `\x1b[M` parsing
   * identical to the previous dispatch path.
   */
  x10Mouse?: boolean;
};

export function createTokenizer(options?: TokenizerOptions): Tokenizer {
  let currentState: State = "ground";
  let currentBuffer = "";
  const x10Mouse = options?.x10Mouse ?? false;

  return {
    feed(input: string): Token[] {
      const result = tokenize(input, currentState, currentBuffer, false, x10Mouse);
      currentState = result.state.state;
      currentBuffer = result.state.buffer;
      return result.tokens;
    },
    flush(): Token[] {
      const result = tokenize("", currentState, currentBuffer, true, x10Mouse);
      currentState = result.state.state;
      currentBuffer = result.state.buffer;
      return result.tokens;
    },
    reset(): void {
      currentState = "ground";
      currentBuffer = "";
    },
    buffer(): string {
      return currentBuffer;
    },
  };
}

type InternalState = { state: State; buffer: string };

function tokenize(
  input: string,
  initialState: State,
  initialBuffer: string,
  flush: boolean,
  x10Mouse: boolean,
): { tokens: Token[]; state: InternalState } {
  const tokens: Token[] = [];
  const result: InternalState = { state: initialState, buffer: "" };

  const data = initialBuffer + input;
  let i = 0;
  let textStart = 0;
  let seqStart = 0;

  const flushText = (): void => {
    if (i > textStart) {
      const text = data.slice(textStart, i);
      if (text) tokens.push({ type: "text", value: text });
    }
    textStart = i;
  };

  const emitSequence = (seq: string): void => {
    if (seq) tokens.push({ type: "sequence", value: seq });
    result.state = "ground";
    textStart = i;
  };

  while (i < data.length) {
    const code = data.charCodeAt(i);

    switch (result.state) {
      case "ground":
        if (code === ESC_BYTE) {
          flushText();
          seqStart = i;
          result.state = "escape";
          i++;
        } else {
          i++;
        }
        break;

      case "escape":
        if (code === ESC_CSI) {
          result.state = "csi";
          i++;
        } else if (code === ESC_OSC) {
          result.state = "osc";
          i++;
        } else if (code === ESC_DCS) {
          result.state = "dcs";
          i++;
        } else if (code === ESC_APC) {
          result.state = "apc";
          i++;
        } else if (code === ESC_SS3) {
          result.state = "ss3";
          i++;
        } else if (isCSIIntermediate(code)) {
          result.state = "escapeIntermediate";
          i++;
        } else if (isEscFinal(code)) {
          i++;
          emitSequence(data.slice(seqStart, i));
        } else if (code === ESC_BYTE) {
          // Double escape — emit the first, start a new one.
          emitSequence(data.slice(seqStart, i));
          seqStart = i;
          result.state = "escape";
          i++;
        } else {
          // Invalid after ESC — fall back to treating ESC as text.
          result.state = "ground";
          textStart = seqStart;
        }
        break;

      case "escapeIntermediate":
        if (isCSIIntermediate(code)) {
          i++;
        } else if (isEscFinal(code)) {
          i++;
          emitSequence(data.slice(seqStart, i));
        } else {
          result.state = "ground";
          textStart = seqStart;
        }
        break;

      case "csi":
        // Legacy X10 mouse: CSI M + 3 raw payload bytes. Gated on x10Mouse so
        // `\x1b[M` otherwise parses as an ordinary CSI final (matches the prior
        // dispatch path). `M` must sit immediately after `[` (offset 2) — SGR
        // mouse (`CSI < … M`) reaches M later and stays a normal CSI.
        if (
          x10Mouse &&
          code === 0x4d /* M */ &&
          i - seqStart === 2 &&
          (i + 1 >= data.length || data.charCodeAt(i + 1) >= 0x20) &&
          (i + 2 >= data.length || data.charCodeAt(i + 2) >= 0x20) &&
          (i + 3 >= data.length || data.charCodeAt(i + 3) >= 0x20)
        ) {
          if (i + 4 <= data.length) {
            i += 4;
            emitSequence(data.slice(seqStart, i));
          } else {
            // Incomplete — leave for the next feed to complete.
            i = data.length;
          }
          break;
        }
        if (isCSIFinal(code)) {
          i++;
          emitSequence(data.slice(seqStart, i));
        } else if (isCSIParam(code) || isCSIIntermediate(code)) {
          i++;
        } else {
          result.state = "ground";
          textStart = seqStart;
        }
        break;

      case "ss3":
        if (code >= 0x40 && code <= 0x7e) {
          i++;
          emitSequence(data.slice(seqStart, i));
        } else {
          result.state = "ground";
          textStart = seqStart;
        }
        break;

      case "osc":
        if (code === BEL_BYTE) {
          i++;
          emitSequence(data.slice(seqStart, i));
        } else if (code === ESC_BYTE && i + 1 < data.length && data.charCodeAt(i + 1) === ESC_ST) {
          i += 2;
          emitSequence(data.slice(seqStart, i));
        } else {
          i++;
        }
        break;

      case "dcs":
      case "apc":
        if (code === BEL_BYTE) {
          i++;
          emitSequence(data.slice(seqStart, i));
        } else if (code === ESC_BYTE && i + 1 < data.length && data.charCodeAt(i + 1) === ESC_ST) {
          i += 2;
          emitSequence(data.slice(seqStart, i));
        } else {
          i++;
        }
        break;
    }
  }

  if (result.state === "ground") {
    flushText();
  } else if (flush) {
    const remaining = data.slice(seqStart);
    if (remaining) tokens.push({ type: "sequence", value: remaining });
    result.state = "ground";
  } else {
    result.buffer = data.slice(seqStart);
  }

  return { tokens, state: result };
}

// --- Input pipeline: tokenizer + ESC timer + bracketed-paste coalescing ---

/** Sent by the terminal before/after pasted content (DEC mode 2004). */
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

/** Enable/disable bracketed paste (write to stdout on setup/teardown). */
export const ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
export const DISABLE_BRACKETED_PASTE = "\x1b[?2004l";

/** SGR mouse prefix (`ESC [ <`). */
const MOUSE_PREFIX = "\x1b[<";

/** Short wait before a lone ESC / incomplete sequence is emitted. */
export const NORMAL_TIMEOUT_MS = 50;
/** Longer wait while coalescing a bracketed paste. */
export const PASTE_TIMEOUT_MS = 500;

export type InputPipelineCallbacks = {
  /** A complete key token (text run or whole escape sequence) — feed to parseKeypress. */
  onKey: (seq: string) => void;
  /** A parsed mouse event. */
  onMouse: (event: MouseEvent) => void;
  /** A coalesced bracketed paste — insert as literal text, do NOT parse as keys. */
  onPaste: (text: string) => void;
};

type TimerHandle = unknown;

export type InputPipelineOptions = {
  /** Route `ESC [ <` tokens to onMouse only when this returns true. Default: always. */
  mouseEnabled?: () => boolean;
  /** Bytes still buffered on the stream; when > 0 an ESC-flush is deferred. */
  getReadableLength?: () => number;
  x10Mouse?: boolean;
  normalTimeoutMs?: number;
  pasteTimeoutMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
};

export type InputPipeline = {
  /** Feed a raw stdin chunk. */
  feed(chunk: string): void;
  /** Force-emit buffered incomplete sequence + any in-flight paste (teardown). */
  flush(): void;
  /** Clear pending timers. */
  dispose(): void;
};

export function createInputPipeline(
  callbacks: InputPipelineCallbacks,
  options: InputPipelineOptions = {},
): InputPipeline {
  const tokenizer = createTokenizer({ x10Mouse: options.x10Mouse ?? false });
  const mouseEnabled = options.mouseEnabled ?? (() => true);
  const getReadableLength = options.getReadableLength;
  const normalTimeout = options.normalTimeoutMs ?? NORMAL_TIMEOUT_MS;
  const pasteTimeout = options.pasteTimeoutMs ?? PASTE_TIMEOUT_MS;
  const setT = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms) as unknown as TimerHandle);
  const clearT =
    options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let pasteActive = false;
  let pasteChunks: string[] = [];
  let escTimer: TimerHandle | null = null;
  let pasteTimer: TimerHandle | null = null;

  const clearEscTimer = (): void => {
    if (escTimer !== null) {
      clearT(escTimer);
      escTimer = null;
    }
  };

  const clearPasteTimer = (): void => {
    if (pasteTimer !== null) {
      clearT(pasteTimer);
      pasteTimer = null;
    }
  };

  const flushPaste = (): void => {
    clearPasteTimer();
    if (!pasteActive) return;
    pasteActive = false;
    const text = pasteChunks.join("");
    pasteChunks = [];
    callbacks.onPaste(text);
  };

  const armPasteTimer = (): void => {
    clearPasteTimer();
    pasteTimer = setT(() => {
      pasteTimer = null;
      flushPaste();
    }, pasteTimeout);
  };

  const processToken = (token: Token): void => {
    if (pasteActive) {
      if (token.type === "sequence" && token.value === PASTE_END) {
        flushPaste();
      } else {
        pasteChunks.push(token.value);
        armPasteTimer();
      }
      return;
    }

    if (token.type === "sequence") {
      if (token.value === PASTE_START) {
        pasteActive = true;
        pasteChunks = [];
        armPasteTimer();
        return;
      }
      if (mouseEnabled() && token.value.startsWith(MOUSE_PREFIX)) {
        const { event } = parseMouseSequence(token.value);
        if (event) callbacks.onMouse(event);
        return;
      }
      callbacks.onKey(token.value);
      return;
    }

    callbacks.onKey(token.value);
  };

  const manageEscTimer = (): void => {
    if (tokenizer.buffer().length > 0) {
      clearEscTimer();
      const ms = pasteActive ? pasteTimeout : normalTimeout;
      escTimer = setT(onEscTimeout, ms);
    } else {
      clearEscTimer();
    }
  };

  function onEscTimeout(): void {
    escTimer = null;
    // More bytes are pending on the stream — they will complete the sequence,
    // so defer the flush and re-arm rather than emitting a partial token.
    if (getReadableLength && getReadableLength() > 0) {
      manageEscTimer();
      return;
    }
    const tokens = tokenizer.flush();
    for (const token of tokens) processToken(token);
    clearEscTimer();
  }

  return {
    feed(chunk: string): void {
      const tokens = tokenizer.feed(chunk);
      for (const token of tokens) processToken(token);
      manageEscTimer();
    },
    flush(): void {
      clearEscTimer();
      const tokens = tokenizer.flush();
      for (const token of tokens) processToken(token);
      flushPaste();
    },
    dispose(): void {
      clearEscTimer();
      clearPasteTimer();
    },
  };
}
