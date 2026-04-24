// App.mouse — verify mouse-mode lifecycle and chunk dispatch.
//
// We instantiate App directly (no React render) and exercise the
// lifecycle methods + dispatchChunk so we can assert exactly what bytes
// are written and what events fire on the internal emitter, with no
// reconciler noise.

import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { PassThrough } from "node:stream";
import App from "./App.ts";
import { MOUSE_ENABLE, MOUSE_DISABLE } from "../parse-mouse.ts";

function makeStdout(): NodeJS.WriteStream & { captured: string } {
  const stream = new PassThrough() as PassThrough & { captured: string };
  stream.captured = "";
  const originalWrite = stream.write.bind(stream);
  (stream as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stream.captured += String(chunk);
    return originalWrite(chunk as Buffer | string);
  };
  const mock = stream as unknown as NodeJS.WriteStream & { captured: string };
  (mock as unknown as { isTTY: boolean }).isTTY = true;
  mock.columns = 80;
  mock.rows = 24;
  return mock;
}

function makeStdin(): NodeJS.ReadStream {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream;
  (stream as unknown as { isTTY: boolean }).isTTY = true;
  return stream;
}

function makeApp(): {
  app: App;
  stdout: NodeJS.WriteStream & { captured: string };
  stdin: NodeJS.ReadStream;
} {
  const stdout = makeStdout();
  const stdin = makeStdin();
  const app = new App({
    stdin,
    stdout,
    stderr: stdout, // not exercised here
    writeToStdout: () => {},
    writeToStderr: () => {},
    exitOnCtrlC: false,
    onExit: () => {},
    children: undefined,
  } as unknown as ConstructorParameters<typeof App>[0]);
  return { app, stdout, stdin };
}

const SCREEN_READER_VARS = [
  "ACCESSIBILITY_ENABLED",
  "SCREEN_READER",
  "GORDON_SCREEN_READER",
  "VOICE_OVER_ENABLED",
  "NARRATOR_RUNNING",
];

const originalEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of SCREEN_READER_VARS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of SCREEN_READER_VARS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("App mouse mode lifecycle", () => {
  test("enableMouseMode writes MOUSE_ENABLE to stdout", () => {
    const { app, stdout } = makeApp();
    app.enableMouseMode();
    expect(stdout.captured).toContain(MOUSE_ENABLE);
    expect(app.mouseModeActive).toBe(true);
  });

  test("disableMouseMode writes MOUSE_DISABLE if active", () => {
    const { app, stdout } = makeApp();
    app.enableMouseMode();
    stdout.captured = "";
    app.disableMouseMode();
    expect(stdout.captured).toContain(MOUSE_DISABLE);
    expect(app.mouseModeActive).toBe(false);
  });

  test("disableMouseMode is a no-op if mouse mode is not active", () => {
    const { app, stdout } = makeApp();
    app.disableMouseMode();
    expect(stdout.captured).toBe("");
  });

  test("enableMouseMode is a no-op when stdin is not a TTY", () => {
    const stdout = makeStdout();
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    (stdin as unknown as { isTTY: boolean }).isTTY = false;
    const app = new App({
      stdin,
      stdout,
      stderr: stdout,
      writeToStdout: () => {},
      writeToStderr: () => {},
      exitOnCtrlC: false,
      onExit: () => {},
      children: undefined,
    } as unknown as ConstructorParameters<typeof App>[0]);
    app.enableMouseMode();
    expect(stdout.captured).toBe("");
    expect(app.mouseModeActive).toBe(false);
  });

  test("enableMouseMode skips when screen reader is active", () => {
    process.env["GORDON_SCREEN_READER"] = "true";
    const { app, stdout } = makeApp();
    app.enableMouseMode();
    expect(stdout.captured).toBe("");
    expect(app.mouseModeActive).toBe(false);
  });
});

describe("App.dispatchChunk routing", () => {
  test("plain keypress chunk emits 'input' event only", () => {
    const { app } = makeApp();
    let inputCount = 0;
    let mouseCount = 0;
    app.internal_eventEmitter.on("input", () => inputCount++);
    app.internal_eventEmitter.on("mouse", () => mouseCount++);
    app.dispatchChunk("a");
    expect(inputCount).toBe(1);
    expect(mouseCount).toBe(0);
  });

  test("mouse-prefixed chunk emits 'mouse' when mouse mode is on", () => {
    const { app } = makeApp();
    app.enableMouseMode();
    const events: unknown[] = [];
    app.internal_eventEmitter.on("mouse", (e) => events.push(e));
    app.dispatchChunk("\x1b[<64;5;5M"); // wheel-up at (4,4)
    expect(events.length).toBe(1);
  });

  test("mouse mode off: \\x1b[< chunk falls through to keypress path", () => {
    const { app } = makeApp();
    let mouseCount = 0;
    let inputCount = 0;
    app.internal_eventEmitter.on("mouse", () => mouseCount++);
    app.internal_eventEmitter.on("input", () => inputCount++);
    app.dispatchChunk("\x1b[<64;5;5M");
    expect(mouseCount).toBe(0);
    expect(inputCount).toBe(1);
  });

  test("multiple back-to-back mouse events in one chunk are all parsed", () => {
    const { app } = makeApp();
    app.enableMouseMode();
    const events: unknown[] = [];
    app.internal_eventEmitter.on("mouse", (e) => events.push(e));
    app.dispatchChunk("\x1b[<64;1;1M\x1b[<65;2;2M\x1b[<0;3;3m");
    expect(events.length).toBe(3);
  });

  test("mouse events followed by keypress bytes — both delivered", () => {
    const { app } = makeApp();
    app.enableMouseMode();
    const mouseEvents: unknown[] = [];
    const inputs: string[] = [];
    app.internal_eventEmitter.on("mouse", (e) => mouseEvents.push(e));
    app.internal_eventEmitter.on("input", (s) => inputs.push(s));
    app.dispatchChunk("\x1b[<64;1;1Mhello");
    expect(mouseEvents.length).toBe(1);
    expect(inputs).toEqual(["hello"]);
  });
});
