/**
 * Update Notifier
 * Checks npm registry for newer versions and notifies the user on startup.
 * Checks at most once per day. Non-blocking — never delays startup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GORDON_DIR } from "../infra/storage/paths.ts";
import { VERSION, compareSemver } from "../cli.ts";

const UPDATE_CHECK_FILE = path.join(GORDON_DIR, ".update-check");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = "@general-liquidity/gordon-cli";
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

interface UpdateCheckState {
  lastCheck: number;
  latestVersion: string | null;
  notifiedVersion: string | null;
}

function loadState(): UpdateCheckState {
  try {
    if (fs.existsSync(UPDATE_CHECK_FILE)) {
      const data = fs.readFileSync(UPDATE_CHECK_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Corrupted file, reset
  }
  return { lastCheck: 0, latestVersion: null, notifiedVersion: null };
}

function saveState(state: UpdateCheckState): void {
  try {
    fs.mkdirSync(GORDON_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(state), "utf-8");
  } catch {
    // Non-critical, ignore
  }
}

/**
 * Check if enough time has passed since the last check.
 */
function shouldCheck(state: UpdateCheckState): boolean {
  return Date.now() - state.lastCheck > CHECK_INTERVAL_MS;
}

/**
 * Fetch the latest version from npm registry (non-blocking).
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null; // Network error, offline, etc.
  }
}

/**
 * Print update notification banner if a newer version is available.
 * Returns true if an update is available.
 */
function printUpdateBanner(latestVersion: string): boolean {
  if (compareSemver(latestVersion, VERSION) <= 0) return false;

  const line = "─".repeat(50);
  console.log(`\n${line}`);
  console.log(`  Update available: v${VERSION} → v${latestVersion}`);
  console.log(`  Run: bun update -g ${PACKAGE_NAME}`);
  console.log(`${line}\n`);
  return true;
}

/**
 * Check for updates and notify the user.
 * This is fire-and-forget — it never throws and never blocks startup.
 * Call this after the TUI has rendered its first frame.
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const state = loadState();

    // If we already know about a newer version, show the banner
    if (state.latestVersion && compareSemver(state.latestVersion, VERSION) > 0) {
      // Only show once per version
      if (state.notifiedVersion !== state.latestVersion) {
        printUpdateBanner(state.latestVersion);
        state.notifiedVersion = state.latestVersion;
        saveState(state);
      }
    }

    // Check registry if enough time has passed
    if (!shouldCheck(state)) return;

    const latest = await fetchLatestVersion();
    state.lastCheck = Date.now();

    if (latest) {
      state.latestVersion = latest;

      // Show banner if this is a new version we haven't notified about
      if (compareSemver(latest, VERSION) > 0 && state.notifiedVersion !== latest) {
        printUpdateBanner(latest);
        state.notifiedVersion = latest;
      }
    }

    saveState(state);
  } catch {
    // Never crash the app due to update check
  }
}

/**
 * Get update info without printing (for --json output or status display).
 */
export function getUpdateInfo(): { current: string; latest: string | null; updateAvailable: boolean } {
  const state = loadState();
  return {
    current: VERSION,
    latest: state.latestVersion,
    updateAvailable: state.latestVersion ? compareSemver(state.latestVersion, VERSION) > 0 : false,
  };
}
