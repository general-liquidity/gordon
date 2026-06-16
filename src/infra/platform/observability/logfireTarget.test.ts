import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolveExporterTarget } from "./tracing.ts";

const KEYS = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "LOGFIRE_TOKEN", "LOGFIRE_BASE_URL"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveExporterTarget", () => {
  it("defaults to Axiom when nothing is configured", () => {
    const t = resolveExporterTarget();
    expect(t.target).toBe("axiom");
    expect(t.endpoint).toContain("axiom.co");
  });

  it("routes to Logfire when LOGFIRE_TOKEN is set (US region default)", () => {
    process.env.LOGFIRE_TOKEN = "wt-123";
    const t = resolveExporterTarget();
    expect(t.target).toBe("logfire");
    expect(t.endpoint).toBe("https://logfire-us.pydantic.dev/v1/traces");
    expect(t.headers.Authorization).toBe("wt-123");
  });

  it("honors the LOGFIRE_BASE_URL region override", () => {
    process.env.LOGFIRE_TOKEN = "wt";
    process.env.LOGFIRE_BASE_URL = "https://logfire-eu.pydantic.dev/";
    expect(resolveExporterTarget().endpoint).toBe("https://logfire-eu.pydantic.dev/v1/traces");
  });

  it("an explicit OTLP endpoint wins over Logfire", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://custom.example/v1/traces";
    process.env.LOGFIRE_TOKEN = "wt";
    const t = resolveExporterTarget();
    expect(t.target).toBe("custom");
    expect(t.endpoint).toBe("https://custom.example/v1/traces");
  });
});
