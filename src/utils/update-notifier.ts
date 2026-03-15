/**
 * Update Notifier
 * Checks npm registry for newer versions and prompts before TUI startup.
 * Checks at most once per day and supports skipping a specific version.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { GORDON_DIR } from "../infra/storage/paths.ts";
import { VERSION, compareSemver } from "../cli.ts";

const UPDATE_CHECK_FILE = path.join(GORDON_DIR, ".update-check");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = "@general-liquidity/gordon-cli";
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const PUBLIC_INSTALL_SH_URL = "https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.sh";
const PUBLIC_INSTALL_PS1_URL = "https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.ps1";
const NPM_WRAPPER_INSTALL_MANIFEST = "install.json";
const INSTALL_CHANNEL_METADATA_FILE = "gordon-install.json";

export type InstallChannel =
  | "bun"
  | "npm"
  | "homebrew"
  | "scoop"
  | "npx"
  | "script-unix"
  | "script-windows"
  | "binary"
  | "dev"
  | "unknown";

export interface InstallContext {
  channel: InstallChannel;
  installDir?: string;
}

interface UpdateCheckState {
  lastCheck: number;
  latestVersion: string | null;
  notifiedVersion: string | null;
  skippedVersion: string | null;
}

interface UpdateCommand {
  command: string;
  args: string[];
  display: string;
  publicDisplay: string;
  env?: Record<string, string>;
}

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  cyan: "\u001B[36m",
  green: "\u001B[32m",
} as const;

function loadState(): UpdateCheckState {
  try {
    if (fs.existsSync(UPDATE_CHECK_FILE)) {
      const data = fs.readFileSync(UPDATE_CHECK_FILE, "utf-8");
      const parsed = JSON.parse(data) as Partial<UpdateCheckState>;
      return {
        lastCheck: parsed.lastCheck ?? 0,
        latestVersion: parsed.latestVersion ?? null,
        notifiedVersion: parsed.notifiedVersion ?? null,
        skippedVersion: parsed.skippedVersion ?? null,
      };
    }
  } catch {
    // Corrupted file, reset
  }
  return { lastCheck: 0, latestVersion: null, notifiedVersion: null, skippedVersion: null };
}

function saveState(state: UpdateCheckState): void {
  try {
    fs.mkdirSync(GORDON_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(state), "utf-8");
  } catch {
    // Non-critical, ignore
  }
}

function shouldCheck(state: UpdateCheckState): boolean {
  return Date.now() - state.lastCheck > CHECK_INTERVAL_MS;
}

async function fetchLatestVersion(timeoutMs: number = 1500): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function currentPackageRoot(): string | null {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFile), "..");
  } catch {
    return null;
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function normalizeInstallChannel(value: string | undefined | null): InstallChannel | null {
  switch (value) {
    case "bun":
    case "npm":
    case "homebrew":
    case "scoop":
    case "npx":
    case "script-unix":
    case "script-windows":
    case "binary":
    case "dev":
    case "unknown":
      return value;
    default:
      return null;
  }
}

function readAdjacentInstallContext(execPath: string): InstallContext | null {
  const executableDirectory = path.dirname(execPath);
  const sidecarMetadata = readJsonFile<{ channel?: string; installDir?: string }>(
    path.join(executableDirectory, INSTALL_CHANNEL_METADATA_FILE),
  );

  const normalizedSidecarChannel = normalizeInstallChannel(sidecarMetadata?.channel ?? null);
  if (normalizedSidecarChannel) {
    return {
      channel: normalizedSidecarChannel,
      installDir: sidecarMetadata?.installDir || executableDirectory,
    };
  }

  const wrapperInstallManifest = readJsonFile<{ binaryName?: string }>(
    path.join(executableDirectory, NPM_WRAPPER_INSTALL_MANIFEST),
  );
  if (wrapperInstallManifest) {
    return {
      channel: "npm",
      installDir: executableDirectory,
    };
  }

  return null;
}

function isHomebrewPath(normalizedExec: string): boolean {
  return /\/(?:opt\/homebrew|usr\/local|homebrew)\/cellar\/gordon\//i.test(normalizedExec)
    || /\/cellar\/gordon\//i.test(normalizedExec);
}

function isScoopPath(normalizedExec: string): boolean {
  return normalizedExec.includes("/scoop/apps/gordon/");
}

export function detectInstallContext(options: {
  packageRoot?: string | null;
  scriptArg?: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): InstallContext {
  const packageRoot = options.packageRoot === undefined ? currentPackageRoot() : options.packageRoot;
  const scriptArg = options.scriptArg ?? process.argv[1] ?? "";
  const execPath = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;

  if (scriptArg.endsWith("src/index.tsx") || (packageRoot && fs.existsSync(path.join(packageRoot, "src", "index.tsx")))) {
    return { channel: "dev" };
  }

  const envChannel = normalizeInstallChannel(env.GORDON_INSTALL_CHANNEL);
  if (envChannel) {
    return {
      channel: envChannel,
      installDir: env.GORDON_INSTALL_DIR || path.dirname(execPath),
    };
  }

  const adjacentInstallContext = readAdjacentInstallContext(execPath);
  if (adjacentInstallContext) {
    return adjacentInstallContext;
  }

  const normalizedRoot = packageRoot?.replace(/\\/g, "/") ?? "";
  const normalizedExec = execPath.replace(/\\/g, "/").toLowerCase();

  if (normalizedRoot.includes("/.bun/install/global/")) {
    return { channel: "bun" };
  }

  if (normalizedRoot.includes("/node_modules/")) {
    return { channel: "npm" };
  }

  if (
    normalizedExec.includes("/.bun/")
    || normalizedExec.endsWith("/bun")
    || normalizedExec.endsWith("/bun.exe")
  ) {
    return { channel: "bun" };
  }

  if (isHomebrewPath(normalizedExec)) {
    return { channel: "homebrew" };
  }

  if (isScoopPath(normalizedExec)) {
    return { channel: "scoop" };
  }

  if (scriptArg && !scriptArg.endsWith(".js") && !scriptArg.endsWith(".ts")) {
    return { channel: "binary" };
  }

  return { channel: "unknown" };
}

export function getUpdateCommand(context: InstallContext): UpdateCommand | null {
  switch (context.channel) {
    case "bun":
      return {
        command: "bun",
        args: ["update", "-g", PACKAGE_NAME],
        display: `bun update -g ${PACKAGE_NAME}`,
        publicDisplay: "gordon --upgrade",
      };
    case "npm":
      return {
        command: "npm",
        args: ["install", "-g", `${PACKAGE_NAME}@latest`],
        display: `npm install -g ${PACKAGE_NAME}@latest`,
        publicDisplay: "gordon --upgrade",
      };
    case "homebrew":
      return {
        command: "brew",
        args: ["upgrade", "general-liquidity/gordon-cli-dist/gordon"],
        display: "brew upgrade general-liquidity/gordon-cli-dist/gordon",
        publicDisplay: "gordon --upgrade",
      };
    case "scoop":
      return {
        command: "scoop",
        args: ["update", "gordon"],
        display: "scoop update gordon",
        publicDisplay: "gordon --upgrade",
      };
    case "npx": {
      const args = ["--yes", `${PACKAGE_NAME}@latest`, "install"];
      if (context.installDir) {
        args.push("--target-dir", context.installDir);
      }
      return {
        command: "npx",
        args,
        display: context.installDir
          ? `npx --yes ${PACKAGE_NAME}@latest install --target-dir "${context.installDir}"`
          : `npx --yes ${PACKAGE_NAME}@latest install`,
        publicDisplay: "gordon --upgrade",
      };
    }
    case "script-unix":
      return {
        command: "sh",
        args: [
          "-c",
          `command -v curl >/dev/null 2>&1 && curl -fsSL ${PUBLIC_INSTALL_SH_URL} | sh || wget -qO- ${PUBLIC_INSTALL_SH_URL} | sh`,
        ],
        display: `curl -fsSL ${PUBLIC_INSTALL_SH_URL} | sh`,
        publicDisplay: "gordon --upgrade",
        env: context.installDir ? { GORDON_INSTALL_DIR: context.installDir } : undefined,
      };
    case "script-windows":
      return {
        command: "powershell",
        args: ["-NoProfile", "-Command", `irm ${PUBLIC_INSTALL_PS1_URL} | iex`],
        display: `irm ${PUBLIC_INSTALL_PS1_URL} | iex`,
        publicDisplay: "gordon --upgrade",
        env: context.installDir ? { GORDON_INSTALL_DIR: context.installDir } : undefined,
      };
    default:
      return null;
  }
}

function isInteractiveSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function shouldColorPrompt(): boolean {
  return Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb");
}

function highlightCommandStem(display: string, command: string, color: boolean): string {
  if (!color) {
    return display;
  }

  const [firstToken, ...rest] = display.split(" ");
  if (!firstToken) {
    return display;
  }

  const accent = command === "npm" ? ANSI.cyan : ANSI.green;
  return [`${ANSI.bold}${accent}${firstToken}${ANSI.reset}`, ...rest].join(" ");
}

export function formatUpdatePromptLines(
  latestVersion: string,
  updateCommand: UpdateCommand,
  options: { color?: boolean } = {},
): [string, string, string] {
  const color = options.color ?? shouldColorPrompt();
  const display = highlightCommandStem(updateCommand.publicDisplay, "gordon", color);
  return [
    `Update available: v${VERSION} -> v${latestVersion}`,
    `Run now? ${display}`,
    "[Y]es / [N]o / [S]kip this version: ",
  ];
}

async function promptForAction(latestVersion: string, updateCommand: UpdateCommand): Promise<"update" | "skip" | "skip-version"> {
  const [headline, commandLine, choiceLine] = formatUpdatePromptLines(latestVersion, updateCommand);
  process.stdout.write("\n");
  process.stdout.write(`${headline}\n`);
  process.stdout.write(`${commandLine}\n`);
  process.stdout.write(choiceLine);

  return await new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };

    const onData = (chunk: Buffer | string) => {
      const input = chunk.toString().trim().toLowerCase();
      cleanup();
      process.stdout.write("\n");

      if (input === "s") {
        resolve("skip-version");
        return;
      }
      if (input === "y" || input === "yes" || input === "") {
        resolve("update");
        return;
      }
      resolve("skip");
    };

    process.stdin.setEncoding("utf-8");
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

async function runUpdateCommand(updateCommand: UpdateCommand): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn(updateCommand.command, updateCommand.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: updateCommand.env ? { ...process.env, ...updateCommand.env } : process.env,
    });

    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

export async function maybePromptForUpdate(): Promise<"updated" | "skipped" | "none"> {
  if (!isInteractiveSession()) return "none";

  const installContext = detectInstallContext();
  const updateCommand = getUpdateCommand(installContext);
  if (!updateCommand) return "none";

  const state = loadState();
  let latestVersion = state.latestVersion;

  if (!latestVersion || shouldCheck(state)) {
    const fetched = await fetchLatestVersion();
    state.lastCheck = Date.now();
    if (fetched) {
      latestVersion = fetched;
      state.latestVersion = fetched;
    }
    saveState(state);
  }

  if (!latestVersion || compareSemver(latestVersion, VERSION) <= 0) {
    return "none";
  }

  if (state.skippedVersion === latestVersion) {
    return "none";
  }

  const action = await promptForAction(latestVersion, updateCommand);

  if (action === "skip-version") {
    state.skippedVersion = latestVersion;
    saveState(state);
    return "skipped";
  }

  if (action === "skip") {
    return "skipped";
  }

  const ok = await runUpdateCommand(updateCommand);
  if (ok) {
    state.notifiedVersion = latestVersion;
    state.skippedVersion = null;
    saveState(state);
    process.stdout.write(`\nUpdate complete. Restart Gordon to use v${latestVersion}.\n`);
    return "updated";
  }

  process.stdout.write(`\nUpdate failed. You can retry manually:\n  ${updateCommand.publicDisplay}\n`);
  return "skipped";
}

export async function runSelfUpgrade(): Promise<"updated" | "unsupported" | "failed"> {
  const installContext = detectInstallContext();
  const updateCommand = getUpdateCommand(installContext);
  if (!updateCommand) {
    return "unsupported";
  }

  const ok = await runUpdateCommand(updateCommand);
  if (!ok) {
    return "failed";
  }

  process.stdout.write(`\nUpdate complete. Restart Gordon to use the latest version.\n`);
  return "updated";
}

export async function checkForUpdates(): Promise<void> {
  const state = loadState();
  if (!shouldCheck(state)) return;

  const latest = await fetchLatestVersion(1000);
  state.lastCheck = Date.now();
  if (latest) {
    state.latestVersion = latest;
  }
  saveState(state);
}

export function getUpdateInfo(): { current: string; latest: string | null; updateAvailable: boolean } {
  const state = loadState();
  return {
    current: VERSION,
    latest: state.latestVersion,
    updateAvailable: state.latestVersion ? compareSemver(state.latestVersion, VERSION) > 0 : false,
  };
}
