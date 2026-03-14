const fs = require("fs");
const path = require("path");
const https = require("https");
const { pipeline } = require("stream/promises");
const {
  getDownloadUrl,
  getInstallDirectory,
  getInstalledBinaryPath,
  getTarget
} = require("../lib/platform.cjs");
const pkg = require("../package.json");

const packageRoot = path.resolve(__dirname, "..");
const installDirectory = getInstallDirectory(packageRoot);
const manifestPath = path.join(installDirectory, "install.json");

function log(message) {
  console.log(`[gordon] ${message}`);
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function getSourceDescriptor(version) {
  if (process.env.GORDON_BINARY_PATH) {
    return { type: "file", value: path.resolve(process.env.GORDON_BINARY_PATH) };
  }

  if (process.env.GORDON_BINARY_URL) {
    return { type: "url", value: process.env.GORDON_BINARY_URL };
  }

  return { type: "url", value: getDownloadUrl(version) };
}

async function ensureInstallDirectory() {
  await fs.promises.mkdir(installDirectory, { recursive: true });
}

async function copyLocalBinary(sourcePath, destinationPath) {
  await fs.promises.copyFile(sourcePath, destinationPath);
}

async function downloadBinary(url, destinationPath, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error(`Too many redirects while downloading ${url}`);
  }

  await new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": "gordon-npm-installer" } },
      async (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          try {
            await downloadBinary(response.headers.location, destinationPath, redirectCount + 1);
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with status ${response.statusCode} for ${url}`));
          return;
        }

        const fileStream = fs.createWriteStream(destinationPath);
        pipeline(response, fileStream).then(resolve, reject);
      }
    );

    request.on("error", reject);
  });
}

async function finalizeBinary(tempPath, targetPath) {
  if (process.platform !== "win32") {
    await fs.promises.chmod(tempPath, 0o755);
  }

  await fs.promises.rm(targetPath, { force: true });
  await fs.promises.rename(tempPath, targetPath);
}

async function writeManifest(payload) {
  await fs.promises.writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  if (process.env.GORDON_INSTALL_SKIP_DOWNLOAD === "1") {
    log("Skipping binary download because GORDON_INSTALL_SKIP_DOWNLOAD=1.");
    return;
  }

  const target = getTarget();
  if (target.note) {
    log(target.note);
  }

  const targetPath = getInstalledBinaryPath(packageRoot);
  const tempPath = `${targetPath}.tmp`;
  const version = String(pkg.version).replace(/^v/, "");
  const source = getSourceDescriptor(version);
  const manifest = readManifest();

  if (
    manifest &&
    manifest.version === version &&
    manifest.sourceType === source.type &&
    manifest.sourceValue === source.value &&
    fs.existsSync(targetPath)
  ) {
    return;
  }

  await ensureInstallDirectory();
  await fs.promises.rm(tempPath, { force: true });

  if (source.type === "file") {
    log(`Installing local binary from ${source.value}`);
    await copyLocalBinary(source.value, tempPath);
  } else {
    log(`Downloading ${source.value}`);
    await downloadBinary(source.value, tempPath);
  }

  await finalizeBinary(tempPath, targetPath);
  await writeManifest({
    binaryName: path.basename(targetPath),
    sourceType: source.type,
    sourceValue: source.value,
    version
  });
}

main().catch(async (error) => {
  const targetPath = getInstalledBinaryPath(packageRoot);
  await fs.promises.rm(`${targetPath}.tmp`, { force: true }).catch(() => {});
  console.error(`[gordon] ${error.message}`);
  process.exit(1);
});
