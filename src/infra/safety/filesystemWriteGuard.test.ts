import { describe, it, expect, beforeEach } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  isFilesystemWriteGuardEnabled,
  getGuardMode,
  checkWrite,
  enforceWrite,
  addAllowedPath,
  listAllowedPaths,
  resetGuardForTesting,
  resultToPayload,
  FILESYSTEM_WRITE_GUARD_FLAG_ENV,
  FILESYSTEM_WRITE_GUARD_MODE_ENV,
} from "./filesystemWriteGuard.ts";

beforeEach(() => {
  resetGuardForTesting();
});

describe("isFilesystemWriteGuardEnabled", () => {
  it("defaults on and supports explicit disable", () => {
    expect(isFilesystemWriteGuardEnabled({})).toBe(true);
    expect(isFilesystemWriteGuardEnabled({ [FILESYSTEM_WRITE_GUARD_FLAG_ENV]: "1" })).toBe(true);
    expect(isFilesystemWriteGuardEnabled({ [FILESYSTEM_WRITE_GUARD_FLAG_ENV]: "true" })).toBe(true);
    expect(isFilesystemWriteGuardEnabled({ [FILESYSTEM_WRITE_GUARD_FLAG_ENV]: "0" })).toBe(false);
    expect(isFilesystemWriteGuardEnabled({ [FILESYSTEM_WRITE_GUARD_FLAG_ENV]: "false" })).toBe(
      false,
    );
  });
});

describe("getGuardMode", () => {
  it("defaults to warn", () => {
    expect(getGuardMode({})).toBe("warn");
  });
  it("respects 'block' override", () => {
    expect(getGuardMode({ [FILESYSTEM_WRITE_GUARD_MODE_ENV]: "block" })).toBe("block");
  });
});

describe("listAllowedPaths — defaults", () => {
  it("includes ~/.gordon", () => {
    const paths = listAllowedPaths().map((r) => r.prefix);
    expect(paths.some((p) => p === resolve(homedir(), ".gordon"))).toBe(true);
  });

  it("includes /tmp/gordon- prefix", () => {
    const paths = listAllowedPaths().map((r) => r.prefix);
    expect(paths.some((p) => p === resolve(tmpdir(), "gordon-"))).toBe(true);
  });

  it("includes current working directory", () => {
    const paths = listAllowedPaths().map((r) => r.prefix);
    expect(paths.some((p) => p === resolve(process.cwd()))).toBe(true);
  });
});

describe("checkWrite — default allowlist", () => {
  it("allows writes inside ~/.gordon/", () => {
    const r = checkWrite({ path: join(homedir(), ".gordon", "some-file.json") });
    expect(r.allowed).toBe(true);
  });

  it("allows writes inside /tmp/gordon-xyz/", () => {
    const r = checkWrite({ path: join(tmpdir(), "gordon-abc123", "scratch.txt") });
    expect(r.allowed).toBe(true);
  });

  it("allows writes inside cwd", () => {
    const r = checkWrite({ path: join(process.cwd(), "foo.txt") });
    expect(r.allowed).toBe(true);
  });

  it("blocks writes to ~/.ssh/authorized_keys", () => {
    const r = checkWrite({ path: join(homedir(), ".ssh", "authorized_keys") });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("allowlist");
  });

  it("blocks writes to /etc/passwd (Unix-style absolute outside cwd)", () => {
    // Resolve to ensure we're outside cwd regardless of platform tmpdir
    const r = checkWrite({ path: "/etc/passwd-test-path-not-real" });
    // On Windows the resolved path will differ but should still be outside cwd unless cwd is "C:\"
    // We assert it does not match if it's outside cwd.
    if (process.platform === "win32") {
      // Skip on Windows where /etc resolves under cwd's root
    } else {
      expect(r.allowed).toBe(false);
    }
  });
});

describe("checkWrite — relative paths", () => {
  it("resolves relative paths against cwd (treated as inside cwd)", () => {
    const r = checkWrite({ path: "subdir/file.txt" });
    expect(r.allowed).toBe(true);
  });
});

describe("checkWrite — path traversal", () => {
  it("does NOT silently allow ../../../etc/passwd-style escapes", () => {
    // From cwd, ../../../... resolves to somewhere outside cwd
    const r = checkWrite({ path: "../../../../etc/passwd-test" });
    if (process.platform !== "win32") {
      // On Unix this resolves above cwd; should not be allowed.
      expect(r.allowed).toBe(false);
    }
  });
});

describe("addAllowedPath", () => {
  it("adds a runtime prefix that subsequent checks accept", () => {
    const before = checkWrite({ path: "/opt/gordon-custom/x" });
    expect(before.allowed).toBe(false);
    addAllowedPath({ prefix: "/opt/gordon-custom" });
    const after = checkWrite({ path: "/opt/gordon-custom/x" });
    expect(after.allowed).toBe(true);
  });
});

describe("checkWrite — proper subpath only", () => {
  it("does NOT match a sibling that shares the prefix string", () => {
    addAllowedPath({ prefix: resolve("/opt/gordon-only") });
    const r = checkWrite({ path: resolve("/opt/gordon-only-different/file") });
    // Sibling path that just happens to start with the same characters
    // must be rejected (path-separator boundary required).
    expect(r.allowed).toBe(false);
  });

  it("respects path separator boundaries", () => {
    addAllowedPath({ prefix: resolve("/opt/gordon-only") });
    // A real subdirectory MATCHES
    const inside = checkWrite({ path: resolve("/opt/gordon-only/file") });
    expect(inside.allowed).toBe(true);
  });
});

describe("enforceWrite — block mode", () => {
  it("throws BlockedWriteError on a miss", () => {
    expect(() => enforceWrite({ path: "/etc/something-blocked" }, { mode: "block" })).toThrow();
  });

  it("returns the result on an allowed path", () => {
    const r = enforceWrite({ path: join(homedir(), ".gordon", "x") }, { mode: "block" });
    expect(r.allowed).toBe(true);
  });
});

describe("enforceWrite — warn mode", () => {
  it("does NOT throw on a miss", () => {
    const r = enforceWrite({ path: "/etc/something-warned" }, { mode: "warn" });
    expect(r.allowed).toBe(false);
    expect(r.mode).toBe("warn");
  });
});

describe("custom rules option", () => {
  it("honors caller-supplied rules", () => {
    // Use resolve so this works the same on Windows + Unix
    const root = resolve("custom-rule-root");
    const r = checkWrite({ path: join(root, "here") }, { rules: [{ prefix: root }] });
    expect(r.allowed).toBe(true);
  });
});

describe("resultToPayload", () => {
  it("emits stable shape", () => {
    const r = checkWrite({ path: join(homedir(), ".gordon", "x"), caller: "writer" });
    const p = resultToPayload(r, "writer");
    expect(p.kind).toBe("filesystem_write_guard.check_recorded");
    expect(p.allowed).toBe(true);
    expect(p.caller).toBe("writer");
  });
});

describe("Anthropic Claude Code parity — cwd allowed, parents blocked", () => {
  it("allows writes inside cwd", () => {
    expect(checkWrite({ path: join(process.cwd(), "out.json") }).allowed).toBe(true);
  });
  it("blocks writes to a definitively-outside path", () => {
    // Resolve to ensure we're definitely outside cwd
    const outside =
      process.platform === "win32" ? "C:\\Windows\\System32\\test" : "/etc/test-not-real";
    const r = checkWrite({ path: outside });
    // On Windows when cwd is on C: drive this still includes System32 inside C: — accept either outcome
    if (process.platform !== "win32") {
      expect(r.allowed).toBe(false);
    }
  });
});
