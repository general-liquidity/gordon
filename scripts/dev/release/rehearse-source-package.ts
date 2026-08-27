import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import { assertGordonVersionOutput } from "./release-matrix.ts";

const root = resolve(import.meta.dir, "..", "..", "..");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version as string;
const fixture = mkdtempSync(join(tmpdir(), "gordon-packed-source-"));
const packDir = resolve(fixture, "pack");
const hostileCwd = resolve(fixture, "hostile-cwd");
const childEnv = { ...process.env };
const pathKey = Object.keys(childEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
childEnv[pathKey] = `${dirname(process.execPath)}${delimiter}${childEnv[pathKey] ?? ""}`;

function run(command: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const child = Bun.spawnSync(command, {
    cwd,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: child.exitCode,
    stdout: new TextDecoder().decode(child.stdout),
    stderr: new TextDecoder().decode(child.stderr),
  };
}

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(hostileCwd, { recursive: true });
  const npmPackArgs = ["npm", "pack", "--ignore-scripts", "--pack-destination", packDir, "--json"];
  const packed = run(
    process.platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", ...npmPackArgs] : npmPackArgs,
    root,
  );
  if (packed.exitCode !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
  const manifest = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  const archive = resolve(packDir, manifest[0]?.filename ?? "");
  if (!existsSync(archive)) throw new Error("npm pack did not produce its reported archive");
  const extracted = run(["tar", "-xzf", archive, "-C", packDir], root);
  if (extracted.exitCode !== 0) throw new Error(`tar extraction failed: ${extracted.stderr}`);

  const packageRoot = resolve(packDir, "package");
  const launcher = resolve(packageRoot, "bin", "gordon.cjs");
  for (const postinstallPath of [
    "scripts/patches/patch-mastra.cjs",
    "scripts/patches/patch-ink.cjs",
  ]) {
    if (!existsSync(resolve(packageRoot, postinstallPath))) {
      throw new Error(`packed package is missing postinstall input ${postinstallPath}`);
    }
  }
  const sentinel = resolve(hostileCwd, "preload-ran");
  writeFileSync(
    resolve(hostileCwd, "evil.ts"),
    `await Bun.write(${JSON.stringify(sentinel)}, "ran"); process.env.GORDON_KILL_SWITCHES = "0";`,
  );
  writeFileSync(resolve(hostileCwd, "bunfig.toml"), 'preload = ["./evil.ts"]\n');

  for (const probe of [
    { args: ["--version"], prefix: "gordon" },
    { args: ["--gordon-source-mode=acp", "--version"], prefix: "gordon-acp" },
    { args: ["--gordon-source-mode=mcp", "--version"], prefix: "gordon-mcp" },
  ]) {
    const result = run(["node", launcher, ...probe.args], hostileCwd);
    if (result.exitCode !== 0 || result.stderr !== "") {
      throw new Error(
        `${probe.prefix} packed launch failed (${result.exitCode}): ${result.stderr.trim()}`,
      );
    }
    assertGordonVersionOutput(result.stdout.replace(`${probe.prefix} v`, "gordon v"), version);
    if (existsSync(sentinel)) throw new Error(`${probe.prefix} executed hostile cwd Bun preload`);
  }

  console.log(`Packed source artifact smoke passed for main, ACP and MCP at ${version}.`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
