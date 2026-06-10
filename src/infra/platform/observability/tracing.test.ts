import { afterEach, describe, expect, it } from "bun:test";
import {
  getTracingConfig,
  getTracingStatus,
  initializeTracing,
  shutdownTracing,
} from "./tracing.ts";

const ORIGINAL_ENV = { ...process.env };

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  await shutdownTracing();
});

describe("tracing", () => {
  it("stays disabled without review gate and consent", () => {
    process.env.OTEL_TRACING_ENABLED = "true";
    delete process.env.GORDON_TRACING_REVIEWED;
    const config = getTracingConfig();
    expect(config.requested).toBe(true);
    expect(config.enabled).toBe(false);
  });

  it("initializeTracing is idempotent when disabled", async () => {
    delete process.env.OTEL_TRACING_ENABLED;
    await initializeTracing();
    const first = getTracingStatus();
    await initializeTracing();
    const second = getTracingStatus();
    expect(first.initialized).toBe(true);
    expect(second.initialized).toBe(true);
    expect(second.mastraWired).toBe(false);
  });
});