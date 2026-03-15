const path = require("path");

const SUPPORTED_TARGETS = {
  "darwin:arm64": { assetName: "gordon-darwin-arm64", binaryName: "gordon" },
  "darwin:x64": { assetName: "gordon-darwin-x64", binaryName: "gordon" },
  "linux:arm64": { assetName: "gordon-linux-arm64", binaryName: "gordon" },
  "linux:x64": { assetName: "gordon-linux-x64", binaryName: "gordon" },
  "win32:arm64": {
    assetName: "gordon-windows-x64.exe",
    binaryName: "gordon.exe",
    note: "Using the Windows x64 binary on arm64."
  },
  "win32:x64": { assetName: "gordon-windows-x64.exe", binaryName: "gordon.exe" }
};

function getTarget(platform = process.platform, arch = process.arch) {
  const key = `${platform}:${arch}`;
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
  const distRepo = process.env.GORDON_BINARY_DIST_REPO || "general-liquidity/gordon-cli-dist";
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
