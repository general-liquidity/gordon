import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isOtelEnabled,
  defaultTracesPath,
  createJsonlBackend,
  startSpan,
  withSpan,
  getActiveTraceContext,
  resetTracerForTesting,
  registerBackend,
  OTEL_FLAG_ENV,
  OTEL_PATH_ENV,
  type SpanRecord,
  type Backend,
} from "./otel.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-otel-test-"));
  logPath = join(tempDir, "otel.jsonl");
  resetTracerForTesting();
});

describe("isOtelEnabled", () => {
  it("respects the flag", () => {
    expect(isOtelEnabled({})).toBe(false);
    expect(isOtelEnabled({ [OTEL_FLAG_ENV]: "1" })).toBe(true);
    expect(isOtelEnabled({ [OTEL_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("defaultTracesPath", () => {
  it("honors override env var", () => {
    expect(defaultTracesPath({ [OTEL_PATH_ENV]: "/x/y.jsonl" })).toBe("/x/y.jsonl");
  });
  it("falls back to home-dir", () => {
    expect(defaultTracesPath({})).toContain("otel-traces.jsonl");
  });
});

describe("startSpan when disabled", () => {
  it("returns a no-op span that does nothing", () => {
    const span = startSpan("test.op");
    span.setAttribute("foo", "bar");
    span.addEvent("evt");
    const record = span.end();
    expect(record.name).toBe("noop");
    expect(record.durationMs).toBe(0);
  });
});

describe("startSpan when enabled", () => {
  it("records attributes and timing", () => {
    const captured: SpanRecord[] = [];
    const backend: Backend = { onSpanEnd: (s) => captured.push(s) };

    const span = startSpan("trade.submit", {
      attributes: { symbol: "BTC/USD", size: 0.1 },
      forceEnabled: true,
      backends: [backend],
    });
    span.setAttribute("orderId", "ord-1");
    span.addEvent("ack-received", { latencyMs: 42 });
    const record = span.end();

    expect(captured.length).toBe(1);
    expect(record.name).toBe("trade.submit");
    expect(record.attributes.symbol).toBe("BTC/USD");
    expect(record.attributes.size).toBe(0.1);
    expect(record.attributes.orderId).toBe("ord-1");
    expect(record.events.length).toBe(1);
    expect(record.events[0]!.name).toBe("ack-received");
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("generates 32-hex traceId and 16-hex spanId", () => {
    const span = startSpan("op", { forceEnabled: true, backends: [] });
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("inherits parent traceId via async context (withSpan)", async () => {
    const captured: SpanRecord[] = [];
    const backend: Backend = { onSpanEnd: (s) => captured.push(s) };

    await withSpan("outer", {}, async () => {
      await withSpan("inner", {}, async () => {}, { forceEnabled: true, backends: [backend] });
    }, { forceEnabled: true, backends: [backend] });

    expect(captured.length).toBe(2);
    const outer = captured.find((s) => s.name === "outer")!;
    const inner = captured.find((s) => s.name === "inner")!;
    expect(inner.traceId).toBe(outer.traceId);
    expect(inner.parentSpanId).toBe(outer.spanId);
  });

  it("respects explicit traceId override", () => {
    const captured: SpanRecord[] = [];
    const backend: Backend = { onSpanEnd: (s) => captured.push(s) };

    startSpan("op", {
      forceEnabled: true,
      traceId: "0123456789abcdef0123456789abcdef",
      backends: [backend],
    }).end();

    expect(captured[0]!.traceId).toBe("0123456789abcdef0123456789abcdef");
  });

  it("setStatus records status and message", () => {
    const captured: SpanRecord[] = [];
    const span = startSpan("op", { forceEnabled: true, backends: [{ onSpanEnd: (s) => captured.push(s) }] });
    span.setStatus("error", "broker down");
    span.end();
    expect(captured[0]!.status).toBe("error");
    expect(captured[0]!.statusMessage).toBe("broker down");
  });

  it("recordError captures stack and sets status=error", () => {
    const captured: SpanRecord[] = [];
    const span = startSpan("op", { forceEnabled: true, backends: [{ onSpanEnd: (s) => captured.push(s) }] });
    span.recordError(new Error("boom"));
    span.end();
    expect(captured[0]!.status).toBe("error");
    expect(captured[0]!.error?.message).toBe("boom");
    expect(captured[0]!.error?.name).toBe("Error");
  });

  it("recordError handles non-Error throws", () => {
    const captured: SpanRecord[] = [];
    const span = startSpan("op", { forceEnabled: true, backends: [{ onSpanEnd: (s) => captured.push(s) }] });
    span.recordError("string-error");
    span.end();
    expect(captured[0]!.error?.name).toBe("unknown");
    expect(captured[0]!.error?.message).toBe("string-error");
  });

  it("end is idempotent", () => {
    let endCalls = 0;
    const backend: Backend = { onSpanEnd: () => endCalls++ };
    const span = startSpan("op", { forceEnabled: true, backends: [backend] });
    span.end();
    span.end();
    expect(endCalls).toBe(1);
  });

  it("setAttribute after end is a no-op", () => {
    const captured: SpanRecord[] = [];
    const span = startSpan("op", { forceEnabled: true, backends: [{ onSpanEnd: (s) => captured.push(s) }] });
    span.end();
    span.setAttribute("late", "ignored");
    expect(captured[0]!.attributes.late).toBeUndefined();
  });

  it("backend errors do not propagate", () => {
    const evil: Backend = { onSpanEnd() { throw new Error("backend exploded"); } };
    expect(() => startSpan("op", { forceEnabled: true, backends: [evil] }).end()).not.toThrow();
  });

  it("uses injected clock", () => {
    const captured: SpanRecord[] = [];
    let t = 1000;
    const backend: Backend = { onSpanEnd: (s) => captured.push(s) };
    const span = startSpan("op", {
      forceEnabled: true,
      backends: [backend],
      now: () => t,
    });
    t = 1500;
    span.end();
    expect(captured[0]!.startTimeMs).toBe(1000);
    expect(captured[0]!.endTimeMs).toBe(1500);
    expect(captured[0]!.durationMs).toBe(500);
  });
});

describe("createJsonlBackend", () => {
  it("appends span records as JSONL", () => {
    const backend = createJsonlBackend(logPath);
    const span = startSpan("trade.submit", {
      forceEnabled: true,
      attributes: { symbol: "BTC/USD" },
      backends: [backend],
    });
    span.end();
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.name).toBe("trade.submit");
  });

  it("creates parent dir if missing", () => {
    const nested = join(tempDir, "deep", "nested", "traces.jsonl");
    const backend = createJsonlBackend(nested);
    startSpan("op", { forceEnabled: true, backends: [backend] }).end();
    expect(existsSync(nested)).toBe(true);
  });
});

describe("withSpan", () => {
  it("auto-ends on success and sets status=ok", async () => {
    const captured: SpanRecord[] = [];
    await withSpan("op", { x: 1 }, async () => {
      return "result";
    }, { forceEnabled: true, backends: [{ onSpanEnd: (s) => captured.push(s) }] });

    expect(captured.length).toBe(1);
    expect(captured[0]!.status).toBe("ok");
    expect(captured[0]!.attributes.x).toBe(1);
  });

  it("records thrown error and re-throws", async () => {
    const captured: SpanRecord[] = [];
    await expect(
      withSpan("op", {}, async () => {
        throw new Error("kaboom");
      }, { forceEnabled: true, backends: [{ onSpanEnd: (s) => captured.push(s) }] }),
    ).rejects.toThrow("kaboom");
    expect(captured[0]!.status).toBe("error");
    expect(captured[0]!.error?.message).toBe("kaboom");
  });

  it("exposes active trace context inside the span", async () => {
    let inner: { traceId: string; spanId: string } | null = null;
    await withSpan("op", {}, async () => {
      inner = getActiveTraceContext();
    }, { forceEnabled: true, backends: [] });

    expect(inner).not.toBeNull();
    expect(inner!.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns null context outside any span", () => {
    expect(getActiveTraceContext()).toBeNull();
  });
});

describe("registerBackend", () => {
  it("dispatches to globally registered backend", () => {
    process.env[OTEL_FLAG_ENV] = "1";
    resetTracerForTesting();
    const captured: SpanRecord[] = [];
    registerBackend({ onSpanEnd: (s) => captured.push(s) });
    startSpan("op").end();
    expect(captured.length).toBeGreaterThanOrEqual(1);
    delete process.env[OTEL_FLAG_ENV];
    resetTracerForTesting();
  });
});
