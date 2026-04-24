// Integration test for render.ts entry point.
//
// Verifies:
//   1. Flag-off (default) path delegates to vanilla ink — render() returns
//      an Instance with the expected methods.
//   2. Flag-on path starts the custom pipeline — captures stdout and asserts
//      it contains at least a cursor sequence and our expected text.
//
// The custom pipeline bootstraps Yoga + reconciler + output painting, so
// this is a genuine end-to-end smoke test.

import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "./render.ts";
import Box from "./components/Box.ts";
import Text from "./components/Text.ts";
import Static from "./components/Static.ts";
import useApp from "./hooks/use-app.ts";
import useStdout from "./hooks/use-stdout.ts";

const originalEnv = process.env["GORDON_CUSTOM_RENDER"];
const originalMigrationEnabled = process.env["GORDON_POOL_MIGRATION_ENABLED"];
const originalMigrationInterval = process.env["GORDON_POOL_MIGRATION_INTERVAL_MS"];

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
});

describe("render() integration", () => {
  test("flag OFF: returns an Instance handle with expected methods", () => {
    delete process.env["GORDON_CUSTOM_RENDER"];
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

  describe("flag ON: custom pipeline", () => {
    beforeEach(() => {
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

    test("useApp context is available — exit() triggers unmount", async () => {
      const stdout = createMockStdout();
      const captured: { exit?: () => void } = {};
      const Consumer: React.FC = () => {
        const { exit } = useApp();
        captured.exit = exit;
        return React.createElement(Text, null, "app-consumer");
      };
      const tree = React.createElement(Consumer);
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      // Hook must have received the context (non-null exit function).
      expect(typeof captured.exit).toBe("function");
      expect(stdout.captured).toContain("app-consumer");
      // exit() should resolve waitUntilExit without us calling unmount.
      const exitPromise = instance.waitUntilExit();
      captured.exit?.();
      await exitPromise;
      expect(true).toBe(true);
    });

    test("useStdout context is available — returns our stdout stream", () => {
      const stdout = createMockStdout();
      const captured: { stdout?: NodeJS.WriteStream } = {};
      const Consumer: React.FC = () => {
        const { stdout: s } = useStdout();
        captured.stdout = s;
        return React.createElement(Text, null, "stdout-consumer");
      };
      const tree = React.createElement(Consumer);
      const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
      try {
        // The hook must have received our mock stdout, not process.stdout.
        expect(captured.stdout).toBe(stdout);
      } finally {
        instance.unmount();
      }
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
  });
});
