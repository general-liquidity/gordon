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

type InstallChannel = "bun" | "npm" | "binary" | "dev" | "unknown";

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

function detectInstallChannel(): InstallChannel {
  const packageRoot = currentPackageRoot();
  const scriptArg = process.argv[1] ?? "";
  const execPath = process.execPath;

  if (scriptArg.endsWith("src/index.tsx") || (packageRoot && fs.existsSync(path.join(packageRoot, "src", "index.tsx")))) {
    return "dev";
  }

  const normalizedRoot = packageRoot?.replace(/\\/g, "/") ?? "";
  const normalizedExec = execPath.replace(/\\/g, "/");

  if (normalizedRoot.includes("/.bun/install/global/")) {
    return "bun";
  }

  if (normalizedRoot.includes("/node_modules/")) {
    return "npm";
  }

  if (
    normalizedExec.includes("/.bun/")
    || normalizedExec.endsWith("/bun")
    || normalizedExec.endsWith("/bun.exe")
  ) {
    return "bun";
  }

  if (scriptArg && !scriptArg.endsWith(".js") && !scriptArg.endsWith(".ts")) {
    return "binary";
  }

  return "unknown";
}

function getUpdateCommand(channel: InstallChannel): UpdateCommand | null {
  switch (channel) {
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
): string[] {
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
    });

    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

export async function maybePromptForUpdate(): Promise<"updated" | "skipped" | "none"> {
  if (!isInteractiveSession()) return "none";

  const channel = detectInstallChannel();
  const updateCommand = getUpdateCommand(channel);
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
  const channel = detectInstallChannel();
  const updateCommand = getUpdateCommand(channel);
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
