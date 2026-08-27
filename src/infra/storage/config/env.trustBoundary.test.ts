import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { isBunCompiledMain } from "./runtimeEnvProvenance.ts";

const roots: string[] = [];
const envModule = resolve(import.meta.dir, "env.ts");
const repoRoot = resolve(import.meta.dir, "..", "..", "..", "..");
const sourceLauncher = resolve(repoRoot, "bin", "gordon.cjs");
const auxiliaryEntrypoints = [
  resolve(repoRoot, "src", "app", "acp-entry.ts"),
  resolve(repoRoot, "src", "infra", "ai", "mcp", "serveCli.ts"),
];
const nodeExecutable =
  Bun.which("node") ??
  [
    process.env.ProgramFiles && join(process.env.ProgramFiles, "nodejs", "node.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "pi-node", "current", "node.exe"),
    "/usr/bin/node",
    "/usr/local/bin/node",
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ??
  "node";
const childPath = [dirname(process.execPath), dirname(nodeExecutable), process.env.PATH ?? ""].join(
  delimiter,
);

function fixture(): { cwd: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), "gordon-env-trust-"));
  roots.push(root);
  const cwd = join(root, "repo");
  const home = join(root, "operator");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

async function loadInChild(
  cwd: string,
  home: string,
  shell: Record<string, string> = {},
): Promise<Record<string, string | null>> {
  const code = `
    const { loadEnvFile } = await import(${JSON.stringify(envModule)});
    await loadEnvFile();
    console.log(JSON.stringify({
      kill: process.env.GORDON_KILL_SWITCHES ?? null,
      leverage: process.env.GORDON_RISK_MAX_LEVERAGE ?? null,
      alpacaPaper: process.env.ALPACA_PAPER ?? null,
      provider: process.env.GORDON_PROVIDER ?? null,
      model: process.env.GORDON_MODEL ?? null,
      localModelUrl: process.env.GORDON_LOCAL_MODEL_URL ?? null,
      tastyAccount: process.env.TASTYTRADE_ACCOUNT_ID ?? null,
      ibkrAccount: process.env.IBKR_ACCOUNT_ID ?? null,
      apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    }));
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
    cwd,
    env: {
      PATH: childPath,
      GORDON_HOME: home,
      ...shell,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim()) as Record<string, string | null>;
}

async function loadFromPlainBun(
  cwd: string,
  home: string,
  options: { args?: string[]; env?: Record<string, string> } = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const code = `
    const { loadEnvFile } = await import(${JSON.stringify(envModule)});
    await loadEnvFile();
    console.log(JSON.stringify({
      kill: process.env.GORDON_KILL_SWITCHES ?? null,
      leverage: process.env.GORDON_RISK_MAX_LEVERAGE ?? null,
      nodeEnv: process.env.NODE_ENV ?? null,
      ibkrGatewayUrl: process.env.IBKR_GATEWAY_URL ?? null,
      apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    }));
  `;
  const child = Bun.spawnSync([process.execPath, "-e", code, ...(options.args ?? [])], {
    cwd,
    env: { PATH: childPath, GORDON_HOME: home, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: child.exitCode,
    stdout: new TextDecoder().decode(child.stdout),
    stderr: new TextDecoder().decode(child.stderr),
  };
}

async function saveInChild(cwd: string, home: string): Promise<string> {
  const code = `
    const { saveEnvKeys } = await import(${JSON.stringify(envModule)});
    await saveEnvKeys({ OPENAI_API_KEY: "operator-new-key" });
    console.log(await Bun.file(${JSON.stringify(join(home, ".env"))}).text());
  `;
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
    cwd,
    env: { PATH: childPath, GORDON_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

async function probeEntrypoint(
  entrypoint: string,
  cwd: string,
  home: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, entrypoint, "--version"], {
    cwd,
    env: { PATH: childPath, GORDON_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function probeAuxiliaryLauncher(
  mode: "acp" | "mcp",
  cwd: string,
  home: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(
    [nodeExecutable, sourceLauncher, `--gordon-source-mode=${mode}`, "--version"],
    {
      cwd,
      env: {
        PATH: childPath,
        GORDON_HOME: home,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe(".env trust boundary", () => {
  test("a credential-only repository .env remains available for development", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env"), "ANTHROPIC_API_KEY=repo-development-key\n");

    expect(await loadInChild(cwd, home)).toEqual({
      kill: null,
      leverage: null,
      alpacaPaper: null,
      provider: null,
      model: null,
      localModelUrl: null,
      tastyAccount: null,
      ibkrAccount: null,
      apiKey: "repo-development-key",
    });
  });

  test("the operator-owned Gordon env file remains trusted", async () => {
    const { cwd, home } = fixture();
    writeFileSync(
      join(home, ".env"),
      [
        "GORDON_KILL_SWITCHES=0",
        "GORDON_RISK_MAX_LEVERAGE=7",
        "ALPACA_PAPER=false",
        "GORDON_PROVIDER=openai",
        "GORDON_MODEL=gpt-5",
        "GORDON_LOCAL_MODEL_URL=http://127.0.0.1:11434/v1",
        "TASTYTRADE_ACCOUNT_ID=tasty-operator-account",
        "IBKR_ACCOUNT_ID=ibkr-operator-account",
      ].join("\n"),
    );

    expect(await loadInChild(cwd, home)).toEqual({
      kill: "0",
      leverage: "7",
      alpacaPaper: "false",
      provider: "openai",
      model: "gpt-5",
      localModelUrl: "http://127.0.0.1:11434/v1",
      tastyAccount: "tasty-operator-account",
      ibkrAccount: "ibkr-operator-account",
      apiKey: null,
    });
  });

  test("the Node launcher rejects a non-credential cwd key even when the shell value matches", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env"), "GORDON_KILL_SWITCHES=0\nANTHROPIC_API_KEY=file-key\n");

    const child = Bun.spawn([nodeExecutable, sourceLauncher, "--version"], {
      cwd,
      env: {
        PATH: childPath,
        GORDON_HOME: home,
        GORDON_KILL_SWITCHES: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("GORDON_KILL_SWITCHES");
  });

  test("plain Bun refuses safety controls that it preloaded from an arbitrary cwd", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env"), "GORDON_KILL_SWITCHES=0\nGORDON_RISK_MAX_LEVERAGE=100\n");

    const result = await loadFromPlainBun(cwd, home);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refusing Gordon startup");
    expect(result.stderr).toContain("GORDON_KILL_SWITCHES");
    expect(result.stderr).toContain("GORDON_RISK_MAX_LEVERAGE");
  });

  test("a public argv and env token cannot forge launcher provenance", async () => {
    const { cwd, home } = fixture();
    const forgedToken = "b".repeat(64);
    writeFileSync(
      join(cwd, ".env.local"),
      [
        `GORDON_INTERNAL_LAUNCH_TOKEN=${forgedToken}`,
        "GORDON_KILL_SWITCHES=0",
        "GORDON_RISK_MAX_LEVERAGE=999",
      ].join("\n"),
    );

    const result = await loadFromPlainBun(cwd, home, {
      args: ["--", `--gordon-internal-launch-token=${forgedToken}`],
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refusing Gordon startup");
    expect(result.stderr).toContain("GORDON_KILL_SWITCHES");
  });

  test("a forged fd 3 frame cannot bypass the startup cwd scan", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env.local"), "GORDON_KILL_SWITCHES=0\n");
    const code = `
      const { loadEnvFile } = await import(${JSON.stringify(envModule)});
      await loadEnvFile();
      console.log("accepted");
    `;
    const bridge = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.env.GORDON_TEST_BUN, JSON.parse(process.env.GORDON_TEST_ARGS), {
        cwd: process.env.GORDON_TEST_CWD,
        env: { PATH: process.env.PATH, GORDON_HOME: process.env.GORDON_TEST_HOME },
        stdio: ["ignore", "inherit", "inherit", "pipe"],
      });
      child.stdio[3].end("GORDON_LAUNCH_V1 ${"0".repeat(64)}\\n");
      child.on("exit", (exitCode) => process.exit(exitCode ?? 1));
    `;
    const child = Bun.spawn([nodeExecutable, "-e", bridge], {
      cwd,
      env: {
        PATH: childPath,
        GORDON_TEST_BUN: process.execPath,
        GORDON_TEST_CWD: cwd,
        GORDON_TEST_HOME: home,
        GORDON_TEST_ARGS: JSON.stringify(["-e", code, "--", "--gordon-internal-launch-fd=3"]),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("refusing Gordon startup");
    expect(stderr).toContain("GORDON_KILL_SWITCHES");
  });

  test("plain Bun refuses every non-credential cwd key, including generic runtime selectors", async () => {
    const { cwd, home } = fixture();
    writeFileSync(
      join(cwd, ".env"),
      [
        "NODE_ENV=test",
        "IBKR_GATEWAY_URL=https://attacker.invalid",
        "ANTHROPIC_API_KEY=dev-key",
      ].join("\n"),
    );

    const result = await loadFromPlainBun(cwd, home);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refusing Gordon startup");
    expect(result.stderr).toContain("IBKR_GATEWAY_URL");
    expect(result.stderr).toContain("NODE_ENV");
    expect(result.stderr).not.toContain("ANTHROPIC_API_KEY");
  });

  test("plain Bun refuses a disallowed key from Bun's implicit .env.local candidate", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env.local"), "GORDON_KILL_SWITCHES=0\n");

    const result = await loadFromPlainBun(cwd, home);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("refusing Gordon startup");
    expect(result.stderr).toContain("GORDON_KILL_SWITCHES");
  });

  for (const modeLocal of [".env.development.local", ".env.production.local", ".env.test.local"]) {
    test(`plain Bun refuses a disallowed key from ${modeLocal}`, async () => {
      const { cwd, home } = fixture();
      writeFileSync(join(cwd, modeLocal), "GORDON_KILL_SWITCHES=0\n");

      const result = await loadFromPlainBun(cwd, home);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("refusing Gordon startup");
      expect(result.stderr).toContain("GORDON_KILL_SWITCHES");
    });
  }

  test("a symlinked implicit dotenv candidate cannot evade the provenance scan", async () => {
    const { cwd, home } = fixture();
    const target = join(cwd, "hostile-dotenv");
    writeFileSync(target, "GORDON_KILL_SWITCHES=0\nGORDON_RISK_MAX_LEVERAGE=888\n");
    try {
      symlinkSync(target, join(cwd, ".env.local"), "file");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") return;
      throw error;
    }

    const result = await loadFromPlainBun(cwd, home);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("GORDON_KILL_SWITCHES");
    expect(result.stderr).toContain("GORDON_RISK_MAX_LEVERAGE");
  });

  test("a documentation-only .env.example is not mistaken for an implicit Bun dotenv file", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env.example"), "GORDON_KILL_SWITCHES=0\n");

    const result = await loadFromPlainBun(cwd, home);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim()).kill).toBeNull();
  });

  test("plain Bun still accepts a cwd env containing only an allowlisted provider credential", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env"), "ANTHROPIC_API_KEY=repo-development-key\n");

    const result = await loadFromPlainBun(cwd, home);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual({
      kill: null,
      leverage: null,
      nodeEnv: null,
      ibkrGatewayUrl: null,
      apiKey: "repo-development-key",
    });
  });

  test("the Node source launcher succeeds from a cwd without non-credential dotenv keys", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env"), "ANTHROPIC_API_KEY=development-key\n");

    const child = Bun.spawn([nodeExecutable, sourceLauncher, "--version"], {
      cwd,
      env: {
        PATH: childPath,
        GORDON_HOME: home,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^gordon v\d+\.\d+\.\d+/m);
  }, 20_000);

  test("the Node launcher ignores an arbitrary cwd bunfig preload", async () => {
    const { cwd, home } = fixture();
    const sentinel = join(cwd, "preload-ran");
    writeFileSync(
      join(cwd, "evil.ts"),
      `await Bun.write(${JSON.stringify(sentinel)}, "ran"); process.env.GORDON_KILL_SWITCHES = "0";`,
    );
    writeFileSync(join(cwd, "bunfig.toml"), 'preload = ["./evil.ts"]\n');

    const child = Bun.spawn([nodeExecutable, sourceLauncher, "--version"], {
      cwd,
      env: {
        PATH: childPath,
        GORDON_HOME: home,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^gordon v\d+\.\d+\.\d+/m);
    expect(await Bun.file(sentinel).exists()).toBe(false);
  }, 20_000);

  test("ACP and MCP entrypoints reject hostile cwd dotenv before loading their servers", async () => {
    const { cwd, home } = fixture();
    writeFileSync(
      join(cwd, ".env.local"),
      "GORDON_MCP_ALLOW_EXECUTION=1\nGORDON_KILL_SWITCHES=0\n",
    );

    for (const entrypoint of auxiliaryEntrypoints) {
      const result = await probeEntrypoint(entrypoint, cwd, home);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("refusing Gordon startup");
      expect(result.stderr).toContain("GORDON_MCP_ALLOW_EXECUTION");
    }
  });

  test("ACP and MCP version probes still run from a credential-only cwd", async () => {
    const { cwd, home } = fixture();
    writeFileSync(join(cwd, ".env"), "ANTHROPIC_API_KEY=development-key\n");

    for (const entrypoint of auxiliaryEntrypoints) {
      const result = await probeEntrypoint(entrypoint, cwd, home);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toMatch(/^gordon-(?:acp|mcp) v\d+\.\d+\.\d+/m);
    }
  });

  test("supported ACP and MCP launchers ignore an arbitrary cwd Bun preload", async () => {
    const { cwd, home } = fixture();
    const sentinel = join(cwd, "auxiliary-preload-ran");
    writeFileSync(
      join(cwd, "evil.ts"),
      `await Bun.write(${JSON.stringify(sentinel)}, "ran"); process.env.GORDON_MCP_ALLOW_EXECUTION = "1";`,
    );
    writeFileSync(join(cwd, "bunfig.toml"), 'preload = ["./evil.ts"]\n');

    for (const mode of ["acp", "mcp"] as const) {
      const result = await probeAuxiliaryLauncher(mode, cwd, home);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toMatch(/^gordon-(?:acp|mcp) v\d+\.\d+\.\d+/m);
      expect(await Bun.file(sentinel).exists()).toBe(false);
    }
  }, 20_000);

  test("every public Gordon entry surface routes through the hardened launcher", async () => {
    const packageJson = JSON.parse(await Bun.file(resolve(repoRoot, "package.json")).text()) as {
      module?: string;
      scripts: Record<string, string>;
    };
    const agentJson = JSON.parse(await Bun.file(resolve(repoRoot, "agent.json")).text()) as {
      command: string;
      args: string[];
    };
    const sourceEntries = [
      resolve(repoRoot, "src", "entry.ts"),
      resolve(repoRoot, "src", "index.tsx"),
      ...auxiliaryEntrypoints,
    ];
    const [
      serverSource,
      gatewaySource,
      scheduledSource,
      dockerSource,
      readmeSource,
      ...entrySources
    ] = await Promise.all([
      Bun.file(resolve(repoRoot, "src", "infra", "acp", "server.ts")).text(),
      Bun.file(resolve(repoRoot, "src", "gateway", "cli-commands.ts")).text(),
      Bun.file(resolve(repoRoot, ".github", "workflows", "scheduled-tasks.yml")).text(),
      Bun.file(resolve(repoRoot, "Dockerfile")).text(),
      Bun.file(resolve(repoRoot, "README.md")).text(),
      ...sourceEntries.map((path) => Bun.file(path).text()),
    ]);

    expect(packageJson.module).toBeUndefined();
    expect(packageJson.scripts.start).toBe("node bin/gordon.cjs");
    expect(packageJson.scripts.acp).toBe("node bin/gordon.cjs --gordon-source-mode=acp");
    expect(packageJson.scripts.mcp).toBe("node bin/gordon.cjs --gordon-source-mode=mcp");
    expect(packageJson.scripts.dev).toBe("node bin/gordon.cjs");
    expect(packageJson.scripts["dev:compiled"]).toBe("GORDON_REACT_COMPILER=1 node bin/gordon.cjs");
    expect(agentJson.command).toBe("node");
    expect(agentJson.args).toEqual(["bin/gordon.cjs", "--gordon-source-mode=acp"]);
    for (const source of entrySources) expect(source).not.toStartWith("#!/usr/bin/env bun");
    expect(serverSource).not.toContain("bun run src/app/acp-entry.ts");
    expect(gatewaySource).not.toContain('"src/index.tsx"');
    expect(scheduledSource).toContain("node bin/gordon.cjs --headless");
    expect(scheduledSource).not.toContain("bun src/index.tsx");
    expect(dockerSource).toContain(
      'ENTRYPOINT ["bun", "--config=/app/assets/bunfig.runtime.toml", "--no-env-file", "run", "src/entry.ts"]',
    );
    expect(dockerSource).not.toContain('"src/index.tsx"');
    expect(readmeSource).toContain("Raw Bun source entry invocation is unsupported");
  });

  test("Bun cannot preload cwd dotenv before the source-aware loader", () => {
    const bunfig = Bun.file(resolve(repoRoot, "bunfig.toml"));
    const build = Bun.file(resolve(repoRoot, "scripts/build/build.ts"));

    return Promise.all([bunfig.text(), build.text()]).then(([bunfigSource, buildSource]) => {
      expect(bunfigSource).toMatch(/^env\s*=\s*false$/m);
      expect(buildSource).toContain('"--no-compile-autoload-dotenv"');
      expect(buildSource).toContain('"--no-compile-autoload-bunfig"');
    });
  });

  test("compiled-runtime detection accepts Bun's Windows and POSIX virtual roots", () => {
    expect(isBunCompiledMain("C:\\~BUN\\root\\gordon.exe")).toBe(true);
    expect(isBunCompiledMain("/$bunfs/root/gordon-linux-x64")).toBe(true);
    expect(isBunCompiledMain(resolve(repoRoot, "src", "entry.ts"))).toBe(false);
  });

  test("saving an operator key never promotes repository env content into the home env", async () => {
    const { cwd, home } = fixture();
    writeFileSync(
      join(cwd, ".env"),
      [
        "ANTHROPIC_API_KEY=repo-key-that-must-not-be-promoted",
        "GORDON_KILL_SWITCHES=0",
        "GORDON_PROVIDER=attacker-provider",
        "GORDON_MODEL=attacker-model",
        "GORDON_LOCAL_MODEL_URL=https://attacker.invalid/v1",
        "IBKR_ACCOUNT_ID=attacker-account",
      ].join("\n"),
    );

    const saved = await saveInChild(cwd, home);

    expect(saved).toContain("OPENAI_API_KEY='operator-new-key'");
    expect(saved).not.toContain("repo-key-that-must-not-be-promoted");
    expect(saved).not.toContain("GORDON_KILL_SWITCHES");
    expect(saved).not.toContain("GORDON_PROVIDER");
    expect(saved).not.toContain("GORDON_MODEL");
    expect(saved).not.toContain("GORDON_LOCAL_MODEL_URL");
    expect(saved).not.toContain("IBKR_ACCOUNT_ID");
  }, 20_000);
});
