#!/usr/bin/env node

// Launcher for @general-liquidity/gordon.
//
// Distribution model (codex/esbuild pattern): the platform binary ships as a
// per-target optionalDependency (@general-liquidity/gordon-<target>). npm
// installs only the sub-package whose os/cpu/libc matches the host, so this
// launcher never touches the network — it just resolves the installed
// sub-package and spawns the binary inside it.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SCOPE = "@general-liquidity";

// Detect musl libc (Alpine, Void, …). musl binaries are ABI-incompatible with
// glibc binaries, so the target suffix has to encode which libc the host uses.
function isMuslLinux() {
  if (process.platform !== "linux") return false;
  if (fs.existsSync("/etc/alpine-release")) return true;
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("ldd", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8"
    });
    if (/musl/i.test(out)) return true;
  } catch {
    // ldd absent or errored — fall through to the report probe.
  }
  // On glibc, process.report exposes header.glibcVersionRuntime; its absence on
  // linux is a strong musl signal when ldd is unavailable.
  try {
    const report =
      typeof process.report?.getReport === "function" ? process.report.getReport() : null;
    if (report && report.header && !report.header.glibcVersionRuntime) return true;
  } catch {
    // report unavailable — assume glibc.
  }
  return false;
}

function computeTarget() {
  const { platform, arch } = process;
  if (platform === "linux") {
    return `linux-${arch}${isMuslLinux() ? "-musl" : ""}`;
  }
  if (platform === "darwin") return `darwin-${arch}`;
  if (platform === "win32") return `win32-${arch}`;
  return `${platform}-${arch}`;
}

const target = computeTarget();
const packageName = `${SCOPE}/gordon-${target}`;
const binaryName = process.platform === "win32" ? "gordon.exe" : "gordon";

function resolveBinaryPath() {
  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch {
    return null;
  }
  return path.join(path.dirname(packageJsonPath), "vendor", target, "bin", binaryName);
}

const binaryPath = resolveBinaryPath();

if (!binaryPath || !fs.existsSync(binaryPath)) {
  console.error(
    `[gordon] No prebuilt binary is available for ${process.platform}-${process.arch}` +
      `${target.endsWith("-musl") ? " (musl libc)" : ""}.`
  );
  console.error(`[gordon] Expected optional dependency "${packageName}" to be installed.`);
  console.error(
    "[gordon] Your platform may have no published binary, or the optional dependency"
  );
  console.error(
    "[gordon] was skipped (--no-optional, --omit=optional, or an offline install)."
  );
  console.error("[gordon] Reinstall with optional dependencies enabled, or build from source:");
  console.error("[gordon]   https://github.com/general-liquidity/gordon#install");
  process.exit(1);
}

// On POSIX wrap the exec in `sh -c 'ulimit -c 0; exec "$@"'` so the child runs
// with RLIMIT_CORE=0. A core dump on SIGSEGV/SIGABRT would otherwise contain
// in-memory exchange/broker/LLM keys, and Node can't call setrlimit from JS.
//
// Argv-safety: the binary path and args are passed as POSITIONAL PARAMETERS
// after the `sh` $0 placeholder, NOT interpolated into the command string —
// `exec "$@"` re-execs them verbatim with no shell parsing, so there is no
// command-injection surface. Windows has no core dumps / no ulimit; it spawns
// the binary directly. Exit-code and signal propagation are identical on both.
const args = process.argv.slice(2);
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
