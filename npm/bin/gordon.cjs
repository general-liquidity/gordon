#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getInstalledBinaryPath } = require("../lib/platform.cjs");
const { runSelfInstall } = require("../lib/self-install.cjs");

const packageRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

if (args[0] === "install") {
  runSelfInstall(args.slice(1), { packageRoot }).then(
    (code) => process.exit(code || 0),
    (error) => {
      console.error(`[gordon] ${error.message}`);
      process.exit(1);
    }
  );
  return;
}

let binaryPath;
try {
  binaryPath = getInstalledBinaryPath(packageRoot);
} catch (error) {
  console.error(`[gordon] ${error.message}`);
  process.exit(1);
}

if (!fs.existsSync(binaryPath)) {
  console.error(
    "[gordon] The Gordon binary is missing. Reinstall with `npm install -g @general-liquidity/gordon` or run `npx @general-liquidity/gordon@latest install` for a user-local install."
  );
  process.exit(1);
}

// On POSIX (Linux/macOS) wrap the exec in a minimal `sh -c 'ulimit -c 0; exec
// "$@"'` so the child runs with the core-dump limit set to 0. A core dump on
// SIGSEGV/SIGABRT would otherwise contain in-memory exchange/broker/LLM keys.
// Node/Bun can't call setrlimit from JS, so the shell's `ulimit` is the only
// in-launcher mechanism that actually enforces RLIMIT_CORE=0 before exec.
//
// Argv-safety: the binary path and args are passed as POSITIONAL PARAMETERS
// (after the `sh` $0 placeholder), NOT interpolated into the command string —
// `exec "$@"` re-execs them verbatim with no shell parsing, so there is no
// command-injection surface from arbitrary args.
//
// Windows has no core dumps and no POSIX `ulimit`; it keeps the direct spawn.
// stdio:'inherit' and exit-code/signal propagation are identical on both paths.
let child;
if (process.platform === "win32") {
  child = spawn(binaryPath, args, { stdio: "inherit" });
} else {
  child = spawn(
    "/bin/sh",
    ["-c", 'ulimit -c 0 2>/dev/null; exec "$@"', "sh", binaryPath, ...args],
    { stdio: "inherit" }
  );
}

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
