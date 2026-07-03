// stdin-tokenizer.test — streaming tokenizer + input pipeline.
//
// Covers the four regressions this front-end exists to fix: split escape
// across reads, embedded control mid-text, partial mouse at a chunk boundary,
// and multi-line paste firing Enter. Plus ESC-vs-alt disambiguation and a
// byte-exact parity pass so ordinary keys route identically to the old path.

import { describe, expect, test } from "bun:test";
import parseKeypress from "./parse-keypress.ts";
import type { MouseEvent } from "./parse-mouse.ts";
import {
  createTokenizer,
  createInputPipeline,
  type Token,
} from "./stdin-tokenizer.ts";

// A deterministic, hand-fired timer scheduler for the pipeline's ESC / paste
// timers. `fireAll` drains the currently-scheduled callbacks (re-arms land in a
// fresh generation, so a callback that re-arms shows up in `pending`).
function fakeClock() {
  let seq = 0;
  const timers = new Map<number, () => void>();
  return {
    setTimeoutFn: (fn: () => void): number => {
      const id = ++seq;
      timers.set(id, fn);
      return id;
    },
    clearTimeoutFn: (h: unknown): void => {
      timers.delete(h as number);
    },
    fireAll: (): void => {
      const fns = [...timers.values()];
      timers.clear();
      for (const fn of fns) fn();
    },
    pending: (): number => timers.size,
  };
}

type Collected = {
  keys: string[];
  mice: MouseEvent[];
  pastes: string[];
};

function makePipeline(
  clock: ReturnType<typeof fakeClock>,
  opts: {
    mouseEnabled?: () => boolean;
    getReadableLength?: () => number;
  } = {},
): { pipeline: ReturnType<typeof createInputPipeline>; out: Collected } {
  const out: Collected = { keys: [], mice: [], pastes: [] };
  const pipeline = createInputPipeline(
    {
      onKey: (s) => out.keys.push(s),
      onMouse: (e) => out.mice.push(e),
      onPaste: (t) => out.pastes.push(t),
    },
    {
      mouseEnabled: opts.mouseEnabled,
      getReadableLength: opts.getReadableLength,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    },
  );
  return { pipeline, out };
}

describe("createTokenizer — cross-read buffering", () => {
  test("split escape across two feeds emits one arrow sequence", () => {
    const t = createTokenizer();
    expect(t.feed("\x1b[")).toEqual([]);
    expect(t.buffer()).toBe("\x1b[");
    const tokens = t.feed("A");
    expect(tokens).toEqual([{ type: "sequence", value: "\x1b[A" }]);
    expect(t.buffer()).toBe("");
    expect(parseKeypress("\x1b[A").name).toBe("up");
  });

  test("embedded control mid-text splits into text + sequence", () => {
    const t = createTokenizer();
    const tokens = t.feed("ab\x1b[A");
    expect(tokens).toEqual([
      { type: "text", value: "ab" },
      { type: "sequence", value: "\x1b[A" },
    ]);
  });

  test("partial mouse at a chunk boundary completes on the next feed", () => {
    const t = createTokenizer();
    expect(t.feed("\x1b[<64;5")).toEqual([]);
    expect(t.buffer()).toBe("\x1b[<64;5");
    expect(t.feed(";5M")).toEqual([{ type: "sequence", value: "\x1b[<64;5;5M" }]);
  });

  test("lone ESC buffers until flush", () => {
    const t = createTokenizer();
    expect(t.feed("\x1b")).toEqual([]);
    expect(t.buffer()).toBe("\x1b");
    expect(t.flush()).toEqual([{ type: "sequence", value: "\x1b" }]);
  });

  test("plain multi-char text stays a single token (no per-char split)", () => {
    const t = createTokenizer();
    expect(t.feed("hello")).toEqual([{ type: "text", value: "hello" }]);
  });

  test("alt+letter in one chunk emits immediately as a 2-char sequence", () => {
    const t = createTokenizer();
    expect(t.feed("\x1bb")).toEqual([{ type: "sequence", value: "\x1bb" }]);
    expect(t.buffer()).toBe("");
  });

  test("SS3 function key (ESC O P) is one sequence", () => {
    const t = createTokenizer();
    expect(t.feed("\x1bOP")).toEqual([{ type: "sequence", value: "\x1bOP" }]);
  });
});

describe("createInputPipeline — ESC vs alt timer", () => {
  test("split escape across feeds -> arrow key, no premature Escape", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b[");
    expect(out.keys).toEqual([]);
    expect(clock.pending()).toBe(1); // esc timer armed on the incomplete buffer
    pipeline.feed("A");
    expect(out.keys).toEqual(["\x1b[A"]);
    expect(clock.pending()).toBe(0); // buffer drained -> timer cleared
  });

  test("lone ESC -> Escape only after the timeout fires", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b");
    expect(out.keys).toEqual([]);
    clock.fireAll();
    expect(out.keys).toEqual(["\x1b"]);
    expect(parseKeypress("\x1b").name).toBe("escape");
  });

  test("ESC then [A within the timeout -> arrow, never Escape", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b");
    pipeline.feed("[A");
    expect(out.keys).toEqual(["\x1b[A"]);
    expect(clock.pending()).toBe(0);
    clock.fireAll(); // nothing pending; must not synthesize a stray Escape
    expect(out.keys).toEqual(["\x1b[A"]);
  });

  test("timer re-arms while bytes are still pending on the stream", () => {
    const clock = fakeClock();
    let readable = 4;
    const { pipeline, out } = makePipeline(clock, { getReadableLength: () => readable });
    pipeline.feed("\x1b");
    clock.fireAll(); // readable > 0 -> defer, re-arm
    expect(out.keys).toEqual([]);
    expect(clock.pending()).toBe(1);
    readable = 0;
    clock.fireAll(); // now flush
    expect(out.keys).toEqual(["\x1b"]);
  });
});

describe("createInputPipeline — mouse routing", () => {
  test("partial mouse at boundary completes and emits one event", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock, { mouseEnabled: () => true });
    pipeline.feed("\x1b[<64;5");
    expect(out.mice).toEqual([]);
    expect(out.keys).toEqual([]);
    pipeline.feed(";5M");
    expect(out.mice.length).toBe(1);
    expect(out.mice[0]!.button).toBe("wheel-up");
    expect(out.keys).toEqual([]);
  });

  test("mouse disabled -> ESC[< sequence falls through to keypress", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock, { mouseEnabled: () => false });
    pipeline.feed("\x1b[<64;5;5M");
    expect(out.mice).toEqual([]);
    expect(out.keys).toEqual(["\x1b[<64;5;5M"]);
  });

  test("mouse event followed by text -> both delivered", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock, { mouseEnabled: () => true });
    pipeline.feed("\x1b[<0;1;1Mhello");
    expect(out.mice.length).toBe(1);
    expect(out.keys).toEqual(["hello"]);
  });
});

describe("createInputPipeline — bracketed paste", () => {
  test("multi-line paste in one chunk -> one paste event, no keys", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b[200~line1\nline2\nline3\x1b[201~");
    expect(out.pastes).toEqual(["line1\nline2\nline3"]);
    expect(out.keys).toEqual([]); // no per-line keys, no Enter
  });

  test("paste split across chunks coalesces to one event", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b[200~line1\n");
    pipeline.feed("line2");
    pipeline.feed("\x1b[201~");
    expect(out.pastes).toEqual(["line1\nline2"]);
    expect(out.keys).toEqual([]);
  });

  test("paste containing a bare newline never fires Enter", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b[200~\n\x1b[201~");
    expect(out.pastes).toEqual(["\n"]);
    expect(out.keys).toEqual([]);
    expect(parseKeypress("\n").name).toBe("enter"); // proof the bypass matters
  });

  test("unterminated paste flushes on the completion timeout", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b[200~hello");
    expect(out.pastes).toEqual([]);
    clock.fireAll();
    expect(out.pastes).toEqual(["hello"]);
    expect(out.keys).toEqual([]);
  });

  test("keys before and after a paste route normally", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("a");
    pipeline.feed("\x1b[200~pasted\x1b[201~");
    pipeline.feed("b");
    expect(out.keys).toEqual(["a", "b"]);
    expect(out.pastes).toEqual(["pasted"]);
  });
});

describe("createInputPipeline — regression: ordinary keys route identically", () => {
  const singles: Array<[string, string]> = [
    ["a", "a"],
    ["Z", "z"],
    ["\r", "return"],
    ["\n", "enter"],
    ["\t", "tab"],
    ["\x7f", "delete"],
    ["\b", "backspace"],
    ["\x03", "c"], // ctrl+c
    ["\x1b[A", "up"],
    ["\x1b[B", "down"],
    ["\x1b[C", "right"],
    ["\x1b[D", "left"],
    ["\x1b[Z", "tab"], // shift-tab
  ];

  for (const [chunk, expectedName] of singles) {
    test(`single chunk ${JSON.stringify(chunk)} -> one token, parses to ${expectedName}`, () => {
      const clock = fakeClock();
      const { pipeline, out } = makePipeline(clock);
      pipeline.feed(chunk);
      // A complete key never buffers, so no timer should linger.
      expect(clock.pending()).toBe(0);
      expect(out.keys).toEqual([chunk]);
      expect(parseKeypress(chunk).name).toBe(expectedName);
    });
  }

  test("batched multi-char text stays one input token", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("hello");
    expect(out.keys).toEqual(["hello"]);
  });

  test("alt+letter in one chunk -> one token, parses to meta", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1bb");
    expect(clock.pending()).toBe(0);
    expect(out.keys).toEqual(["\x1bb"]);
    expect(parseKeypress("\x1bb").meta).toBe(true);
  });

  test("flush drains a buffered incomplete sequence (teardown)", () => {
    const clock = fakeClock();
    const { pipeline, out } = makePipeline(clock);
    pipeline.feed("\x1b[");
    pipeline.flush();
    expect(out.keys).toEqual(["\x1b["]);
  });
});

describe("token shape sanity", () => {
  test("tokenizer never emits an empty token", () => {
    const t = createTokenizer();
    const all: Token[] = [
      ...t.feed("a\x1b[Ab"),
      ...t.feed("\x1b[<0;1;1M"),
      ...t.flush(),
    ];
    for (const tok of all) expect(tok.value.length).toBeGreaterThan(0);
  });
});
