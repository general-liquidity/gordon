#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getInstalledBinaryPath } = require("../lib/platform.cjs");

const packageRoot = path.resolve(__dirname, "..");

let binaryPath;
try {
  binaryPath = getInstalledBinaryPath(packageRoot);
} catch (error) {
  console.error(`[gordon] ${error.message}`);
  process.exit(1);
}

if (!fs.existsSync(binaryPath)) {
  console.error(
    "[gordon] The Gordon binary is missing. Reinstall with `npm install -g @general-liquidity/gordon-cli`."
  );
  process.exit(1);
}

const child = spawn(binaryPath, process.argv.slice(2), { stdio: "inherit" });

child.on("error", (error) => {
  console.error(`[gordon] Failed to launch ${path.basename(binaryPath)}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
