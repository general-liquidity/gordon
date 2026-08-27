import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  installProductionGuards,
  applyProductionEnvDefaults,
  PRODUCTION_FLAG_ENV,
  DISABLE_GUARDS_ENV,
  GUARDS_MODE_ENV,
} from "./installProductionGuards.ts";
import {
  FILESYSTEM_WRITE_GUARD_FLAG_ENV,
  FILESYSTEM_WRITE_GUARD_MODE_ENV,
} from "./filesystemWriteGuard.ts";
import { NETWORK_ALLOWLIST_FLAG_ENV, NETWORK_ALLOWLIST_MODE_ENV } from "./networkAllowlist.ts";

describe("installProductionGuards", () => {
  const clearGuardEnv = () => {
    delete process.env[PRODUCTION_FLAG_ENV];
    delete process.env[NETWORK_ALLOWLIST_FLAG_ENV];
    delete process.env[NETWORK_ALLOWLIST_MODE_ENV];
    delete process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV];
    delete process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV];
  };

  beforeEach(clearGuardEnv);
  // The guards read mode env vars per-call; leaking block-mode flags here
  // fails unrelated later test files that write outside the allowlist.
  afterEach(clearGuardEnv);

  it("sets block-mode defaults when GORDON_PRODUCTION=1", () => {
    process.env[PRODUCTION_FLAG_ENV] = "1";
    installProductionGuards();
    expect(process.env[NETWORK_ALLOWLIST_FLAG_ENV]).toBe("1");
    expect(process.env[NETWORK_ALLOWLIST_MODE_ENV]).toBe("block");
    expect(process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV]).toBe("1");
    expect(process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV]).toBe("block");
  });

  // applyProductionEnvDefaults is exercised directly: installProductionGuards
  // is idempotent (module-level installed flag), so it only applies env
  // defaults on the first call across the whole suite.
  it("enables BLOCK by default with no env set", () => {
    const env: NodeJS.ProcessEnv = {};
    applyProductionEnvDefaults(env);
    expect(env[NETWORK_ALLOWLIST_FLAG_ENV]).toBe("1");
    expect(env[NETWORK_ALLOWLIST_MODE_ENV]).toBe("block");
    expect(env[FILESYSTEM_WRITE_GUARD_FLAG_ENV]).toBe("1");
    expect(env[FILESYSTEM_WRITE_GUARD_MODE_ENV]).toBe("block");
  });

  it("installs WARN mode when GORDON_GUARDS=warn", () => {
    const env: NodeJS.ProcessEnv = { [GUARDS_MODE_ENV]: "warn" };
    applyProductionEnvDefaults(env);
    expect(env[NETWORK_ALLOWLIST_FLAG_ENV]).toBe("1");
    expect(env[NETWORK_ALLOWLIST_MODE_ENV]).toBe("warn");
    expect(env[FILESYSTEM_WRITE_GUARD_FLAG_ENV]).toBe("1");
    expect(env[FILESYSTEM_WRITE_GUARD_MODE_ENV]).toBe("warn");
  });

  it("does NOT enable guards when GORDON_DISABLE_GUARDS=1", () => {
    const env: NodeJS.ProcessEnv = { [DISABLE_GUARDS_ENV]: "1" };
    applyProductionEnvDefaults(env);
    expect(env[NETWORK_ALLOWLIST_FLAG_ENV]).toBe("0");
    expect(env[FILESYSTEM_WRITE_GUARD_FLAG_ENV]).toBe("0");
    expect(env[NETWORK_ALLOWLIST_MODE_ENV]).toBeUndefined();
  });

  it("preserves an explicit operator mode override", () => {
    const env: NodeJS.ProcessEnv = { [NETWORK_ALLOWLIST_MODE_ENV]: "warn" };
    applyProductionEnvDefaults(env);
    expect(env[NETWORK_ALLOWLIST_MODE_ENV]).toBe("warn");
    // filesystem guard still gets the block default
    expect(env[FILESYSTEM_WRITE_GUARD_MODE_ENV]).toBe("block");
  });
});
