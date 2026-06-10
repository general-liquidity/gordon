import { describe, expect, it, beforeEach } from "bun:test";
import {
  installProductionGuards,
  PRODUCTION_FLAG_ENV,
} from "./installProductionGuards.ts";
import {
  FILESYSTEM_WRITE_GUARD_FLAG_ENV,
  FILESYSTEM_WRITE_GUARD_MODE_ENV,
} from "./filesystemWriteGuard.ts";
import {
  NETWORK_ALLOWLIST_FLAG_ENV,
  NETWORK_ALLOWLIST_MODE_ENV,
} from "./networkAllowlist.ts";

describe("installProductionGuards", () => {
  beforeEach(() => {
    delete process.env[PRODUCTION_FLAG_ENV];
    delete process.env[NETWORK_ALLOWLIST_FLAG_ENV];
    delete process.env[NETWORK_ALLOWLIST_MODE_ENV];
    delete process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV];
    delete process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV];
  });

  it("sets block-mode defaults when GORDON_PRODUCTION=1", () => {
    process.env[PRODUCTION_FLAG_ENV] = "1";
    installProductionGuards();
    expect(process.env[NETWORK_ALLOWLIST_FLAG_ENV]).toBe("1");
    expect(process.env[NETWORK_ALLOWLIST_MODE_ENV]).toBe("block");
    expect(process.env[FILESYSTEM_WRITE_GUARD_FLAG_ENV]).toBe("1");
    expect(process.env[FILESYSTEM_WRITE_GUARD_MODE_ENV]).toBe("block");
  });
});