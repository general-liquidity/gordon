import { describe, expect, test, afterEach } from "bun:test";
import os from "node:os";
import path from "node:path";
import {
  isSandboxEnabled,
  wrapSandboxed,
  __setDetectOverrideForTesting,
  type SandboxDetection,
} from "./subprocessSandbox.ts";

const ENV_KEY = "GORDON_SANDBOX_SUBPROCESS";

function setEnabled(on: boolean): void {
  if (on) process.env[ENV_KEY] = "1";
  else delete process.env[ENV_KEY];
}

const bwrap: SandboxDetection = { kind: "bwrap", available: true };
const seatbelt: SandboxDetection = { kind: "sandbox-exec", available: true };
const none: SandboxDetection = { kind: "none", available: false };

afterEach(() => {
  setEnabled(false);
  __setDetectOverrideForTesting(null);
});

describe("subprocessSandbox", () => {
  test("default OFF — passthrough is unchanged (byte-identical)", () => {
    setEnabled(false);
    // Even if a sandbox were available, disabled must short-circuit before detect.
    __setDetectOverrideForTesting(() => bwrap);

    const cmd = "npx";
    const args = ["-y", "@modelcontextprotocol/server-everything"];
    const out = wrapSandboxed(cmd, args, { allowNetwork: true });

    expect(out.command).toBe(cmd);
    expect(out.args).toEqual(args);
    expect(isSandboxEnabled()).toBe(false);
  });

  test("enabled + bwrap available — wraps with expected argv, includes --unshare-net when network denied", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => bwrap);

    const out = wrapSandboxed("python3", ["server.py"], {
      writableRoots: ["/work/tmp"],
      allowNetwork: false,
    });

    expect(out.command).toBe("bwrap");
    expect(out.args).toContain("--ro-bind");
    expect(out.args).toContain("--die-with-parent");
    expect(out.args).toContain("--unshare-net");
    // writable root bind-mounted r/w
    const bindIdx = out.args.indexOf("--bind");
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(out.args[bindIdx + 1]).toBe("/work/tmp");
    expect(out.args[bindIdx + 2]).toBe("/work/tmp");
    // child command + args after the `--` separator
    const sep = out.args.indexOf("--");
    expect(sep).toBeGreaterThanOrEqual(0);
    expect(out.args.slice(sep + 1)).toEqual(["python3", "server.py"]);
  });

  test("enabled + bwrap + network allowed — no --unshare-net", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => bwrap);

    const out = wrapSandboxed("npx", ["mcp-server"], { allowNetwork: true });

    expect(out.command).toBe("bwrap");
    expect(out.args).not.toContain("--unshare-net");
    const sep = out.args.indexOf("--");
    expect(out.args.slice(sep + 1)).toEqual(["npx", "mcp-server"]);
  });

  test("enabled + sandbox-exec available — wraps with -p profile and deny default", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => seatbelt);

    const out = wrapSandboxed("node", ["index.js"], {
      writableRoots: ["/tmp/work"],
      allowNetwork: false,
    });

    expect(out.command).toBe("sandbox-exec");
    expect(out.args[0]).toBe("-p");
    const profile = out.args[1]!;
    expect(profile).toContain("(version 1)");
    expect(profile).toContain("(deny default)");
    expect(profile).toContain('(allow file-write* (subpath "/tmp/work"))');
    expect(profile).not.toContain("(allow network*)");
    // child command + args trail the profile
    expect(out.args.slice(2)).toEqual(["node", "index.js"]);
  });

  test("enabled + sandbox-exec + network allowed — profile permits network", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => seatbelt);

    const out = wrapSandboxed("node", ["index.js"], { allowNetwork: true });
    const profile = out.args[1]!;
    expect(profile).toContain("(allow network*)");
  });

  test("enabled but UNAVAILABLE — passthrough, no throw", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => none);

    const cmd = "uvx";
    const args = ["some-mcp"];
    let out: { command: string; args: string[] } | undefined;
    expect(() => {
      out = wrapSandboxed(cmd, args, { allowNetwork: true });
    }).not.toThrow();

    expect(out!.command).toBe(cmd);
    expect(out!.args).toEqual(args);
  });

  test("default writable roots include tmp + cwd and EXCLUDE home root", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => bwrap);

    // No writableRoots supplied → default to tmp + cwd.
    const out = wrapSandboxed("npx", ["mcp-server"], { allowNetwork: true });

    const tmp = path.resolve(os.tmpdir());
    const cwd = path.resolve(process.cwd());
    const home = path.resolve(os.homedir());
    const fsRoot = path.parse(home).root;

    // Collect every `--bind SRC DEST` triple.
    const boundRoots: string[] = [];
    for (let i = 0; i < out.args.length; i++) {
      if (out.args[i] === "--bind") boundRoots.push(out.args[i + 1]!);
    }

    expect(boundRoots).toContain(tmp);
    expect(boundRoots).toContain(cwd);
    // Home root and `/` must never be writable.
    expect(boundRoots).not.toContain(home);
    expect(boundRoots).not.toContain(fsRoot);
  });

  test("caller-supplied writable roots are filtered — home root + `/` dropped", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => bwrap);

    const home = path.resolve(os.homedir());
    const fsRoot = path.parse(home).root;

    const out = wrapSandboxed("node", ["s.js"], {
      writableRoots: [home, fsRoot],
      allowNetwork: true,
    });

    const boundRoots: string[] = [];
    for (let i = 0; i < out.args.length; i++) {
      if (out.args[i] === "--bind") boundRoots.push(out.args[i + 1]!);
    }
    // Both dangerous roots filtered → falls back to the safe default (tmp + cwd).
    expect(boundRoots).not.toContain(home);
    expect(boundRoots).not.toContain(fsRoot);
    expect(boundRoots).toContain(path.resolve(os.tmpdir()));
    expect(boundRoots).toContain(path.resolve(process.cwd()));
  });

  test("bwrap argv: --ro-bind / / present, --bind per writable root, --unshare-net only when network denied", () => {
    setEnabled(true);
    __setDetectOverrideForTesting(() => bwrap);

    // Network DENIED → expect --unshare-net.
    const denied = wrapSandboxed("python3", ["s.py"], { allowNetwork: false });
    // --ro-bind / / read-only root so the child can still READ node_modules etc.
    const roIdx = denied.args.indexOf("--ro-bind");
    expect(roIdx).toBeGreaterThanOrEqual(0);
    expect(denied.args[roIdx + 1]).toBe("/");
    expect(denied.args[roIdx + 2]).toBe("/");
    expect(denied.args).toContain("--unshare-net");

    // Network ALLOWED (the MCP default) → no --unshare-net.
    const allowed = wrapSandboxed("python3", ["s.py"], { allowNetwork: true });
    expect(allowed.args).toContain("--ro-bind");
    expect(allowed.args).not.toContain("--unshare-net");
  });

  test("isSandboxEnabled honors truthy values", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE"]) {
      process.env[ENV_KEY] = v;
      expect(isSandboxEnabled()).toBe(true);
    }
    for (const v of ["0", "false", "no", "off", ""]) {
      process.env[ENV_KEY] = v;
      expect(isSandboxEnabled()).toBe(false);
    }
    delete process.env[ENV_KEY];
    expect(isSandboxEnabled()).toBe(false);
  });
});
