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
