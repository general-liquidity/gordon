/**
 * License Gate
 *
 * Validates invite codes against Supabase on first run,
 * caches the token locally, and sends periodic heartbeats.
 *
 * Called before TUI loads — blocks if no valid license.
 * Graceful degradation: allows cached token when offline.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as readline from "node:readline";
import { GORDON_DIR } from "../../storage/paths.ts";
import { VERSION } from "../../../cli.ts";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TOKEN_CACHE_TTL_MS,
  API_TIMEOUT_MS,
  type LicenseFile,
  type ActivateRequest,
  type ActivateResponse,
  type HeartbeatResponse,
  type VersionPolicy,
} from "./types.ts";
import {
  startHeartbeat,
  stopHeartbeat,
  trackEvent,
  onVersionPolicy,
  getLatestVersionPolicy,
} from "./telemetry.ts";

const LICENSE_FILE = path.join(GORDON_DIR, "license.json");
const MACHINE_ID_FILE = path.join(GORDON_DIR, ".machine-id");

// ============================================================================
// Machine Fingerprint
// ============================================================================

function getMachineId(): string {
  // Use a persisted random UUID as the primary machine identifier.
  // Falls back to hashing system info if the file can't be created.
  try {
    if (fs.existsSync(MACHINE_ID_FILE)) {
      const stored = fs.readFileSync(MACHINE_ID_FILE, "utf-8").trim();
      if (stored.length >= 16) return stored;
    }

    // Generate and persist a new machine ID
    const id = crypto.randomUUID().replace(/-/g, "");
    fs.mkdirSync(path.dirname(MACHINE_ID_FILE), { recursive: true });
    fs.writeFileSync(MACHINE_ID_FILE, id, { encoding: "utf-8", mode: 0o600 });
    return id;
  } catch {
    // Fallback: hash system info (works in containers where fs may be read-only)
    let username = "unknown";
    try { username = os.userInfo().username; } catch { /* ok — headless/container */ }
    const raw = `${os.hostname()}:${username}:${os.platform()}:${os.arch()}`;
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  }
}

// ============================================================================
// License File I/O
// ============================================================================

function readLicense(): LicenseFile | null {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    const data = fs.readFileSync(LICENSE_FILE, "utf-8");
    const parsed = JSON.parse(data) as LicenseFile;
    if (!parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLicense(license: LicenseFile): void {
  fs.mkdirSync(path.dirname(LICENSE_FILE), { recursive: true });
  // mode: 0o600 restricts to owner-only on Unix; no-op on Windows (uses ACLs)
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ============================================================================
// Activation Flow
// ============================================================================

async function promptInviteCode(): Promise<string> {
  return new Promise((resolve) => {
    // If stdin is not a TTY (piped, CI), resolve empty immediately
    if (!process.stdin.isTTY) {
      resolve("");
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("");
    console.log("  Gordon CLI — Private Alpha");
    console.log("  ─────────────────────────────");
    console.log("  This build requires an invite code.");
    console.log("");

    // Handle unexpected close (e.g. ctrl+C, pipe closed)
    let answered = false;
    rl.on("close", () => {
      if (!answered) {
        answered = true;
        resolve("");
      }
    });

    rl.question("  Enter invite code: ", (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function activate(code: string): Promise<LicenseFile> {
  const body: ActivateRequest = {
    code,
    machineId: getMachineId(),
    cliVersion: VERSION,
    os: os.platform(),
    arch: os.arch(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      if (res.status === 400) {
        throw new Error(`Invalid invite code.`);
      }
      if (res.status === 410) {
        throw new Error(`Invite code has already been used.`);
      }
      throw new Error(`Activation failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as ActivateResponse;
    const now = new Date().toISOString();

    return {
      token: data.token,
      activatedAt: now,
      lastValidated: now,
      displayName: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Token Validation
// ============================================================================

function isTokenFresh(license: LicenseFile): boolean {
  const lastValidated = new Date(license.lastValidated).getTime();
  return Date.now() - lastValidated < TOKEN_CACHE_TTL_MS;
}

async function validateToken(token: string): Promise<"valid" | "revoked" | "offline"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
        "x-gordon-token": token,
      },
      body: JSON.stringify({ events: [], cliVersion: VERSION }),
      signal: controller.signal,
    });

    if (res.status === 403) return "revoked";
    if (res.ok) {
      // Capture version policy returned by the server. The standalone
      // heartbeat path doesn't go through telemetry.flush, so we need to
      // parse and dispatch here too.
      try {
        const data = (await res.clone().json()) as HeartbeatResponse;
        if (data?.versionPolicy) {
          // Trigger immediate enforcement via the same path the recurring
          // heartbeat uses.
          enforceVersionPolicy(data.versionPolicy);
        }
      } catch {
        // Non-JSON or parse error — ignore, treat as valid
      }
      return "valid";
    }

    // 5xx = server issue, treat as offline (graceful)
    // 4xx (other than 403) = client error, also treat as offline for now
    // but log it so we can investigate
    return "offline";
  } catch {
    return "offline"; // network error — allow cached token
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Version Policy Enforcement
// ============================================================================

/**
 * Compare two semver-ish strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Handles pre-release tags (e.g. "0.9.0-friends.1") by comparing the numeric
 * portion first then falling back to lexicographic on the suffix.
 */
function compareVersions(a: string, b: string): number {
  const cleanA = a.replace(/^v/i, "").trim();
  const cleanB = b.replace(/^v/i, "").trim();
  const partsA = cleanA.split(/[.-]/);
  const partsB = cleanB.split(/[.-]/);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const pa = partsA[i] ?? "0";
    const pb = partsB[i] ?? "0";
    const na = parseInt(pa, 10);
    const nb = parseInt(pb, 10);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    if (pa !== pb) return pa < pb ? -1 : 1;
  }
  return 0;
}

function isVersionBelow(current: string, target: string): boolean {
  return compareVersions(current, target) < 0;
}

/**
 * Enforce a version policy returned by the heartbeat. Fires three kinds
 * of action:
 *   - killSwitch: hard exit with the operator-provided message
 *   - minVersion violation: hard exit with upgrade instructions
 *   - recommendedVersion violation: log a banner, continue running
 *
 * Also enforces deprecatedAfter: if today >= deprecatedAfter and the
 * client is below recommendedVersion, treat as a minVersion violation.
 */
export function enforceVersionPolicy(policy: VersionPolicy): void {
  // Kill switch beats everything
  if (policy.killSwitch) {
    const msg = policy.killSwitchMessage
      ?? "Gordon is temporarily disabled by the operator. Please contact the team.";
    console.error("");
    console.error("  Gordon — emergency stop");
    console.error("  ──────────────────────────────");
    console.error(`  ${msg}`);
    console.error("");
    process.exit(1);
  }

  const upgradeHint = policy.upgradeCommand
    ?? "gordon --upgrade";

  // Hard floor — minVersion
  if (policy.minVersion && isVersionBelow(VERSION, policy.minVersion)) {
    console.error("");
    console.error("  Gordon — update required");
    console.error("  ──────────────────────────────");
    console.error(`  Your version: ${VERSION}`);
    console.error(`  Required:     ${policy.minVersion}`);
    console.error("");
    console.error(`  Run: ${upgradeHint}`);
    console.error("");
    process.exit(1);
  }

  // Soft floor — recommendedVersion
  // Also escalates to hard if past deprecatedAfter
  if (policy.recommendedVersion && isVersionBelow(VERSION, policy.recommendedVersion)) {
    const pastDeprecation = policy.deprecatedAfter
      && Date.now() > new Date(policy.deprecatedAfter).getTime();

    if (pastDeprecation) {
      console.error("");
      console.error("  Gordon — version deprecated");
      console.error("  ──────────────────────────────");
      console.error(`  Your version (${VERSION}) is past the deprecation window`);
      console.error(`  (deprecated after ${policy.deprecatedAfter}).`);
      console.error("");
      console.error(`  Run: ${upgradeHint}`);
      console.error("");
      process.exit(1);
    }

    // Soft warning — banner only, continue running
    console.warn("");
    console.warn(`  [gordon] Update recommended: ${VERSION} → ${policy.recommendedVersion}`);
    console.warn(`  [gordon] Run: ${upgradeHint}`);
    console.warn("");
  }
}

/**
 * Wire the recurring heartbeat to enforce on every policy update.
 * Called once during checkLicense() so that policy changes mid-session
 * (e.g. operator pushes a kill switch) take effect on the next heartbeat.
 */
function wireVersionPolicyListener(): void {
  onVersionPolicy((policy) => {
    enforceVersionPolicy(policy);
  });
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Check license before TUI loads.
 * Blocks if no valid license. Exits process on failure.
 */
export async function checkLicense(): Promise<void> {
  // Skip license check in development
  if (process.env.GORDON_SKIP_LICENSE === "1") return;

  // Enforce HTTPS on all license server communication
  if (!SUPABASE_URL.startsWith("https://")) {
    console.error("\n  License server URL must use HTTPS. Exiting.");
    process.exit(1);
  }

  // Wire the version policy listener once so any policy returned by the
  // recurring heartbeat is enforced immediately. Idempotent — only fires
  // once per process via module-level state in telemetry.ts.
  wireVersionPolicyListener();

  const existing = readLicense();

  // Case 1: No license — activation required
  if (!existing) {
    try {
      const code = await promptInviteCode();
      if (!code) {
        console.error("\n  No invite code provided. Exiting.");
        process.exit(1);
      }

      console.log("  Activating...");
      const license = await activate(code);
      writeLicense(license);

      console.log("  Activated successfully. Welcome to Gordon.");
      console.log("");

      // Start heartbeat for this session — first heartbeat returns the
      // current version policy and enforceVersionPolicy() is wired via
      // the listener registered above.
      startHeartbeat(license.token);
      trackEvent("activation");

      // Run an immediate validateToken on the fresh license so policy is
      // enforced before TUI loads, not 60s later.
      const freshStatus = await validateToken(license.token);
      if (freshStatus === "revoked") {
        try { fs.unlinkSync(LICENSE_FILE); } catch { /* ok */ }
        console.error("\n  Your access was revoked immediately after activation.");
        process.exit(1);
      }

      // If the listener hasn't fired yet but we have a captured policy,
      // enforce it now.
      const captured = getLatestVersionPolicy();
      if (captured) enforceVersionPolicy(captured);
      return;
    } catch (err) {
      console.error(`\n  ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // Case 2: Fresh cached token — no network needed
  // We still kick off the recurring heartbeat so policy updates are
  // captured within ~60s of session start.
  if (isTokenFresh(existing)) {
    startHeartbeat(existing.token);
    trackEvent("startup");
    return;
  }

  // Case 3: Stale token — validate against server. This call captures the
  // version policy via enforceVersionPolicy() inside validateToken on
  // success, so a forced upgrade is enforced before TUI loads.
  const status = await validateToken(existing.token);

  if (status === "revoked") {
    console.error("\n  Your access has been revoked. Contact the Gordon team.");
    // Remove revoked license
    try { fs.unlinkSync(LICENSE_FILE); } catch { /* ok */ }
    process.exit(1);
  }

  // Valid or offline — refresh cache timestamp and continue
  existing.lastValidated = new Date().toISOString();
  writeLicense(existing);
  startHeartbeat(existing.token);
  trackEvent("startup");
}

/**
 * Clean up on shutdown.
 */
export async function shutdownLicense(): Promise<void> {
  await stopHeartbeat();
}
