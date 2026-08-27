import { describe, expect, test } from "bun:test";

import {
  transition,
  replayChange,
  createInitialPersistentState,
  VimMode,
  type VimContext,
  type CommandState,
  type PersistentState,
} from "./index.ts";
import { graphemeCount, graphemeToCodeUnit } from "../utils/graphemes.ts";

// ----------------------------------------------------------------------------
// Test harness — drives literal keystrokes through the NORMAL-mode command
// parser against a mutable in-memory buffer, mirroring how PromptInput builds a
// VimContext and flushes it. INSERT-mode typing is simulated so that change /
// open-line / dot-repeat-of-insert paths are exercisable. Use "\x1b" for Esc.
// ----------------------------------------------------------------------------
interface Vim {
  readonly text: string;
  readonly cursor: number;
  readonly mode: VimMode;
  readonly register: PersistentState["register"];
  feed(keys: string): Vim;
}

function makeVim(text: string, cursor = 0): Vim {
  const state: { text: string; cursor: number; mode: VimMode; command: CommandState } = {
    text,
    cursor,
    mode: VimMode.Normal,
    command: { type: "idle" },
  };
  const persistent = createInitialPersistentState();
  const insertBuf = { s: "" };

  const ctx: VimContext = {
    get text() {
      return state.text;
    },
    get cursor() {
      return state.cursor;
    },
    setText(t) {
      state.text = t;
    },
    setCursor(c) {
      state.cursor = c;
    },
    enterInsert(c) {
      state.cursor = c;
      state.mode = VimMode.Insert;
      insertBuf.s = "";
    },
    getRegister() {
      return persistent.register;
    },
    setRegister(content, linewise) {
      persistent.register = { content, linewise };
    },
    getLastFind() {
      return persistent.lastFind;
    },
    setLastFind(type, char) {
      persistent.lastFind = { type, char };
    },
    recordChange(change) {
      persistent.lastChange = change;
    },
    onDotRepeat() {
      if (persistent.lastChange) replayChange(persistent.lastChange, ctx);
    },
  };

  function clampNormal(): void {
    if (state.mode !== VimMode.Normal) return;
    const gl = graphemeCount(state.text);
    if (state.cursor >= gl && gl > 0) state.cursor = gl - 1;
    if (state.cursor < 0) state.cursor = 0;
  }

  const vim: Vim = {
    get text() {
      return state.text;
    },
    get cursor() {
      return state.cursor;
    },
    get mode() {
      return state.mode;
    },
    get register() {
      return persistent.register;
    },
    feed(keys: string) {
      for (const key of [...keys]) {
        if (state.mode === VimMode.Insert) {
          if (key === "\x1b") {
            if (insertBuf.s) persistent.lastChange = { type: "insert", text: insertBuf.s };
            insertBuf.s = "";
            state.mode = VimMode.Normal;
            clampNormal();
            continue;
          }
          const at = graphemeToCodeUnit(state.text, state.cursor);
          state.text = state.text.slice(0, at) + key + state.text.slice(at);
          state.cursor += 1;
          insertBuf.s += key;
          continue;
        }
        if (key === "\x1b") {
          state.command = { type: "idle" };
          continue;
        }
        const res = transition(state.command, key, ctx);
        res.execute?.();
        // execute may have flipped the mode via ctx.enterInsert; the cast
        // reopens the type TS narrowed at the top-of-loop INSERT guard.
        const modeAfter = state.mode as VimMode;
        state.command =
          modeAfter === VimMode.Insert ? { type: "idle" } : (res.next ?? { type: "idle" });
        clampNormal();
      }
      return vim;
    },
  };
  return vim;
}

describe("vim text objects (operator-pending i/a routes to scope, never INSERT)", () => {
  test("diw deletes the inner word without entering insert", () => {
    const v = makeVim("foo bar", 0).feed("diw");
    expect(v.text).toBe(" bar");
    expect(v.mode).toBe(VimMode.Normal);
  });

  test('ci" changes inside quotes and enters insert', () => {
    const v = makeVim('x "hi" y', 3).feed('ci"');
    expect(v.text).toBe('x "" y');
    expect(v.mode).toBe(VimMode.Insert);
  });

  test("da( deletes around the paren pair", () => {
    const v = makeVim("f(x)", 2).feed("da(");
    expect(v.text).toBe("f");
    expect(v.mode).toBe(VimMode.Normal);
  });
});

describe("vim find motions (f/F/t/T + ; ,)", () => {
  test("f{char} lands on the character", () => {
    const v = makeVim("a.b.c.d", 0).feed("f.");
    expect(v.cursor).toBe(1);
  });

  test("; repeats the find and , reverses it", () => {
    const v = makeVim("a.b.c.d", 0).feed("f.");
    expect(v.cursor).toBe(1);
    v.feed(";");
    expect(v.cursor).toBe(3);
    v.feed(",");
    expect(v.cursor).toBe(1);
  });

  test("t{char} stops one before the character", () => {
    const v = makeVim("abc.def", 0).feed("t.");
    expect(v.cursor).toBe(2);
  });

  test("dt{char} deletes up to (not including) the character", () => {
    const v = makeVim("abc.def", 0).feed("dt.");
    expect(v.text).toBe(".def");
    expect(v.mode).toBe(VimMode.Normal);
  });
});

describe("vim single-key edits", () => {
  test("r{char} replaces the char under the cursor", () => {
    const v = makeVim("cat", 0).feed("rb");
    expect(v.text).toBe("bat");
    expect(v.cursor).toBe(0);
    expect(v.mode).toBe(VimMode.Normal);
  });

  test("x deletes the char under the cursor", () => {
    const v = makeVim("abc", 0).feed("x");
    expect(v.text).toBe("bc");
    expect(v.cursor).toBe(0);
  });

  test("~ toggles case and advances", () => {
    const v = makeVim("abc", 0).feed("~");
    expect(v.text).toBe("Abc");
    expect(v.cursor).toBe(1);
  });

  test("J joins the next line with a space", () => {
    const v = makeVim("foo\nbar", 0).feed("J");
    expect(v.text).toBe("foo bar");
  });
});

describe("vim line operators (dd / D / C / Y) and counts", () => {
  test("dd deletes the current line", () => {
    const v = makeVim("line1\nline2", 0).feed("dd");
    expect(v.text).toBe("line2");
  });

  test("3dd deletes three lines", () => {
    const v = makeVim("a\nb\nc\nd", 0).feed("3dd");
    expect(v.text).toBe("d");
  });

  test("D deletes to end of line charwise", () => {
    const v = makeVim("hello", 2).feed("D");
    expect(v.text).toBe("he");
    expect(v.mode).toBe(VimMode.Normal);
  });

  test("C changes to end of line and enters insert", () => {
    const v = makeVim("hello", 2).feed("C");
    expect(v.text).toBe("he");
    expect(v.mode).toBe(VimMode.Insert);
  });

  test("2w advances two words", () => {
    const v = makeVim("one two three", 0).feed("2w");
    expect(v.cursor).toBe(8);
  });
});

describe("vim register + paste (p / P)", () => {
  test("Y then p pastes the yanked line below", () => {
    const v = makeVim("abc", 0).feed("Y").feed("p");
    expect(v.text).toBe("abc\nabc");
  });

  test("x then p pastes the deleted char after the cursor", () => {
    const v = makeVim("abc", 0).feed("x").feed("p");
    expect(v.text).toBe("bac");
  });

  test("x then P pastes the deleted char before the cursor", () => {
    const v = makeVim("abc", 0).feed("x").feed("P");
    expect(v.text).toBe("abc");
  });
});

describe("vim indent (>> / <<)", () => {
  test(">> indents the current line by two spaces", () => {
    const v = makeVim("code", 0).feed(">>");
    expect(v.text).toBe("  code");
  });

  test("<< dedents the current line", () => {
    const v = makeVim("  code", 0).feed("<<");
    expect(v.text).toBe("code");
  });
});

describe("vim open line (o / O)", () => {
  test("o opens a line below and enters insert", () => {
    const v = makeVim("abc", 0).feed("o");
    expect(v.text).toBe("abc\n");
    expect(v.mode).toBe(VimMode.Insert);
  });

  test("O opens a line above and enters insert", () => {
    const v = makeVim("abc", 0).feed("O");
    expect(v.text).toBe("\nabc");
    expect(v.mode).toBe(VimMode.Insert);
  });
});

describe("vim goto line (gg / G)", () => {
  test("G goes to the last line, gg back to the first", () => {
    const v = makeVim("l1\nl2\nl3", 0).feed("G");
    expect(v.cursor).toBe(6);
    v.feed("gg");
    expect(v.cursor).toBe(0);
  });
});

describe("vim dot-repeat", () => {
  test(". repeats a dw change", () => {
    const v = makeVim("foo bar baz", 0).feed("dw");
    expect(v.text).toBe("bar baz");
    v.feed(".");
    expect(v.text).toBe("baz");
  });

  test(". repeats an x delete", () => {
    const v = makeVim("abcd", 0).feed("x").feed(".");
    expect(v.text).toBe("cd");
  });

  test(". repeats an inserted change (ciw + text)", () => {
    const v = makeVim("foo bar", 0).feed("ciwX\x1b");
    expect(v.text).toBe("X bar");
    expect(v.mode).toBe(VimMode.Normal);
    // Cursor sits on the inserted X; repeat the insert change on the next word.
    v.feed("w").feed(".");
    expect(v.text).toBe("X Xbar");
  });
});
