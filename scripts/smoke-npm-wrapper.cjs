const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDirectory = path.resolve(__dirname, "..");
const wrapperDirectory = path.join(rootDirectory, "npm");
const cacheDirectory = path.join(rootDirectory, ".npm-cache");
const smokeDirectory = path.join(rootDirectory, ".package-smoke");
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";

function runNode(scriptPath, env = process.env) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: rootDirectory,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNpm(args, options = {}) {
  const result = spawnSync(
    npmCommand,
    npmExecPath ? [npmExecPath, ...args] : args,
    {
      cwd: options.cwd || rootDirectory,
      env: options.env || process.env,
      stdio: "inherit"
    }
  );

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
        fs.statSync(path.join(directory, left)).mtimeMs
    );

  if (tarballs.length === 0) {
    throw new Error(`No tarball found in ${directory}`);
  }

  return path.join(directory, tarballs[0]);
}

runNode(path.join(rootDirectory, "scripts", "prepare-npm-wrapper.cjs"));

fs.mkdirSync(cacheDirectory, { recursive: true });
fs.rmSync(smokeDirectory, { recursive: true, force: true });

runNpm(["pack", "--cache", cacheDirectory], { cwd: wrapperDirectory });

const tarballPath = latestTarball(wrapperDirectory);
const installEnv = {
  ...process.env,
  GORDON_BINARY_PATH: process.env.GORDON_BINARY_PATH || process.execPath
};

runNpm(
  [
    "install",
    "--prefix",
    smokeDirectory,
    "--cache",
    cacheDirectory,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarballPath
  ],
  { env: installEnv }
);

const installedRoot = path.join(smokeDirectory, "node_modules", "@general-liquidity", "gordon-cli");
const installedBinary = path.join(
  installedRoot,
  "vendor",
  process.platform === "win32" ? "gordon.exe" : "gordon"
);
const launcherPath = path.join(installedRoot, "bin", "gordon.cjs");
const postinstallPath = path.join(installedRoot, "scripts", "postinstall.cjs");

runNode(postinstallPath, installEnv);

if (!fs.existsSync(installedBinary)) {
  throw new Error(`Smoke install did not create ${installedBinary}`);
}

const launched = spawnSync(process.execPath, [launcherPath, "--version"], {
  cwd: rootDirectory,
  stdio: "ignore"
});

if (launched.status !== 0) {
  throw new Error("Wrapper launcher failed to start the installed binary.");
}

console.log(`npm wrapper smoke test passed for ${path.basename(tarballPath)}.`);
