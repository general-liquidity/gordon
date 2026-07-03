/**
 * One-time live-trading consent gate.
 *
 * Before the FIRST live (non-paper) execution, the operator must acknowledge
 * that Gordon trades their own venue accounts with their own keys, that it is
 * not investment advice, and that they can lose money. Acceptance persists to
 * `~/.gordon/consent.json` so the acknowledgment shows exactly once.
 *
 * This gate is LIVE-only. Paper / sandbox execution is never gated — there is
 * no capital at risk to consent to.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { getGordonDir } from "../storage/paths.ts";

/** Override the consent-file location (used by tests). */
export const CONSENT_PATH_ENV = "GORDON_CONSENT_PATH";

/** Bump when the disclaimer text changes materially and re-consent is required. */
export const LIVE_CONSENT_VERSION = 1;

/**
 * The one-time acknowledgment shown before the first live arming. Kept in sync
 * with DISCLAIMER.md / TERMS.md at the repo root.
 */
export const LIVE_CONSENT_PROMPT =
  "Gordon trades your own venue accounts with your keys. Not investment advice. " +
  "You can lose money. See DISCLAIMER.md and TERMS.md. Type ARM to proceed.";

interface ConsentFile {
  live?: { accepted: boolean; acceptedAt: string; version: number };
}

function consentPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[CONSENT_PATH_ENV];
  if (override) return override;
  return join(getGordonDir(), "consent.json");
}

function readConsentFile(env: NodeJS.ProcessEnv = process.env): ConsentFile {
  const path = consentPath(env);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ConsentFile;
  } catch {
    // Unreadable/corrupt consent file: treat as un-accepted (fail closed).
    return {};
  }
}

export function hasAcceptedLiveConsent(env: NodeJS.ProcessEnv = process.env): boolean {
  const live = readConsentFile(env).live;
  return live?.accepted === true && typeof live.version === "number" && live.version >= LIVE_CONSENT_VERSION;
}

export function recordLiveConsent(env: NodeJS.ProcessEnv = process.env): void {
  const path = consentPath(env);
  const data: ConsentFile = {
    live: { accepted: true, acceptedAt: new Date().toISOString(), version: LIVE_CONSENT_VERSION },
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

export interface LiveConsentCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Gate a live action on prior consent. Paper / sandbox always passes. When
 * live and un-accepted, returns a refusal whose reason tells the operator how
 * to acknowledge.
 */
export function requireLiveConsent(
  opts: { sandboxActive: boolean },
  env: NodeJS.ProcessEnv = process.env,
): LiveConsentCheck {
  if (opts.sandboxActive) return { ok: true };
  if (hasAcceptedLiveConsent(env)) return { ok: true };
  return {
    ok: false,
    reason:
      `${LIVE_CONSENT_PROMPT} ` +
      `This is a live (non-paper) venue and you have not yet acknowledged live trading. ` +
      `Re-run your arm command with ARM (example: /ask ARM or /auto ARM) to acknowledge, then retry.`,
  };
}
