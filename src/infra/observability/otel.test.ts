import { describe, it, expect } from "bun:test";

import {
  isOtelEnabled,
  defaultTracesPath,
  createJsonlBackend,
  startSpan,
  withSpan,
  getActiveTraceContext,
  registerBackend,
  OTEL_FLAG_ENV,
  OTEL_PATH_ENV,
  type SpanRecord,
  type Backend,
} from "./otel.ts";

describe("local span seam (no-op)", () => {
  it("isOtelEnabled is always false — no external export", () => {
    expect(isOtelEnabled({})).toBe(false);
    expect(isOtelEnabled({ [OTEL_FLAG_ENV]: "1" })).toBe(false);
    expect(isOtelEnabled({ [OTEL_FLAG_ENV]: "true" })).toBe(false);
  });

  it("defaultTracesPath still honors override and falls back", () => {
    expect(defaultTracesPath({ [OTEL_PATH_ENV]: "/x/y.jsonl" })).toBe("/x/y.jsonl");
    expect(defaultTracesPath({})).toContain("otel-traces.jsonl");
  });

  it("startSpan returns a no-op span that dispatches nowhere", () => {
    const captured: SpanRecord[] = [];
    const backend: Backend = { onSpanEnd: (s) => captured.push(s) };
    const span = startSpan("trade.submit", { forceEnabled: true, backends: [backend] });
    span.setAttribute("orderId", "ord-1");
    span.addEvent("ack-received");
    const record = span.end();
    expect(record.name).toBe("noop");
    expect(captured.length).toBe(0);
  });

  it("registerBackend and createJsonlBackend are inert", () => {
    const captured: SpanRecord[] = [];
    registerBackend({ onSpanEnd: (s) => captured.push(s) });
    const backend = createJsonlBackend("/tmp/should-not-be-written.jsonl");
    backend.onSpanEnd({} as SpanRecord);
    startSpan("op").end();
    expect(captured.length).toBe(0);
  });

  it("withSpan runs the function and returns its result", async () => {
    const result = await withSpan("op", { x: 1 }, async (span) => {
      span.setStatus("ok");
      return "value";
    });
    expect(result).toBe("value");
  });

  it("withSpan propagates thrown errors", async () => {
    await expect(
      withSpan("op", {}, async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
  });

  it("getActiveTraceContext is always null", () => {
    expect(getActiveTraceContext()).toBeNull();
  });
});
