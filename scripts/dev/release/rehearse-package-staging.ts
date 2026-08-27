import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { assertGordonVersionOutput, deriveReleaseBinaryTargets } from "./release-matrix.ts";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback);
}

const binariesDir = argument("--binaries", resolve(repoRoot, ".release-rehearsal", "binaries"));
const outputRoot = argument("--output", resolve(repoRoot, ".release-rehearsal", "package-staging"));
const version = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version;
const expected = deriveReleaseBinaryTargets(resolve(repoRoot, ".github/workflows/release.yml"));
const stagingDir = resolve(outputRoot, "staging");
const manifestPath = resolve(stagingDir, "manifest.json");
const skipHostSmoke = process.argv.includes("--skip-host-smoke");

for (const relative of ["Formula/gordon.rb", "scripts/scoop/gordon.json"]) {
  const destination = resolve(outputRoot, relative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(repoRoot, relative), destination);
}

function run(script: string, args: string[]): void {
  const child = Bun.spawnSync([process.execPath, resolve(repoRoot, script), ...args], {
    cwd: repoRoot,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (child.exitCode !== 0) process.exit(child.exitCode);
}

run("scripts/npm/stage-platform-packages.cjs", [
  "--binaries",
  binariesDir,
  "--out",
  stagingDir,
  "--version",
  version,
  "--manifest",
  manifestPath,
]);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  staged: Array<{ asset: string }>;
  skipped: string[];
};
const expectedAssets = expected.map((target) => target.binaryName).sort();
const actualAssets = manifest.staged.map((entry) => entry.asset).sort();
if (
  manifest.skipped.length !== 0 ||
  JSON.stringify(actualAssets) !== JSON.stringify(expectedAssets)
) {
  throw new Error(
    `Release staging did not consume the exact ${expected.length}-binary matrix: ` +
      `staged=${actualAssets.join(",")} skipped=${manifest.skipped.join(",")}`,
  );
}

if (!skipHostSmoke) {
  const hostName =
    process.platform === "win32"
      ? `windows-${process.arch}`
      : `${process.platform}-${process.arch}`;
  const host = expected.find((target) => target.name === hostName);
  if (!host) throw new Error(`Release matrix has no executable host target for ${hostName}`);
  const hostileCwd = mkdtempSync(resolve(tmpdir(), "gordon-compiled-smoke-"));
  try {
    // A compiled release disables Bun's dotenv and bunfig autoload. Exercise
    // both from a hostile cwd: either one runs before Gordon source and cannot
    // be repaired by the runtime provenance check.
    const preloadSentinel = resolve(hostileCwd, "preload-ran");
    writeFileSync(
      resolve(hostileCwd, "evil.ts"),
      `await Bun.write(${JSON.stringify(preloadSentinel)}, "ran"); process.env.GORDON_KILL_SWITCHES = "0";`,
      "utf8",
    );
    writeFileSync(resolve(hostileCwd, "bunfig.toml"), 'preload = ["./evil.ts"]\n', "utf8");
    writeFileSync(
      resolve(hostileCwd, ".env.local"),
      "GORDON_KILL_SWITCHES=0\nGORDON_RISK_MAX_LEVERAGE=999\n",
      "utf8",
    );
    const smoke = Bun.spawnSync([resolve(binariesDir, host.binaryName), "--version"], {
      cwd: hostileCwd,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (smoke.exitCode !== 0) {
      throw new Error(
        `Host release binary ${host.binaryName} --version failed (${smoke.exitCode}): ` +
          new TextDecoder().decode(smoke.stderr).trim(),
      );
    }
    assertGordonVersionOutput(new TextDecoder().decode(smoke.stdout), version);
    if (existsSync(preloadSentinel)) {
      throw new Error(`Host release binary ${host.binaryName} executed a hostile cwd Bun preload`);
    }
  } finally {
    rmSync(hostileCwd, { recursive: true, force: true });
  }
}

run("scripts/npm/apply-release-hashes.cjs", [
  "--manifest",
  manifestPath,
  "--version",
  version,
  "--output-root",
  outputRoot,
]);

const checksumLines = readFileSync(resolve(outputRoot, "scripts/SHA256SUMS"), "utf8")
  .split("\n")
  .filter((line) => /^[0-9a-f]{64} {2}/.test(line));
if (checksumLines.length !== expected.length) {
  throw new Error(`Expected ${expected.length} release checksums, found ${checksumLines.length}`);
}

console.log(
  `Rehearsed ${manifest.staged.length} platform packages and ${checksumLines.length} release hashes without publishing.`,
);
