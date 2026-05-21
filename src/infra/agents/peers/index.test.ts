import { describe, it, expect } from "bun:test";
import { EventEmitter } from "node:events";
import {
  CliSubprocessPeer,
  isPeerDelegationEnabled,
  listPeers,
  getPeer,
  peerResultToPayload,
  PEER_DELEGATION_FLAG_ENV,
  PEER_REGISTRY,
  type CliSubprocessPeerConfig,
} from "./index.ts";

describe("isPeerDelegationEnabled", () => {
  it("defaults to true when flag is unset", () => {
    expect(isPeerDelegationEnabled({})).toBe(true);
  });
  it("returns false when explicitly disabled", () => {
    expect(isPeerDelegationEnabled({ [PEER_DELEGATION_FLAG_ENV]: "0" })).toBe(false);
    expect(isPeerDelegationEnabled({ [PEER_DELEGATION_FLAG_ENV]: "false" })).toBe(false);
  });
});

// -------------------- Fake child process for subprocess tests --------------------

class FakeChild extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { on: EventEmitter["on"] };
  stderr = new EventEmitter() as EventEmitter & { on: EventEmitter["on"] };
  stdinWrites: string[] = [];
  stdin = {
    write: (s: string) => {
      this.stdinWrites.push(s);
      return true;
    },
    end: () => {},
  };
  killed = false;
  killSignal: NodeJS.Signals | null = null;
  kill(signal?: NodeJS.Signals) {
    this.killed = true;
    this.killSignal = signal ?? "SIGTERM";
    return true;
  }
}

interface FakeSpawnCall {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

function makeFakeSpawn(
  scripts: ((child: FakeChild, call: FakeSpawnCall) => void)[],
) {
  const calls: FakeSpawnCall[] = [];
  let n = 0;
  const fn = ((cmd: string, args: readonly string[] = [], opts: { cwd?: string; env?: Record<string, string> } = {}) => {
    const child = new FakeChild();
    const call: FakeSpawnCall = {
      command: cmd,
      args: [...args],
      cwd: opts.cwd,
      env: opts.env,
    };
    calls.push(call);
    const script = scripts[n++];
    if (script) {
      // Run the script asynchronously so the caller can attach listeners first
      setTimeout(() => script(child, call), 0);
    }
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { fn, calls };
}

const baseConfig: CliSubprocessPeerConfig = {
  id: "test_peer",
  description: "test",
  command: "test-bin",
  args: ["run"],
  promptMode: "flag-then-value",
  promptFlag: "-p",
  defaultTimeoutMs: 5000,
};

// -------------------- happy path --------------------

describe("CliSubprocessPeer — successful delegation", () => {
  it("captures stdout and reports success on exit 0", async () => {
    const spawn = makeFakeSpawn([
      (child) => {
        child.stdout.emit("data", Buffer.from("hello "));
        child.stdout.emit("data", Buffer.from("world"));
        child.emit("close", 0);
      },
    ]);
    const peer = new CliSubprocessPeer(baseConfig, spawn.fn);
    const r = await peer.delegate("do thing");
    expect(r.success).toBe(true);
    expect(r.output).toBe("hello world");
    expect(r.exitCode).toBe(0);
    expect(r.error).toBeUndefined();
  });

  it("passes the prompt via flag-then-value mode", async () => {
    const spawn = makeFakeSpawn([
      (child) => {
        child.emit("close", 0);
      },
    ]);
    const peer = new CliSubprocessPeer(baseConfig, spawn.fn);
    await peer.delegate("refactor this");
    expect(spawn.calls[0]!.command).toBe("test-bin");
    expect(spawn.calls[0]!.args).toEqual(["run", "-p", "refactor this"]);
  });

  it("captures stderr separately from stdout", async () => {
    const spawn = makeFakeSpawn([
      (child) => {
        child.stdout.emit("data", Buffer.from("ok"));
        child.stderr.emit("data", Buffer.from("warning: deprecation"));
        child.emit("close", 0);
      },
    ]);
    const peer = new CliSubprocessPeer(baseConfig, spawn.fn);
    const r = await peer.delegate("do");
    expect(r.output).toBe("ok");
    expect(r.stderr).toBe("warning: deprecation");
    expect(r.success).toBe(true);
  });
});

// -------------------- failure paths --------------------

describe("CliSubprocessPeer — failure modes", () => {
  it("reports exit_nonzero on non-zero exit", async () => {
    const spawn = makeFakeSpawn([
      (child) => {
        child.stderr.emit("data", Buffer.from("auth failed: no api key"));
        child.emit("close", 2);
      },
    ]);
    const peer = new CliSubprocessPeer(baseConfig, spawn.fn);
    const r = await peer.delegate("do");
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.error).toBe("exit_nonzero");
    expect(r.errorDetail).toContain("auth failed");
  });

  it("reports spawn_error when child emits error", async () => {
    const spawn = makeFakeSpawn([
      (child) => {
        child.emit("error", new Error("ENOENT: cursor-agent not found"));
      },
    ]);
    const peer = new CliSubprocessPeer(baseConfig, spawn.fn);
    const r = await peer.delegate("do");
    expect(r.success).toBe(false);
    expect(r.error).toBe("spawn_error");
    expect(r.errorDetail).toContain("ENOENT");
  });

  it("reports spawn_error when spawn throws synchronously", async () => {
    const fn = (() => {
      throw new Error("cannot spawn");
    }) as unknown as typeof import("node:child_process").spawn;
    const peer = new CliSubprocessPeer(baseConfig, fn);
    const r = await peer.delegate("do");
    expect(r.success).toBe(false);
    expect(r.error).toBe("spawn_error");
    expect(r.errorDetail).toContain("cannot spawn");
  });

  it("times out and kills the child", async () => {
    const spawn = makeFakeSpawn([
      (_child) => {
        // never emit close — wait for timeout
      },
    ]);
    const peer = new CliSubprocessPeer(
      { ...baseConfig, defaultTimeoutMs: 30 },
      spawn.fn,
    );
    const r = await peer.delegate("do");
    expect(r.success).toBe(false);
    expect(r.error).toBe("timeout");
    expect(r.errorDetail).toContain("30ms");
  });

  it("rejects empty prompt without spawning", async () => {
    const spawn = makeFakeSpawn([]);
    const peer = new CliSubprocessPeer(baseConfig, spawn.fn);
    const r = await peer.delegate("");
    expect(r.success).toBe(false);
    expect(r.error).toBe("spawn_error");
    expect(r.errorDetail).toBe("empty prompt");
    expect(spawn.calls.length).toBe(0);
  });

  it("honors AbortSignal", async () => {
    const spawn = makeFakeSpawn([
      (_child) => {
        // never emit close
      },
    ]);
    const peer = new CliSubprocessPeer(baseConfig, spawn.fn);
    const controller = new AbortController();
    const promise = peer.delegate("do", { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const r = await promise;
    expect(r.success).toBe(false);
    expect(r.error).toBe("aborted");
  });
});

// -------------------- config + options --------------------

describe("CliSubprocessPeer — config", () => {
  it("throws if promptMode=flag-then-value without promptFlag", () => {
    expect(
      () =>
        new CliSubprocessPeer({
          ...baseConfig,
          promptFlag: undefined,
        }),
    ).toThrow();
  });

  it("layers env: process.env → defaultEnv → opts.env", async () => {
    const spawn = makeFakeSpawn([
      (child) => {
        child.emit("close", 0);
      },
    ]);
    const peer = new CliSubprocessPeer(
      {
        ...baseConfig,
        defaultEnv: { FOO: "default", BAR: "default" },
      },
      spawn.fn,
    );
    await peer.delegate("do", { env: { BAR: "override", BAZ: "extra" } });
    const env = spawn.calls[0]!.env!;
    expect(env.FOO).toBe("default");
    expect(env.BAR).toBe("override");
    expect(env.BAZ).toBe("extra");
  });

  it("honors opts.workdir override", async () => {
    const spawn = makeFakeSpawn([
      (child) => {
        child.emit("close", 0);
      },
    ]);
    const peer = new CliSubprocessPeer(
      { ...baseConfig, defaultWorkdir: "/tmp/default" },
      spawn.fn,
    );
    await peer.delegate("do", { workdir: "/tmp/override" });
    expect(spawn.calls[0]!.cwd).toBe("/tmp/override");
  });

  it("supports stdin promptMode", async () => {
    const children: FakeChild[] = [];
    const spawn = makeFakeSpawn([
      (child) => {
        children.push(child);
        setTimeout(() => child.emit("close", 0), 5);
      },
    ]);
    const peer = new CliSubprocessPeer(
      {
        ...baseConfig,
        promptMode: "stdin",
        promptFlag: undefined,
      } as CliSubprocessPeerConfig,
      spawn.fn,
    );
    await peer.delegate("via stdin");
    expect(children[0]!.stdinWrites).toEqual(["via stdin"]);
    // Args should NOT include the prompt
    expect(spawn.calls[0]!.args).toEqual(["run"]);
  });
});

// -------------------- registry --------------------

describe("PEER_REGISTRY", () => {
  it("ships cursor and warp as built-in peers", () => {
    expect(getPeer("cursor")).toBeDefined();
    expect(getPeer("warp")).toBeDefined();
  });

  it("listPeers returns all registered peers", () => {
    const all = listPeers();
    const ids = all.map((p) => p.id).sort();
    expect(ids).toContain("cursor");
    expect(ids).toContain("warp");
  });

  it("getPeer returns undefined for unknown peer", () => {
    expect(getPeer("not_a_peer")).toBeUndefined();
  });

  it("cursor peer spawns cursor-agent with -p flag", () => {
    const peer = PEER_REGISTRY.cursor as CliSubprocessPeer;
    expect(peer.id).toBe("cursor");
    // Description should mention the canonical command
    expect(peer.description).toContain("cursor-agent");
  });

  it("warp peer spawns oz agent run with --prompt flag", () => {
    const peer = PEER_REGISTRY.warp as CliSubprocessPeer;
    expect(peer.id).toBe("warp");
    expect(peer.description.toLowerCase()).toContain("oz");
  });
});

// -------------------- payload --------------------

describe("peerResultToPayload", () => {
  it("emits structured payload with byte counts not raw content", () => {
    const payload = peerResultToPayload({
      success: true,
      output: "hello world",
      stderr: "warn",
      exitCode: 0,
      durationMs: 42,
    }) as { kind: string; outputBytes: number; stderrBytes: number; success: boolean };
    expect(payload.kind).toBe("peer_delegation.result");
    expect(payload.outputBytes).toBe(11);
    expect(payload.stderrBytes).toBe(4);
    expect(payload.success).toBe(true);
    // Output not in payload
    expect((payload as Record<string, unknown>).output).toBeUndefined();
  });

  it("encodes error fields when present", () => {
    const payload = peerResultToPayload({
      success: false,
      output: "",
      stderr: "boom",
      exitCode: 1,
      durationMs: 10,
      error: "exit_nonzero",
      errorDetail: "boom",
    }) as { error: string | null; errorDetail: string | null };
    expect(payload.error).toBe("exit_nonzero");
    expect(payload.errorDetail).toBe("boom");
  });

  it("nullifies missing error fields", () => {
    const payload = peerResultToPayload({
      success: true,
      output: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
    }) as { error: string | null; errorDetail: string | null };
    expect(payload.error).toBeNull();
    expect(payload.errorDetail).toBeNull();
  });
});
