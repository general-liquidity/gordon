import { afterEach, describe, expect, it } from "bun:test";

import { Logger, MemoryTransport } from "./logger.ts";

const ORIGINAL_STARTUP_QUIET = process.env.GORDON_STARTUP_QUIET;
const ORIGINAL_APP_READY = process.env.GORDON_APP_READY;

afterEach(() => {
  if (ORIGINAL_STARTUP_QUIET === undefined) {
    delete process.env.GORDON_STARTUP_QUIET;
  } else {
    process.env.GORDON_STARTUP_QUIET = ORIGINAL_STARTUP_QUIET;
  }

  if (ORIGINAL_APP_READY === undefined) {
    delete process.env.GORDON_APP_READY;
  } else {
    process.env.GORDON_APP_READY = ORIGINAL_APP_READY;
  }
});

describe("logger secret redaction", () => {
  it("redacts a secret in context and in error.message/stack", () => {
    const transport = new MemoryTransport();
    const logger = new Logger({ level: "debug", transports: [transport] });

    const secret = "sk-ant-api01-aaaaaaaaaaaaaaaaaaaaaaaa";
    const err = new Error(`call failed with key ${secret}`);
    logger.error("boom", err, { apiKey: secret, nested: { token: secret } });

    const entry = transport.entries.at(-1)!;
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(secret);
    expect(entry.error?.message).toContain("[REDACTED]");
    expect((entry.context as Record<string, unknown>).apiKey).toBe("[REDACTED]");
  });

  it("redacts a 64-hex key and a 40-char high-entropy token", () => {
    const transport = new MemoryTransport();
    const logger = new Logger({ level: "debug", transports: [transport] });

    const hex = "f".repeat(64);
    const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0";
    logger.warn("creds", { secret: hex, opaque: token });

    const entry = transport.entries.at(-1)!;
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(hex);
    expect(serialized).not.toContain(token);
  });

  it("does NOT redact price / quantity numbers in context", () => {
    const transport = new MemoryTransport();
    const logger = new Logger({ level: "debug", transports: [transport] });

    logger.warn("order", { price: 64250.5, qty: 0.5 });

    const entry = transport.entries.at(-1)!;
    const ctx = entry.context as Record<string, unknown>;
    expect(ctx.price).toBe(64250.5);
    expect(ctx.qty).toBe(0.5);
  });
});

describe("logger startup quiet mode", () => {
  it("suppresses info logs before the app is ready", () => {
    process.env.GORDON_STARTUP_QUIET = "1";
    delete process.env.GORDON_APP_READY;

    const transport = new MemoryTransport();
    const logger = new Logger({
      level: "info",
      transports: [transport],
    });

    logger.info("Boot info");
    logger.warn("Boot warn");

    expect(transport.entries.map((entry) => entry.message)).toEqual(["Boot warn"]);
  });

  it("suppresses info logs for the entire quiet startup session", () => {
    process.env.GORDON_STARTUP_QUIET = "1";
    process.env.GORDON_APP_READY = "1";

    const transport = new MemoryTransport();
    const logger = new Logger({
      level: "info",
      transports: [transport],
    });

    logger.info("Runtime info");

    expect(transport.entries.map((entry) => entry.message)).toEqual([]);
  });
});
