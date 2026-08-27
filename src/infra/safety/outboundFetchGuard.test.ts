import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  BlockedOutboundError,
  enforceOutbound,
  resetAllowlistForTesting,
} from "./networkAllowlist.ts";
import {
  guardOutboundUrl,
  installOutboundFetchGuard,
  isOutboundFetchGuardInstalled,
  resetOutboundFetchGuardStatsForTesting,
} from "./outboundFetchGuard.ts";

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
    const result = enforceOutbound({
      url: "https://api.anthropic.com/v1/messages",
      caller: "test",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("isOutboundFetchGuardInstalled — status accessor", () => {
  beforeEach(() => {
    resetAllowlistForTesting();
    resetOutboundFetchGuardStatsForTesting();
    delete process.env.GORDON_NETWORK_ALLOWLIST;
    delete process.env.GORDON_NETWORK_ALLOWLIST_MODE;
  });

  afterEach(() => {
    resetOutboundFetchGuardStatsForTesting();
    delete process.env.GORDON_NETWORK_ALLOWLIST;
    delete process.env.GORDON_NETWORK_ALLOWLIST_MODE;
  });

  test("reports mode from env (warn default, block override)", () => {
    expect(isOutboundFetchGuardInstalled().mode).toBe("warn");
    process.env.GORDON_NETWORK_ALLOWLIST_MODE = "block";
    expect(isOutboundFetchGuardInstalled().mode).toBe("block");
  });

  test("reports enabled flag from env", () => {
    expect(isOutboundFetchGuardInstalled().enabled).toBe(true);
    process.env.GORDON_NETWORK_ALLOWLIST = "0";
    expect(isOutboundFetchGuardInstalled().enabled).toBe(false);
  });

  test("reports installed=true after installOutboundFetchGuard", () => {
    installOutboundFetchGuard();
    expect(isOutboundFetchGuardInstalled().installed).toBe(true);
  });
});

describe("guardOutboundUrl — warn-mode violation counter", () => {
  beforeEach(() => {
    resetAllowlistForTesting();
    resetOutboundFetchGuardStatsForTesting();
    process.env.GORDON_NETWORK_ALLOWLIST = "1";
    delete process.env.GORDON_NETWORK_ALLOWLIST_MODE; // warn (default)
  });

  afterEach(() => {
    resetOutboundFetchGuardStatsForTesting();
    delete process.env.GORDON_NETWORK_ALLOWLIST;
    delete process.env.GORDON_NETWORK_ALLOWLIST_MODE;
  });

  test("counts a warn-mode miss and records the offending host", () => {
    guardOutboundUrl("https://evil.example.com/exfil", "test");
    const status = isOutboundFetchGuardInstalled();
    expect(status.warnViolations).toBe(1);
    expect(status.recentViolations).toEqual(["evil.example.com"]);
  });

  test("does not count allowed hosts", () => {
    guardOutboundUrl("https://api.anthropic.com/v1/messages", "test");
    expect(isOutboundFetchGuardInstalled().warnViolations).toBe(0);
  });

  test("caps recent violations at 20, dropping oldest first", () => {
    for (let i = 0; i < 25; i++) {
      guardOutboundUrl(`https://evil-${i}.example.com/x`, "test");
    }
    const status = isOutboundFetchGuardInstalled();
    expect(status.warnViolations).toBe(25);
    expect(status.recentViolations).toHaveLength(20);
    expect(status.recentViolations[0]).toBe("evil-5.example.com");
    expect(status.recentViolations[19]).toBe("evil-24.example.com");
  });

  test("no-ops when the allowlist is disabled", () => {
    process.env.GORDON_NETWORK_ALLOWLIST = "0";
    guardOutboundUrl("https://evil.example.com/exfil", "test");
    expect(isOutboundFetchGuardInstalled().warnViolations).toBe(0);
  });

  test("block mode throws and does not count as a warn violation", () => {
    process.env.GORDON_NETWORK_ALLOWLIST_MODE = "block";
    expect(() => guardOutboundUrl("https://evil.example.com/exfil", "test")).toThrow(
      BlockedOutboundError,
    );
    expect(isOutboundFetchGuardInstalled().warnViolations).toBe(0);
  });
});
