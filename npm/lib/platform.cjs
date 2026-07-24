const fs = require("fs");
const path = require("path");

/**
 * Detect whether we're running on a musl libc Linux distro (Alpine,
 * Void, etc). musl binaries are ABI-incompatible with glibc binaries —
 * shipping the wrong one crashes immediately at startup.
 */
function isMuslLinux() {
  if (process.platform !== "linux") return false;
  // Heuristic 1: Alpine and Void leave a marker file
  if (fs.existsSync("/etc/alpine-release")) return true;
  // Heuristic 2: ldd prints the libc path
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("ldd", ["--version"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });
    if (/musl/i.test(out)) return true;
  } catch {
    // ldd missing — fall through
  }
  return false;
}

const SUPPORTED_TARGETS = {
  "darwin:arm64": { assetName: "gordon-darwin-arm64", binaryName: "gordon" },
  "darwin:x64": { assetName: "gordon-darwin-x64", binaryName: "gordon" },
  "linux:arm64": { assetName: "gordon-linux-arm64", binaryName: "gordon" },
  "linux:x64": { assetName: "gordon-linux-x64", binaryName: "gordon" },
  "linux:arm64:musl": { assetName: "gordon-linux-arm64-musl", binaryName: "gordon" },
  "linux:x64:musl": { assetName: "gordon-linux-x64-musl", binaryName: "gordon" },
  "win32:arm64": { assetName: "gordon-windows-arm64.exe", binaryName: "gordon.exe" },
  "win32:x64": { assetName: "gordon-windows-x64.exe", binaryName: "gordon.exe" }
};

function getTarget(platform = process.platform, arch = process.arch) {
  // Linux gets a musl variant — pick the right one based on the host libc
  let key = `${platform}:${arch}`;
  if (platform === "linux" && isMuslLinux()) {
    const muslKey = `${platform}:${arch}:musl`;
    if (SUPPORTED_TARGETS[muslKey]) key = muslKey;
  }

  const target = SUPPORTED_TARGETS[key];
  if (target) {
    return target;
  }

  const supported = Object.keys(SUPPORTED_TARGETS)
    .sort()
    .join(", ");
  throw new Error(`Unsupported platform ${platform}/${arch}. Supported targets: ${supported}`);
}

function getInstallDirectory(packageRoot = path.resolve(__dirname, "..")) {
  return path.join(packageRoot, "vendor");
}

function getInstalledBinaryPath(packageRoot = path.resolve(__dirname, ".."), platform, arch) {
  const { binaryName } = getTarget(platform, arch);
  return path.join(getInstallDirectory(packageRoot), binaryName);
}

function getDownloadUrl(version, platform = process.platform, arch = process.arch) {
  const { assetName } = getTarget(platform, arch);
  const cleanVersion = String(version).replace(/^v/, "");
  const distRepo = process.env.GORDON_BINARY_DIST_REPO || "general-liquidity/gordon-dist";
  const baseUrl =
    process.env.GORDON_BINARY_BASE_URL || `https://github.com/${distRepo}/releases/download/v${cleanVersion}`;
  return `${baseUrl.replace(/\/$/, "")}/${assetName}`;
}

module.exports = {
  SUPPORTED_TARGETS,
  getDownloadUrl,
  getInstallDirectory,
  getInstalledBinaryPath,
  getTarget
};
