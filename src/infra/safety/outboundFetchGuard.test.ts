import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  BlockedOutboundError,
  enforceOutbound,
  resetAllowlistForTesting,
} from "./networkAllowlist.ts";

describe("outbound fetch guard integration", () => {
  beforeEach(() => {
    resetAllowlistForTesting();
    process.env.GORDON_NETWORK_ALLOWLIST = "1";
    process.env.GORDON_NETWORK_ALLOWLIST_MODE = "block";
  });

  afterEach(() => {
    delete process.env.GORDON_NETWORK_ALLOWLIST;
    delete process.env.GORDON_NETWORK_ALLOWLIST_MODE;
  });

  test("enforceOutbound throws in block mode for unknown host", () => {
    expect(() =>
      enforceOutbound({ url: "https://evil.example.com/exfil", caller: "test" }),
    ).toThrow(BlockedOutboundError);
  });

  test("enforceOutbound allows canonical host", () => {
    const result = enforceOutbound({ url: "https://api.anthropic.com/v1/messages", caller: "test" });
    expect(result.allowed).toBe(true);
  });
});