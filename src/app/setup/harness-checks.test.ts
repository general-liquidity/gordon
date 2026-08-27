import { describe, it, expect } from "bun:test";

import { collectSandboxChecks } from "./harness-checks.ts";
import type { OutboundFetchGuardStatus } from "../../infra/safety/outboundFetchGuard.ts";
import type { FilesystemWriteGuardStatus } from "../../infra/safety/filesystemWriteGuardInstaller.ts";

function fetchStatus(overrides: Partial<OutboundFetchGuardStatus> = {}): OutboundFetchGuardStatus {
  return {
    installed: true,
    enabled: true,
    mode: "warn",
    warnViolations: 0,
    recentViolations: [],
    ...overrides,
  };
}

function fsStatus(overrides: Partial<FilesystemWriteGuardStatus> = {}): FilesystemWriteGuardStatus {
  return {
    installed: true,
    enabled: true,
    mode: "warn",
    warnViolations: 0,
    recentViolations: [],
    ...overrides,
  };
}

describe("collectSandboxChecks — guard status surfacing", () => {
  it("reports both guards as info when installed and clean", () => {
    const checks = collectSandboxChecks(fetchStatus(), fsStatus());
    expect(checks.map((c) => c.id)).toEqual([
      "sandbox.network_allowlist",
      "sandbox.filesystem_write_guard",
      "sandbox.transport_guard_coverage",
    ]);
    for (const check of checks.slice(0, 2)) {
      expect(check.ok).toBe(true);
      expect(check.severity).toBe("info");
      expect(check.message).toContain("installed in warn mode");
    }
    const coverage = checks.find((c) => c.id === "sandbox.transport_guard_coverage");
    expect(coverage?.ok).toBe(true);
    expect(coverage?.message).toContain("No direct native HTTP/socket transports found");
  });

  it("errors when network allowlist is enabled but the fetch guard is not installed", () => {
    const checks = collectSandboxChecks(fetchStatus({ installed: false }), fsStatus());
    const net = checks.find((c) => c.id === "sandbox.network_allowlist");
    expect(net?.ok).toBe(false);
    expect(net?.severity).toBe("error");
    expect(net?.message).toContain("NOT installed");
    expect(net?.message).toContain("inert");
  });

  it("errors when filesystem guard is enabled but not installed", () => {
    const checks = collectSandboxChecks(fetchStatus(), fsStatus({ installed: false }));
    const fs = checks.find((c) => c.id === "sandbox.filesystem_write_guard");
    expect(fs?.ok).toBe(false);
    expect(fs?.severity).toBe("error");
    expect(fs?.message).toContain("inert");
  });

  it("surfaces warn-mode violation counts and recent offending hosts", () => {
    const checks = collectSandboxChecks(
      fetchStatus({ warnViolations: 4, recentViolations: ["a.example.com", "b.example.com"] }),
      fsStatus(),
    );
    const net = checks.find((c) => c.id === "sandbox.network_allowlist");
    expect(net?.ok).toBe(true);
    expect(net?.severity).toBe("warn");
    expect(net?.message).toContain("4 warn-mode violation(s)");
    expect(net?.message).toContain("b.example.com");
  });

  it("surfaces warn-mode violation counts and recent paths for the filesystem guard", () => {
    const checks = collectSandboxChecks(
      fetchStatus(),
      fsStatus({
        warnViolations: 2,
        recentViolations: ["C:/outside/one.txt", "C:/outside/two.txt"],
      }),
    );
    const fs = checks.find((c) => c.id === "sandbox.filesystem_write_guard");
    expect(fs?.severity).toBe("warn");
    expect(fs?.message).toContain("2 warn-mode violation(s)");
    expect(fs?.message).toContain("C:/outside/two.txt");
  });

  it("warns (not silent) when a guard is disabled via env", () => {
    const checks = collectSandboxChecks(
      fetchStatus({ enabled: false, installed: false }),
      fsStatus({ enabled: false, installed: false }),
    );
    expect(checks).toHaveLength(3);
    for (const check of checks.slice(0, 2)) {
      expect(check.ok).toBe(false);
      expect(check.severity).toBe("warn");
      expect(check.message).toContain("disabled");
    }
    expect(checks[0]?.message).toContain("GORDON_NETWORK_ALLOWLIST");
    expect(checks[1]?.message).toContain("GORDON_FILESYSTEM_WRITE_GUARD");
    const coverage = checks.find((c) => c.id === "sandbox.transport_guard_coverage");
    expect(coverage?.ok).toBe(false);
    expect(coverage?.severity).toBe("error");
  });

  it("reflects block mode in the message", () => {
    const checks = collectSandboxChecks(
      fetchStatus({ mode: "block" }),
      fsStatus({ mode: "block" }),
    );
    expect(checks[0]?.message).toContain("block mode");
    expect(checks[1]?.message).toContain("block mode");
  });
});
