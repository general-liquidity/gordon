const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { pipeline } = require("stream/promises");
const { getDownloadUrl, getInstalledBinaryPath, getTarget } = require("./platform.cjs");
const { verifyBinaryIntegrity } = require("./verify.cjs");
const pkg = require("../package.json");
const INSTALL_METADATA_FILENAME = "gordon-install.json";

function allowedRedirectHosts() {
  const hosts = new Set(["github.com", "objects.githubusercontent.com"]);
  for (const value of [process.env.GORDON_BINARY_BASE_URL, process.env.GORDON_BINARY_URL]) {
    if (!value) continue;
    try {
      hosts.add(new URL(value).host);
    } catch {
      // ignore malformed override URLs
    }
  }
  return hosts;
}

function assertAllowedRedirect(location) {
  let parsed;
  try {
    parsed = new URL(location);
  } catch {
    throw new Error(`Refusing to follow malformed redirect: ${location}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing to follow non-HTTPS redirect to ${parsed.protocol}//${parsed.host}`);
  }
  if (!allowedRedirectHosts().has(parsed.host)) {
    throw new Error(`Refusing to follow redirect to untrusted host: ${parsed.host}`);
  }
  return location;
}

function log(message) {
  console.log(`[gordon] ${message}`);
}

function parseArgs(args) {
  const options = {
    help: false,
    targetDir: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if ((arg === "--target-dir" || arg === "--dir") && args[index + 1]) {
      options.targetDir = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown install option: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`gordon install

Install Gordon into a user-writable bin directory without requiring \`npm install -g\`.

Usage:
  npx @general-liquidity/gordon-cli@latest install
  gordon install --target-dir <directory>

Options:
  --target-dir <dir>   Override the install directory
  -h, --help           Show this help
`);
}

function normalizeForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function splitPathEntries(envPath = process.env.PATH || "") {
  return envPath.split(path.delimiter).filter(Boolean);
}

function pathContainsDirectory(directory, env = process.env) {
  const target = normalizeForCompare(directory);
  return splitPathEntries(env.PATH).some((entry) => {
    try {
      return normalizeForCompare(entry) === target;
    } catch {
      return false;
    }
  });
}

function uniqueDirectories(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) {
      continue;
    }

    const normalized = normalizeForCompare(value);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(path.resolve(value));
  }
  return result;
}

async function isWritableDirectory(directory, { create } = { create: false }) {
  try {
    if (create) {
      await fs.promises.mkdir(directory, { recursive: true });
    } else {
      const stats = await fs.promises.stat(directory);
      if (!stats.isDirectory()) {
        return false;
      }
    }

    const probePath = path.join(directory, `.gordon-write-test-${process.pid}-${Date.now()}`);
    await fs.promises.writeFile(probePath, "");
    await fs.promises.rm(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function resolveInstallDirectory(explicitTargetDir = null, env = process.env) {
  if (explicitTargetDir) {
    return {
      directory: explicitTargetDir,
      inPath: pathContainsDirectory(explicitTargetDir, env)
    };
  }

  const homeDirectory = os.homedir();
  const pathEntries = splitPathEntries(env.PATH);
  const standardCandidates = [];
  const pathCandidates = [];

  if (process.platform === "win32") {
    if (env.APPDATA) {
      standardCandidates.push(path.join(env.APPDATA, "npm"));
    }
    if (env.LOCALAPPDATA) {
      standardCandidates.push(path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
      standardCandidates.push(path.join(env.LOCALAPPDATA, "gordon"));
    }

    for (const entry of pathEntries) {
      const resolvedEntry = path.resolve(entry);
      const normalizedEntry = normalizeForCompare(resolvedEntry);
      const userRoots = uniqueDirectories([
        env.USERPROFILE,
        env.LOCALAPPDATA,
        env.APPDATA,
        homeDirectory
      ]);
      const withinUserRoot = userRoots.some((root) => {
        const normalizedRoot = normalizeForCompare(root);
        return normalizedEntry === normalizedRoot || normalizedEntry.startsWith(`${normalizedRoot}${path.sep}`);
      });
      if (
        withinUserRoot
        && !normalizedEntry.includes(`${path.sep}node_modules${path.sep}`)
      ) {
        pathCandidates.push(resolvedEntry);
      }
    }
  } else {
    standardCandidates.push(path.join(homeDirectory, ".local", "bin"));
    standardCandidates.push(path.join(homeDirectory, "bin"));

    for (const entry of pathEntries) {
      const resolvedEntry = path.resolve(entry);
      const normalizedEntry = normalizeForCompare(resolvedEntry);
      const normalizedHome = `${normalizeForCompare(homeDirectory)}${path.sep}`;
      if (
        normalizedEntry.startsWith(normalizedHome)
        && !normalizedEntry.includes(`${path.sep}node_modules${path.sep}`)
      ) {
        pathCandidates.push(resolvedEntry);
      }
    }
  }

  const orderedCandidates = uniqueDirectories([
    ...standardCandidates.filter((candidate) => pathContainsDirectory(candidate, env)),
    ...pathCandidates,
    ...standardCandidates
  ]);

  for (const candidate of orderedCandidates) {
    const create = standardCandidates.some((standardCandidate) => normalizeForCompare(standardCandidate) === normalizeForCompare(candidate));
    if (await isWritableDirectory(candidate, { create })) {
      return {
        directory: candidate,
        inPath: pathContainsDirectory(candidate, env)
      };
    }
  }

  throw new Error("Could not find a writable user install directory.");
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
            const location = assertAllowedRedirect(response.headers.location);
            await downloadBinary(location, destinationPath, redirectCount + 1);
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

async function writeInstallMetadata(targetDirectory, version, channel) {
  const metadataPath = path.join(targetDirectory, INSTALL_METADATA_FILENAME);
  const payload = {
    channel,
    installDir: targetDirectory,
    version,
    installedAt: new Date().toISOString()
  };
  await fs.promises.writeFile(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getUnixPathHint(directory, env = process.env) {
  const shell = env.SHELL || "";
  if (shell.includes("fish")) {
    return {
      profile: "~/.config/fish/config.fish",
      command: `fish_add_path ${directory.replace(os.homedir(), "$HOME")}`
    };
  }

  if (shell.includes("zsh")) {
    return {
      profile: "~/.zshrc",
      command: `echo 'export PATH=\"${directory.replace(os.homedir(), "$HOME")}:$PATH\"' >> ~/.zshrc`
    };
  }

  return {
    profile: "~/.bashrc",
    command: `echo 'export PATH=\"${directory.replace(os.homedir(), "$HOME")}:$PATH\"' >> ~/.bashrc`
  };
}

function printPathGuidance(directory) {
  if (process.platform === "win32") {
    log(`Add ${directory} to your user PATH, then open a new terminal.`);
    return;
  }

  const hint = getUnixPathHint(directory);
  log(`Add ${directory} to PATH if your shell cannot find \`gordon\` yet.`);
  console.log(`      ${hint.command}`);
  console.log(`      # then restart your shell or source ${hint.profile}`);
}

async function installBinary({ targetDirectory, sourceBinaryPath, version }) {
  const { binaryName, assetName } = getTarget();
  await fs.promises.mkdir(targetDirectory, { recursive: true });

  const installPath = path.join(targetDirectory, binaryName);
  const tempPath = `${installPath}.tmp`;
  await fs.promises.rm(tempPath, { force: true });

  if (sourceBinaryPath && fs.existsSync(sourceBinaryPath)) {
    log(`Copying ${path.basename(sourceBinaryPath)} to ${installPath}`);
    await fs.promises.copyFile(sourceBinaryPath, tempPath);
  } else {
    const downloadUrl = getDownloadUrl(version);
    log(`Downloading ${assetName} from ${downloadUrl}`);
    await downloadBinary(downloadUrl, tempPath);
  }

  try {
    verifyBinaryIntegrity({ tempPath, version, assetName });
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  await finalizeBinary(tempPath, installPath);
  return installPath;
}

async function runSelfInstall(args, options = {}) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    printHelp();
    return 0;
  }

  const packageRoot = options.packageRoot || path.resolve(__dirname, "..");
  const version = String(options.version || pkg.version).replace(/^v/, "");
  const bundledBinaryPath = options.sourceBinaryPath || getInstalledBinaryPath(packageRoot);
  const sourceBinaryPath = fs.existsSync(bundledBinaryPath) ? bundledBinaryPath : null;
  const { directory, inPath } = await resolveInstallDirectory(parsed.targetDir);
  const installPath = await installBinary({
    targetDirectory: directory,
    sourceBinaryPath,
    version
  });
  await writeInstallMetadata(directory, version, options.channel || "npx");

  console.log("");
  log(`Installed Gordon v${version} to ${installPath}`);
  if (!inPath) {
    printPathGuidance(directory);
  }
  console.log("");
  console.log("Next steps:");
  console.log("  gordon --help");
  console.log("  gordon");

  return 0;
}

module.exports = {
  parseArgs,
  resolveInstallDirectory,
  runSelfInstall
};
