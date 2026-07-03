// App.input — verify dispatchChunk drives the streaming tokenizer end-to-end.
//
// Complements App.mouse.test.ts: these assert the cross-read / embedded /
// paste fixes route through the internal emitter as `input` and `paste`.

import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import App from "./App.ts";

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

function makeApp(): { app: App; stdout: NodeJS.WriteStream & { captured: string } } {
  const stdout = makeStdout();
  const stdin = makeStdin();
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
  return { app, stdout };
}

describe("App.dispatchChunk — streaming tokenizer", () => {
  test("split escape across two chunks emits one arrow 'input'", () => {
    const { app } = makeApp();
    const inputs: string[] = [];
    app.internal_eventEmitter.on("input", (s) => inputs.push(s));
    app.dispatchChunk("\x1b[");
    expect(inputs).toEqual([]);
    app.dispatchChunk("A");
    expect(inputs).toEqual(["\x1b[A"]);
    app.inputPipeline?.dispose();
  });

  test("embedded control mid-text emits text then sequence", () => {
    const { app } = makeApp();
    const inputs: string[] = [];
    app.internal_eventEmitter.on("input", (s) => inputs.push(s));
    app.dispatchChunk("ab\x1b[A");
    expect(inputs).toEqual(["ab", "\x1b[A"]);
    app.inputPipeline?.dispose();
  });

  test("multi-line paste emits one 'paste', zero 'input'", () => {
    const { app } = makeApp();
    const inputs: string[] = [];
    const pastes: string[] = [];
    app.internal_eventEmitter.on("input", (s) => inputs.push(s));
    app.internal_eventEmitter.on("paste", (t) => pastes.push(t));
    app.dispatchChunk("\x1b[200~line1\nline2\x1b[201~");
    expect(pastes).toEqual(["line1\nline2"]);
    expect(inputs).toEqual([]);
    app.inputPipeline?.dispose();
  });

  test("partial mouse across chunks completes when mouse mode is on", () => {
    const { app } = makeApp();
    app.enableMouseMode();
    const events: unknown[] = [];
    app.internal_eventEmitter.on("mouse", (e) => events.push(e));
    app.dispatchChunk("\x1b[<64;5");
    expect(events.length).toBe(0);
    app.dispatchChunk(";5M");
    expect(events.length).toBe(1);
    app.inputPipeline?.dispose();
  });

  test("componentDidMount enables bracketed paste on a TTY", () => {
    const { app, stdout } = makeApp();
    app.enableBracketedPaste();
    expect(stdout.captured).toContain("\x1b[?2004h");
    stdout.captured = "";
    app.disableBracketedPaste();
    expect(stdout.captured).toContain("\x1b[?2004l");
  });
});
