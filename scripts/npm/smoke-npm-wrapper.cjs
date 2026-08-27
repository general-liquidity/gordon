const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDirectory = path.resolve(__dirname, "..", "..");
const wrapperDirectory = path.join(rootDirectory, "npm");
const cacheDirectory = path.join(rootDirectory, ".npm-cache");
const smokeDirectory = path.join(rootDirectory, ".package-smoke");
const stagingDirectory = path.join(rootDirectory, ".package-smoke-staging");
const dummyBinariesDirectory = path.join(rootDirectory, ".package-smoke-binaries");
const npmExecPath = process.env.npm_execpath;
// Prefer running npm's cli.js through the current node so this works whether
// invoked via `npm run smoke:npm-wrapper` (npm_execpath set) or directly via
// `node scripts/npm/smoke-npm-wrapper.cjs`. Spawning `npm.cmd` without a shell
// throws EINVAL on modern Node for Windows, so fall back to shell only if no
// cli.js is locatable.
const bundledNpmCli = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
function npmInvocation(args) {
  // `npm_execpath` is not guaranteed to be npm's JavaScript CLI. `bun run`
  // sets it to bun.exe, and passing that executable as a script argument to
  // Bun makes the runtime parse the PE binary as JavaScript. Only use the
  // current runtime when the value is an actual JS entry point.
  if (npmExecPath && /\.(?:c|m)?js$/i.test(npmExecPath)) {
    return { command: process.execPath, argv: [npmExecPath, ...args], shell: false };
  }
  if (fs.existsSync(bundledNpmCli))
    return { command: process.execPath, argv: [bundledNpmCli, ...args], shell: false };
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    argv: args,
    shell: process.platform === "win32",
  };
}

// Host target + asset name — mirrors npm/bin/gordon.cjs computeTarget() and the
// staging table. Duplicated (small) rather than shared to keep the launcher a
// dependency-free single file.
function hostTarget() {
  const { platform, arch } = process;
  if (platform === "linux") {
    let musl = false;
    if (fs.existsSync("/etc/alpine-release")) musl = true;
    return `linux-${arch}${musl ? "-musl" : ""}`;
  }
  if (platform === "darwin") return `darwin-${arch}`;
  if (platform === "win32") return `win32-${arch}`;
  return `${platform}-${arch}`;
}

function hostAssetName() {
  const { platform, arch } = process;
  if (platform === "win32") return `gordon-windows-${arch}.exe`;
  if (platform === "linux") {
    const musl = fs.existsSync("/etc/alpine-release") ? "-musl" : "";
    return `gordon-linux-${arch}${musl}`;
  }
  return `gordon-${platform}-${arch}`;
}

function runNode(scriptPath, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDirectory,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNpm(args, options = {}) {
  const { command, argv, shell } = npmInvocation(args);
  const result = spawnSync(command, argv, {
    cwd: options.cwd || rootDirectory,
    env: options.env || process.env,
    stdio: "inherit",
    shell,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function latestTarball(directory) {
  const tarballs = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".tgz"))
    .sort(
      (left, right) =>
        fs.statSync(path.join(directory, right)).mtimeMs -
        fs.statSync(path.join(directory, left)).mtimeMs,
    );
  if (tarballs.length === 0) {
    throw new Error(`No tarball found in ${directory}`);
  }
  return path.join(directory, tarballs[0]);
}

runNode(path.join(rootDirectory, "scripts", "npm", "prepare-npm-wrapper.cjs"));

fs.mkdirSync(cacheDirectory, { recursive: true });
fs.rmSync(smokeDirectory, { recursive: true, force: true });
fs.rmSync(stagingDirectory, { recursive: true, force: true });
fs.rmSync(dummyBinariesDirectory, { recursive: true, force: true });

runNpm(["pack", "--cache", cacheDirectory], { cwd: wrapperDirectory });
const tarballPath = latestTarball(wrapperDirectory);

// Install the wrapper ONLY (no platform sub-package). The launcher must fail
// gracefully — never crash, never touch the network — when no binary is present.
runNpm([
  "install",
  "--prefix",
  smokeDirectory,
  "--cache",
  cacheDirectory,
  "--ignore-scripts",
  "--omit=optional",
  "--no-audit",
  "--no-fund",
  tarballPath,
]);

const installedRoot = path.join(smokeDirectory, "node_modules", "@general-liquidity", "gordon");
const launcherPath = path.join(installedRoot, "bin", "gordon.cjs");

if (!fs.existsSync(launcherPath)) {
  throw new Error(`Smoke install did not create ${launcherPath}`);
}

const noBinary = spawnSync(process.execPath, [launcherPath, "--version"], {
  cwd: rootDirectory,
  stdio: "pipe",
  encoding: "utf8",
});
if (noBinary.status !== 1) {
  throw new Error(
    `Launcher without a platform binary should exit 1, got status=${noBinary.status}.`,
  );
}
if (!/No prebuilt binary/i.test(noBinary.stderr || "")) {
  throw new Error("Launcher graceful-failure message not found in stderr.");
}
console.log("Graceful no-binary path OK (exit 1 + clear message).");

// Stage a host sub-package with a stand-in binary (a copy of node itself, which
// answers `--version` and exits 0) and drop it into node_modules where the
// launcher resolves it. Exercises the require.resolve + spawn path end to end.
fs.mkdirSync(dummyBinariesDirectory, { recursive: true });
const dummyAssetPath = path.join(dummyBinariesDirectory, hostAssetName());
fs.copyFileSync(process.execPath, dummyAssetPath);

const wrapperPkg = JSON.parse(fs.readFileSync(path.join(wrapperDirectory, "package.json"), "utf8"));
runNode(path.join(rootDirectory, "scripts", "npm", "stage-platform-packages.cjs"), [
  "--binaries",
  dummyBinariesDirectory,
  "--out",
  stagingDirectory,
  "--version",
  wrapperPkg.version,
]);

const target = hostTarget();
const stagedPkgDir = path.join(stagingDirectory, "@general-liquidity", `gordon-${target}`);
if (!fs.existsSync(stagedPkgDir)) {
  throw new Error(`Staging did not produce a package for host target ${target}.`);
}

const installedSubPkgDir = path.join(
  smokeDirectory,
  "node_modules",
  "@general-liquidity",
  `gordon-${target}`,
);
fs.cpSync(stagedPkgDir, installedSubPkgDir, { recursive: true });

const withBinary = spawnSync(process.execPath, [launcherPath, "--version"], {
  cwd: rootDirectory,
  stdio: "ignore",
});
if (withBinary.status !== 0) {
  throw new Error("Launcher failed to spawn the resolved platform binary.");
}

console.log(`npm wrapper smoke test passed for ${path.basename(tarballPath)} (target ${target}).`);
