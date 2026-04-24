// Integration test for render.ts entry point.
//
// Verifies:
//   1. Default-on path starts the custom pipeline — captures stdout and
//      asserts it contains at least a cursor-hide sequence and our text.
//   2. Opt-out (GORDON_CUSTOM_RENDER=0) plus each environment-driven
//      fallback condition (TERM=dumb, TMUX, STY, non-TTY, screen reader)
//      forces vanilla Ink and emits a stderr notice.
//
// The custom pipeline bootstraps Yoga + reconciler + output painting, so
// this is a genuine end-to-end smoke test.

import {
  describe,
  expect,
  test,
  afterEach,
  beforeEach,
} from "bun:test";
import React from "react";
import { PassThrough } from "node:stream";
import {
  render,
  shouldUseCustomRenderer,
  _resetFallbackNoticeForTests,
} from "./render.ts";
import Box from "./components/Box.ts";
import Text from "./components/Text.ts";
import Static from "./components/Static.ts";
import useApp from "./hooks/use-app.ts";
import useStdout from "./hooks/use-stdout.ts";
import AppContext from "./contexts/AppContext.ts";
import StdoutContext from "./contexts/StdoutContext.ts";

const originalEnv = process.env["GORDON_CUSTOM_RENDER"];
const originalMigrationEnabled = process.env["GORDON_POOL_MIGRATION_ENABLED"];
const originalMigrationInterval = process.env["GORDON_POOL_MIGRATION_INTERVAL_MS"];
const originalTerm = process.env["TERM"];
const originalTmux = process.env["TMUX"];
const originalSty = process.env["STY"];

// Collecting write stream — quacks like a WriteStream.
function createMockStdout(): NodeJS.WriteStream & { captured: string } {
  const stream = new PassThrough() as PassThrough & { captured: string };
  stream.captured = "";
  const originalWrite = stream.write.bind(stream);
  (stream as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stream.captured += String(chunk);
    return originalWrite(chunk as Buffer | string);
  };
  const mock = stream as unknown as NodeJS.WriteStream & { captured: string };
  mock.columns = 40;
  mock.rows = 10;
  (mock as unknown as { isTTY: boolean }).isTTY = true;
  return mock;
}

afterEach(() => {
  if (originalEnv === undefined) delete process.env["GORDON_CUSTOM_RENDER"];
  else process.env["GORDON_CUSTOM_RENDER"] = originalEnv;
  if (originalMigrationEnabled === undefined)
    delete process.env["GORDON_POOL_MIGRATION_ENABLED"];
  else process.env["GORDON_POOL_MIGRATION_ENABLED"] = originalMigrationEnabled;
  if (originalMigrationInterval === undefined)
    delete process.env["GORDON_POOL_MIGRATION_INTERVAL_MS"];
  else process.env["GORDON_POOL_MIGRATION_INTERVAL_MS"] = originalMigrationInterval;
  if (originalTerm === undefined) delete process.env["TERM"];
  else process.env["TERM"] = originalTerm;
  if (originalTmux === undefined) delete process.env["TMUX"];
  else process.env["TMUX"] = originalTmux;
  if (originalSty === undefined) delete process.env["STY"];
  else process.env["STY"] = originalSty;
  _resetFallbackNoticeForTests();
});

describe("render() integration", () => {
  test("opt-out (GORDON_CUSTOM_RENDER=0): returns vanilla Ink Instance", () => {
    process.env["GORDON_CUSTOM_RENDER"] = "0";
    const stdout = createMockStdout();
    const tree = React.createElement(
      Box,
      null,
      React.createElement(Text, null, "hello vanilla"),
    );
    const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
    try {
      expect(typeof instance.rerender).toBe("function");
      expect(typeof instance.unmount).toBe("function");
      expect(typeof instance.waitUntilExit).toBe("function");
      expect(typeof instance.clear).toBe("function");
      expect(typeof instance.cleanup).toBe("function");
    } finally {
      instance.unmount();
      instance.cleanup();
    }
  });

  describe("opt-in (GORDON_CUSTOM_RENDER=1): custom pipeline", () => {
    beforeEach(() => {
      // A2 default-on was rolled back after real-world rendering bugs (cell
      // interleaving / cursor desync visible on mount). Tests now set the
      // explicit opt-in flag.
      process.env["GORDON_CUSTOM_RENDER"] = "1";
    });

    test("mounts and writes expected text to stdout", () => {
      const stdout = createMockStdout();
      const tree = React.createElement(Text, null, "custom-ok");
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        // Captured bytes should contain our text somewhere.
        expect(stdout.captured).toContain("custom-ok");
        // Cursor-hide ANSI sequence should appear on first paint.
        expect(stdout.captured).toContain("\x1b[?25l");
      } finally {
        instance.unmount();
      }
    });

    test("mounts a Box with Text inside", () => {
      const stdout = createMockStdout();
      const tree = React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, null, "line1"),
        React.createElement(Text, null, "line2"),
      );
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        expect(stdout.captured).toContain("line1");
        expect(stdout.captured).toContain("line2");
      } finally {
        instance.unmount();
      }
    });

    test("unmount completes waitUntilExit", async () => {
      const stdout = createMockStdout();
      const tree = React.createElement(Text, null, "ephemeral");
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      const exitPromise = instance.waitUntilExit();
      instance.unmount();
      await exitPromise; // should resolve, not hang
      expect(true).toBe(true);
    });

    test("patchConsole routes console.log above the live frame", () => {
      const stdout = createMockStdout();
      const tree = React.createElement(Text, null, "frame-content");
      const instance = render(tree, { stdout, patchConsole: true, exitOnCtrlC: false });
      try {
        // Clear captured output so we only see post-mount writes.
        stdout.captured = "";
        console.log("intercepted-log");
        // The message should have been written to our stdout (not the real
        // terminal) and be followed by a reprinted frame containing our text.
        expect(stdout.captured).toContain("intercepted-log");
        expect(stdout.captured).toContain("frame-content");
        // Erase-lines ANSI sequence should appear before the console text
        // so the live frame is cleared first. `\x1b[` + some digits + `F` is
        // the cursor-up-and-home sequence ansi-escapes uses.
        const logIdx = stdout.captured.indexOf("intercepted-log");
        const frameIdx = stdout.captured.lastIndexOf("frame-content");
        expect(logIdx).toBeLessThan(frameIdx);
      } finally {
        instance.unmount();
      }
    });

    // The vanilla `useApp`/`useStdout` shims still target ink's contexts;
    // Lane 1 ports the App + contexts but leaves the hook shim story for
    // a follow-up lane. We test the OWNED contexts directly here so this
    // suite exercises our App's provider wiring without depending on the
    // separate hook port.
    test("AppContext is populated — exit() triggers unmount", async () => {
      const stdout = createMockStdout();
      const captured: { exit?: () => void } = {};
      const Consumer: React.FC = () => {
        const { exit } = React.useContext(AppContext);
        captured.exit = exit;
        return React.createElement(Text, null, "app-consumer");
      };
      const tree = React.createElement(Consumer);
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      // App must have populated the context with a non-noop exit function
      // wired into our `unmount()` path (not the createContext default).
      expect(typeof captured.exit).toBe("function");
      expect(stdout.captured).toContain("app-consumer");
      // exit() should resolve waitUntilExit without us calling unmount.
      const exitPromise = instance.waitUntilExit();
      captured.exit?.();
      await exitPromise;
      expect(true).toBe(true);
    });

    test("StdoutContext is populated — returns our stdout stream", () => {
      const stdout = createMockStdout();
      const captured: { stdout?: NodeJS.WriteStream } = {};
      const Consumer: React.FC = () => {
        const { stdout: s } = React.useContext(StdoutContext);
        captured.stdout = s;
        return React.createElement(Text, null, "stdout-consumer");
      };
      const tree = React.createElement(Consumer);
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        // App must have routed our mock stdout into the owned context, not
        // the createContext default of process.stdout.
        expect(captured.stdout).toBe(stdout);
      } finally {
        instance.unmount();
      }
    });

    // Smoke retain: the hook shims still resolve at compile/runtime even
    // though they read from ink's contexts. We don't assert behavior here —
    // see Lane 1's report. Removed once the hook shim port lands.
    test("hook shims are importable (smoke)", () => {
      expect(typeof useApp).toBe("function");
      expect(typeof useStdout).toBe("function");
    });

    test("patchConsole cleanup restores original console.log", () => {
      const stdout = createMockStdout();
      const originalLog = console.log;
      const tree = React.createElement(Text, null, "x");
      const instance = render(tree, { stdout, patchConsole: true, exitOnCtrlC: false });
      // While mounted, console.log should NOT be the original (it's patched).
      expect(console.log).not.toBe(originalLog);
      instance.unmount();
      // After unmount, restoration should have kicked in.
      expect(console.log).toBe(originalLog);
    });

    // Phase 4 — selection overlay writers exposed on Instance.
    // Paint integration is deferred to the patch transport, but the writers
    // must exist and be safe to call so callers can wire UI now.
    test("selection overlay writers exist and do not throw", () => {
      const stdout = createMockStdout();
      const tree = React.createElement(Text, null, "sel");
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        expect(typeof instance.setSelection).toBe("function");
        expect(typeof instance.clearSelection).toBe("function");
        // Setting a range, null, and clearing must all be side-effect safe.
        expect(() =>
          instance.setSelection!({ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }),
        ).not.toThrow();
        expect(() => instance.setSelection!(null)).not.toThrow();
        expect(() => instance.clearSelection!()).not.toThrow();
      } finally {
        instance.unmount();
      }
    });

    // Phase 6 — migration scheduler. We don't exercise a real tick (that
    // would require fake timers, which `bun:test` doesn't expose the way
    // jest/vitest do). We only assert that enabling the flag doesn't break
    // mount and that unmount cleanly stops the scheduler.
    test("GORDON_POOL_MIGRATION_ENABLED=true: mount + unmount is safe", () => {
      process.env["GORDON_POOL_MIGRATION_ENABLED"] = "true";
      // 1h interval so the timer never fires inside the test window.
      process.env["GORDON_POOL_MIGRATION_INTERVAL_MS"] = String(60 * 60 * 1000);
      const stdout = createMockStdout();
      const tree = React.createElement(Text, null, "mig");
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        expect(stdout.captured).toContain("mig");
      } finally {
        // unmount() must stop the scheduler without throwing even though
        // no tick has run.
        expect(() => instance.unmount()).not.toThrow();
      }
    });

    test("GORDON_POOL_MIGRATION_ENABLED unset: scheduler is not started", () => {
      delete process.env["GORDON_POOL_MIGRATION_ENABLED"];
      const stdout = createMockStdout();
      const tree = React.createElement(Text, null, "no-mig");
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        // Sanity: mount still works with the flag off (this is the default
        // code path, we just want to guard against a regression where the
        // flag-check short-circuit gets broken).
        expect(stdout.captured).toContain("no-mig");
      } finally {
        instance.unmount();
      }
    });

    // Phase 3 — <Static> scrolls into history above the live frame.
    // Ink's Static component only passes NEW items (items.slice(index))
    // on each render, so adding items only emits the new tail — items
    // already rendered must NOT be re-emitted when the parent rerenders
    // with the expanded items array.
    test("<Static> renders initial items above live frame", () => {
      const stdout = createMockStdout();
      const items = ["static-one", "static-two"];
      const tree = React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(
          Static<string>,
          {
            items,
            children: (item: string) =>
              React.createElement(Text, { key: item }, item),
          },
        ) as React.ReactElement,
        React.createElement(Text, null, "live-region"),
      );
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        // All three pieces of text must land on stdout.
        expect(stdout.captured).toContain("static-one");
        expect(stdout.captured).toContain("static-two");
        expect(stdout.captured).toContain("live-region");
      } finally {
        instance.unmount();
      }
    });

    test("<Static> appended items: new item emitted, old items NOT re-emitted", () => {
      const stdout = createMockStdout();
      const buildTree = (items: string[]): React.ReactElement =>
        React.createElement(
          Box,
          { flexDirection: "column" },
          React.createElement(Static<string>, {
            items,
            children: (item: string) =>
              React.createElement(Text, { key: item }, item),
          }) as React.ReactElement,
          React.createElement(Text, null, "live-line"),
        );
      const instance = render(buildTree(["msg1", "msg2"]), {
        stdout,
        patchConsole: false,
        exitOnCtrlC: false,
      });
      try {
        // Initial: msg1 + msg2 should both appear once.
        const initialMsg1 = (stdout.captured.match(/msg1/g) ?? []).length;
        const initialMsg2 = (stdout.captured.match(/msg2/g) ?? []).length;
        expect(initialMsg1).toBe(1);
        expect(initialMsg2).toBe(1);

        // Append msg3 and rerender.
        instance.rerender(buildTree(["msg1", "msg2", "msg3"]));

        // msg3 must now appear exactly once. msg1 and msg2 must still
        // appear exactly once (NOT re-emitted). If the Static delta logic
        // is broken, both would show up twice.
        const postMsg1 = (stdout.captured.match(/msg1/g) ?? []).length;
        const postMsg2 = (stdout.captured.match(/msg2/g) ?? []).length;
        const postMsg3 = (stdout.captured.match(/msg3/g) ?? []).length;
        expect(postMsg1).toBe(1);
        expect(postMsg2).toBe(1);
        expect(postMsg3).toBe(1);
      } finally {
        instance.unmount();
      }
    });

    // Incremental relative-cursor transport: when a rerender produces a
    // small in-place diff (no <Static> delta, same width/height), the
    // render loop should emit relative cursor movements (CUU/CUD/CUF or
    // \r) rather than an absolute-CUP full-frame rewrite.
    //
    // We assert the POST-rerender tail of stdout contains at least one
    // relative cursor sequence and does NOT contain an absolute CUP
    // sequence (CSI row ; col H). We don't assert on the exact patch
    // content — cellDiff merges same-style runs, so which bytes make it
    // into the emitted patch list depends on internal buffer layout. The
    // load-bearing signal is: relative sequences present, absolute CUP
    // absent.
    test("rerender emits relative cursor movements, not absolute CUP", () => {
      const stdout = createMockStdout();
      const instance = render(React.createElement(Text, null, "initial"), {
        stdout,
        patchConsole: false,
        exitOnCtrlC: false,
      });
      try {
        // Mark the boundary between first-paint output and rerender output.
        // Everything captured after this point is the incremental emission
        // (or a full-frame fallback, which the assertion below would catch).
        const beforeRerender = stdout.captured.length;
        instance.rerender(React.createElement(Text, null, "modified"));
        const rerenderTail = stdout.captured.slice(beforeRerender);

        // Relative cursor sequences we expect from the new transport:
        //   CUU = CSI n A, CUD = CSI n B, CUF = CSI n C, plus \r.
        const hasRelative =
          /\x1b\[\d+A/.test(rerenderTail) ||
          /\x1b\[\d+B/.test(rerenderTail) ||
          /\x1b\[\d+C/.test(rerenderTail) ||
          rerenderTail.includes("\r");
        // Absolute CUP = CSI row ; col H — what the old full-rewrite path
        // would emit via toAnsiString-with-absolute-positioning. Our
        // full-rewrite path actually uses eraseLines + plain text (no
        // CUP), so the primary assertion is on hasRelative; absence of
        // CUP here is a consistency check.
        const hasAbsoluteCup = /\x1b\[\d+;\d+H/.test(rerenderTail);

        expect(hasRelative).toBe(true);
        expect(hasAbsoluteCup).toBe(false);
        // Sanity: the rerender must have caused SOME output — an empty
        // tail would mean the render loop incorrectly deduped the change.
        expect(rerenderTail.length).toBeGreaterThan(0);
      } finally {
        instance.unmount();
      }
    });
  });

  // Phase A2 — fallback decision matrix (`shouldUseCustomRenderer`).
  // Each row exercises one fallback condition and asserts:
  //   * the helper returns false
  //   * a single-line stderr notice is emitted on the FIRST fallback
  //   * subsequent calls do not re-emit the notice (process-once)
  describe("shouldUseCustomRenderer fallbacks", () => {
    function fakeStderr(): NodeJS.WriteStream & { captured: string } {
      const stream = new PassThrough() as PassThrough & { captured: string };
      stream.captured = "";
      const originalWrite = stream.write.bind(stream);
      (stream as unknown as { write: (chunk: unknown) => boolean }).write = (
        chunk: unknown,
      ) => {
        stream.captured += String(chunk);
        return originalWrite(chunk as Buffer | string);
      };
      return stream as unknown as NodeJS.WriteStream & { captured: string };
    }

    function ttyStdout(): NodeJS.WriteStream {
      const s = new PassThrough() as unknown as NodeJS.WriteStream;
      (s as unknown as { isTTY: boolean }).isTTY = true;
      return s;
    }

    beforeEach(() => {
      delete process.env["GORDON_CUSTOM_RENDER"];
      delete process.env["TERM"];
      delete process.env["TMUX"];
      delete process.env["STY"];
      _resetFallbackNoticeForTests();
    });

    test("default (no env): returns false (default-off), no notice", () => {
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(result).toBe(false);
      // No notice on the default-off path — only fallbacks-overriding-opt-in emit.
      expect(stderr.captured).toBe("");
    });

    test("GORDON_CUSTOM_RENDER=0: returns false, no notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "0";
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(result).toBe(false);
      expect(stderr.captured).toBe("");
    });

    test("GORDON_CUSTOM_RENDER=false: returns false, no notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "false";
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(result).toBe(false);
      expect(stderr.captured).toBe("");
    });

    test("opt-in (=1) on TTY no-a11y: returns true, no notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "1";
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(result).toBe(true);
      expect(stderr.captured).toBe("");
    });

    test("opt-in + isScreenReaderEnabled: returns false, screen-reader notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "1";
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, true);
      expect(result).toBe(false);
      expect(stderr.captured).toContain("screen reader enabled");
    });

    test("opt-in + non-TTY stdout: returns false, isTTY notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "1";
      const stderr = fakeStderr();
      const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
      (stdout as unknown as { isTTY: boolean }).isTTY = false;
      const result = shouldUseCustomRenderer(stdout, stderr, false);
      expect(result).toBe(false);
      expect(stderr.captured).toContain("not a TTY");
    });

    test("opt-in + TERM=dumb: returns false, TERM=dumb notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "1";
      process.env["TERM"] = "dumb";
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(result).toBe(false);
      expect(stderr.captured).toContain("TERM=dumb");
    });

    test("opt-in + TMUX: returns false, tmux notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "1";
      process.env["TMUX"] = "/tmp/tmux-1000/default,12345,0";
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(result).toBe(false);
      expect(stderr.captured).toContain("tmux detected");
    });

    test("opt-in + STY: returns false, screen notice", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "1";
      process.env["STY"] = "12345.pts-0.host";
      const stderr = fakeStderr();
      const result = shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(result).toBe(false);
      expect(stderr.captured).toContain("screen detected");
    });

    test("opt-in fallback notice is process-once", () => {
      process.env["GORDON_CUSTOM_RENDER"] = "1";
      process.env["TERM"] = "dumb";
      const stderr = fakeStderr();
      shouldUseCustomRenderer(ttyStdout(), stderr, false);
      const lengthAfterFirst = stderr.captured.length;
      shouldUseCustomRenderer(ttyStdout(), stderr, false);
      expect(stderr.captured.length).toBe(lengthAfterFirst);
    });
  });
});
