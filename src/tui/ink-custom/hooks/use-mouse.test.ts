// useMouse — subscription/cleanup smoke tests.
//
// We mount a probe component via ink-custom's render() and verify the hook
// (a) attaches exactly one listener to the StdinContext emitter, (b)
// receives events emitted on `mouse`, (c) detaches on unmount, and (d)
// does not re-subscribe across renders even when the handler identity
// changes (latest-handler-via-ref pattern).

import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import React from "react";
import { render } from "../render.ts";
import Text from "../components/Text.ts";
import StdinContext from "../contexts/StdinContext.ts";
import useMouse, { type MouseEvent } from "./use-mouse.ts";

function createMockStdout(): NodeJS.WriteStream {
  const stream = new PassThrough();
  const mock = stream as unknown as NodeJS.WriteStream;
  mock.columns = 40;
  mock.rows = 10;
  (mock as unknown as { isTTY: boolean }).isTTY = true;
  return mock;
}

const sampleEvent: MouseEvent = {
  type: "press",
  button: "wheel-up",
  x: 1,
  y: 2,
  shift: false,
  meta: false,
  ctrl: false,
};

function Probe(props: { onEvent: (e: MouseEvent) => void; isActive?: boolean }) {
  useMouse(props.onEvent, { isActive: props.isActive });
  return React.createElement(Text, null, "probe");
}

describe("useMouse", () => {
  test("subscribes to the emitter on mount; receives mouse events; cleans up on unmount", () => {
    const stdout = createMockStdout();
    const receivedBox: { value: MouseEvent | null } = { value: null };
    let capturedEmitter: import("node:events").EventEmitter | null = null;

    // We capture the StdinContext emitter the App provides by reading
    // it inside the probe and stashing it.
    function CaptureProbe(props: { onEvent: (e: MouseEvent) => void }) {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { internal_eventEmitter } = React.useContext(StdinContext);
      capturedEmitter = internal_eventEmitter;
      return React.createElement(Probe, { onEvent: props.onEvent });
    }

    const tree = React.createElement(CaptureProbe, {
      onEvent: (e: MouseEvent) => {
        receivedBox.value = e;
      },
    });

    const instance = render(tree, { stdout, patchConsole: false, exitOnCtrlC: false });
    try {
      expect(capturedEmitter).not.toBeNull();
      expect(capturedEmitter!.listenerCount("mouse")).toBe(1);
      capturedEmitter!.emit("mouse", sampleEvent);
      expect(receivedBox.value).toEqual(sampleEvent);
    } finally {
      instance.unmount();
    }
    expect(capturedEmitter!.listenerCount("mouse")).toBe(0);
  });

  test("does not subscribe when isActive=false", () => {
    const stdout = createMockStdout();
    let capturedEmitter: import("node:events").EventEmitter | null = null;
    function CaptureProbe() {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { internal_eventEmitter } = React.useContext(StdinContext);
      capturedEmitter = internal_eventEmitter;
      return React.createElement(Probe, { onEvent: () => {}, isActive: false });
    }
    const instance = render(React.createElement(CaptureProbe, null), {
      stdout,
      patchConsole: false,
      exitOnCtrlC: false,
    });
    try {
      expect(capturedEmitter!.listenerCount("mouse")).toBe(0);
    } finally {
      instance.unmount();
    }
  });

  test("uses latest handler without re-subscribing on re-render", () => {
    const stdout = createMockStdout();
    const seen: string[] = [];
    let capturedEmitter: import("node:events").EventEmitter | null = null;
    function CaptureProbe(props: { tag: string }) {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { internal_eventEmitter } = React.useContext(StdinContext);
      capturedEmitter = internal_eventEmitter;
      return React.createElement(Probe, {
        onEvent: (_e: MouseEvent) => seen.push(props.tag),
      });
    }
    const instance = render(React.createElement(CaptureProbe, { tag: "first" }), {
      stdout,
      patchConsole: false,
      exitOnCtrlC: false,
    });
    try {
      expect(capturedEmitter!.listenerCount("mouse")).toBe(1);
      // Re-render with a new handler closure.
      instance.rerender(React.createElement(CaptureProbe, { tag: "second" }));
      expect(capturedEmitter!.listenerCount("mouse")).toBe(1);
      capturedEmitter!.emit("mouse", sampleEvent);
      expect(seen).toEqual(["second"]);
    } finally {
      instance.unmount();
    }
  });
});
