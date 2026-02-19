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
import { GORDON_DIR } from "../storage/paths.ts";
import { VERSION } from "../../cli.ts";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TOKEN_CACHE_TTL_MS,
  API_TIMEOUT_MS,
  type LicenseFile,
  type ActivateRequest,
  type ActivateResponse,
} from "./types.ts";
import { startHeartbeat, stopHeartbeat, trackEvent } from "./telemetry.ts";

const LICENSE_FILE = path.join(GORDON_DIR, "license.json");

// ============================================================================
// Machine Fingerprint
// ============================================================================

function getMachineId(): string {
  const raw = `${os.hostname()}:${os.userInfo().username}:${os.platform()}:${os.arch()}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
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
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2), "utf-8");
}

// ============================================================================
// Activation Flow
// ============================================================================

async function promptInviteCode(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("");
    console.log("  Gordon CLI — Private Alpha");
    console.log("  ─────────────────────────────");
    console.log("  This build requires an invite code.");
    console.log("");

    rl.question("  Enter invite code: ", (answer) => {
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
    if (res.ok) return "valid";
    return "offline"; // treat server errors as offline (graceful)
  } catch {
    return "offline"; // network error — allow cached token
  } finally {
    clearTimeout(timeout);
  }
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

      // Start heartbeat for this session
      startHeartbeat(license.token);
      trackEvent("activation", { inviteCode: code.slice(0, 4) + "..." });
      return;
    } catch (err) {
      console.error(`\n  ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // Case 2: Fresh cached token — no network needed
  if (isTokenFresh(existing)) {
    startHeartbeat(existing.token);
    trackEvent("startup");
    return;
  }

  // Case 3: Stale token — validate in background
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
