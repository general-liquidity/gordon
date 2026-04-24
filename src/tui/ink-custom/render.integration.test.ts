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

const originalEnv = process.env["GORDON_CUSTOM_RENDER"];

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
  });
});
