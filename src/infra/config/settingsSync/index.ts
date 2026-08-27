/**
 * Settings Sync — signed, flag-gated cross-machine settings layer.
 *
 * PROBLEM: Gordon's settings are local-file only (see `settingsLayers.ts`).
 * Run the same operator on a desktop and a VPS and the risk limits / venue
 * config drift apart — a money agent with different guardrails per host is a
 * real footgun.
 *
 * THIS MODULE adds an OPTIONAL signed remote layer:
 *   - `pushSettings()` signs a settings snapshot and writes it to a pluggable
 *     remote (the transport is an injected client — no hardcoded vendor).
 *   - `pullSettings()` fetches the snapshot, REJECTS it if the signature is
 *     missing or invalid (never apply unverified remote config to a money
 *     agent), and surfaces any pulled value that would RELAX a safety-critical
 *     limit before it is applied.
 *   - `loadRemoteSyncLayer()` exposes the verified snapshot as a `LayeredSettings`
 *     so `settingsLayers.ts` can slot it into the precedence chain — but ONLY
 *     when `GORDON_SETTINGS_SYNC` is enabled. Default OFF: behavior unchanged.
 *
 * SIGNING reuses the HMAC-SHA256 + canonical-JSON pattern from
 * `core/audit/signing.ts` (Gordon's signed audit chain). Same scope caveat:
 * the key lives on the operator's machines, so this is tamper-EVIDENCE +
 * integrity across the transport, not third-party non-repudiation.
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../../storage/paths.ts";
import type { LayeredSettings } from "../settingsLayers.ts";

// ============================================================================
// Flag + key resolution
// ============================================================================

/** Master flag. Default OFF — when unset the remote layer is never loaded. */
export const SETTINGS_SYNC_FLAG_ENV = "GORDON_SETTINGS_SYNC";
/** HMAC operator key for signing/verifying the snapshot. */
export const SETTINGS_SYNC_KEY_ENV = "GORDON_SETTINGS_SYNC_KEY";

export function isSettingsSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[SETTINGS_SYNC_FLAG_ENV];
  return v === "1" || v === "true";
}

/**
 * Resolve the signing key from config/env. Unlike the audit key, this is NOT
 * auto-generated: a synced snapshot is only meaningful if every host shares
 * the SAME operator key, so a missing key is a hard error on push/pull rather
 * than a silently-minted per-host key that would make every signature invalid.
 */
export function resolveSyncKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[SETTINGS_SYNC_KEY_ENV];
  if (!key || key.length === 0) {
    throw new Error(`settings-sync requires an operator key in ${SETTINGS_SYNC_KEY_ENV}`);
  }
  return key;
}

// ============================================================================
// Snapshot shape + canonical signing
// ============================================================================

export interface SettingsSnapshot {
  /** Schema version for forward-compat. */
  version: 1;
  /** Logical host/origin that produced the snapshot (for audit/debug). */
  origin: string;
  /** Signed timestamp (ms epoch) — drives last-write-wins on conflict. */
  signedAt: number;
  /** The partial settings config to merge as a layer. */
  values: Record<string, unknown>;
  /** HMAC-SHA256 over the canonical content (every field except `signature`). */
  signature: string;
}

/** Snapshot content without the signing field — what we hash. */
export type SnapshotContent = Omit<SettingsSnapshot, "signature">;

/**
 * Deterministic JSON: sorted keys, undefined dropped. Lifted from the audit
 * signing module so a snapshot hashes identically across hosts and after a
 * JSON round-trip through the remote.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(",")}}`;
}

export function computeSnapshotSignature(content: SnapshotContent, key: string): string {
  const hash = createHash("sha256").update(canonicalize(content)).digest("hex");
  return createHmac("sha256", key).update(hash).digest("hex");
}

/** Stamp a content payload with its HMAC signature. */
export function signSnapshot(content: SnapshotContent, key: string): SettingsSnapshot {
  return { ...content, signature: computeSnapshotSignature(content, key) };
}

export type SnapshotVerification =
  | { valid: true }
  | { valid: false; reason: "unsigned" | "signature_mismatch" | "malformed"; detail: string };

/**
 * Verify a snapshot's structure + signature. A snapshot with a missing or
 * wrong signature is REJECTED — `pullSettings` never applies it.
 */
export function verifySnapshot(snapshot: unknown, key: string): SnapshotVerification {
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    typeof (snapshot as SettingsSnapshot).values !== "object" ||
    (snapshot as SettingsSnapshot).values === null ||
    typeof (snapshot as SettingsSnapshot).signedAt !== "number"
  ) {
    return {
      valid: false,
      reason: "malformed",
      detail: "snapshot is not a well-formed settings snapshot",
    };
  }
  const snap = snapshot as SettingsSnapshot;
  if (!snap.signature || snap.signature.length === 0) {
    return { valid: false, reason: "unsigned", detail: "snapshot carries no signature" };
  }
  const { signature: _sig, ...content } = snap;
  const expected = computeSnapshotSignature(content, key);
  if (expected !== snap.signature) {
    return {
      valid: false,
      reason: "signature_mismatch",
      detail: "HMAC signature does not verify with the configured key",
    };
  }
  return { valid: true };
}

// ============================================================================
// Pluggable remote transport
// ============================================================================

/**
 * Transport abstraction — keep the vendor out of this module. Back it with a
 * file URL, an S3-style object, an HTTP endpoint, etc. `getSnapshot` returns
 * `null` when nothing has been pushed yet.
 */
export interface RemoteSettingsClient {
  getSnapshot(): Promise<SettingsSnapshot | null>;
  putSnapshot(snapshot: SettingsSnapshot): Promise<void>;
}

// ============================================================================
// Safety-relax guard
// ============================================================================

/**
 * Safety-critical settings paths (dot-notation into the config object). A
 * pulled change here is never applied silently:
 *   - numeric LIMIT fields: a pulled value that INCREASES the limit (relaxes
 *     it) is flagged/blocked. Tightening is fine.
 *   - identity fields (venue / account type / base currency): ANY change is a
 *     divergence the operator must see.
 *
 * Mirrors the spirit of `GORDON_MEMORY_WRITE_GUARD` (memoryGate.ts): high-trust
 * fields don't get rewritten by a remote without surfacing.
 */
const SAFETY_LIMIT_PATHS: readonly string[] = [
  "risk.maxRiskPerTrade",
  "risk.maxPortfolioAllocation",
  "risk.maxPositionSize",
  "risk.maxLeverage",
  "risk.maxDrawdown",
  "risk.maxDailyLoss",
];

const SAFETY_IDENTITY_PATHS: readonly string[] = [
  "venue",
  "defaultVenue",
  "accountType",
  "baseCurrency",
];

function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export interface SafetyRelaxViolation {
  path: string;
  kind: "limit_relaxed" | "identity_changed";
  current: unknown;
  incoming: unknown;
  detail: string;
}

/**
 * Compare a pulled snapshot's values against the currently-effective config
 * and return every safety-critical change that loosens a guardrail. Empty
 * array = safe to apply.
 */
export function detectSafetyRelaxations(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): SafetyRelaxViolation[] {
  const violations: SafetyRelaxViolation[] = [];

  for (const path of SAFETY_LIMIT_PATHS) {
    const cur = getPath(current, path);
    const inc = getPath(incoming, path);
    if (inc === undefined) continue;
    if (typeof cur === "number" && typeof inc === "number" && inc > cur) {
      violations.push({
        path,
        kind: "limit_relaxed",
        current: cur,
        incoming: inc,
        detail: `remote would raise ${path} from ${cur} to ${inc} (relaxes the limit)`,
      });
    }
  }

  for (const path of SAFETY_IDENTITY_PATHS) {
    const cur = getPath(current, path);
    const inc = getPath(incoming, path);
    if (inc === undefined) continue;
    if (cur !== undefined && cur !== inc) {
      violations.push({
        path,
        kind: "identity_changed",
        current: cur,
        incoming: inc,
        detail: `remote would change ${path} from ${JSON.stringify(cur)} to ${JSON.stringify(inc)}`,
      });
    }
  }

  return violations;
}

// ============================================================================
// Push / Pull
// ============================================================================

export interface PushOptions {
  client: RemoteSettingsClient;
  /** The settings config to publish. */
  values: Record<string, unknown>;
  origin?: string;
  key?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/** Sign `values` and publish them to the remote. */
export async function pushSettings(options: PushOptions): Promise<SettingsSnapshot> {
  const key = options.key ?? resolveSyncKey();
  const content: SnapshotContent = {
    version: 1,
    origin: options.origin ?? process.env.HOSTNAME ?? "unknown",
    signedAt: (options.now ?? Date.now)(),
    values: options.values,
  };
  const snapshot = signSnapshot(content, key);
  await options.client.putSnapshot(snapshot);
  return snapshot;
}

export interface PullOptions {
  client: RemoteSettingsClient;
  key?: string;
  /**
   * Currently-effective config — used by the safety-relax guard. Omit to skip
   * the relax check (e.g. first-ever bootstrap with no local config).
   */
  current?: Record<string, unknown>;
  /**
   * When true, a safety-relax violation BLOCKS the pull (values rejected).
   * When false (default), violations are returned for surfacing but the
   * snapshot is still applied. Mirrors GORDON_MEMORY_WRITE_GUARD's
   * detect-by-default / enforce-on-flag split.
   */
  blockOnRelax?: boolean;
  /** Structured-warning sink (defaults to console.warn). */
  warn?: (msg: string, meta: Record<string, unknown>) => void;
}

export type PullResult =
  | { status: "none" }
  | { status: "rejected"; reason: "unsigned" | "signature_mismatch" | "malformed"; detail: string }
  | { status: "blocked"; violations: SafetyRelaxViolation[] }
  | { status: "ok"; snapshot: SettingsSnapshot; relaxations: SafetyRelaxViolation[] };

/**
 * Fetch + verify a snapshot. REJECTS unsigned/invalid. Surfaces (and optionally
 * blocks on) safety-relaxing changes. Returns the verified snapshot for the
 * caller to apply — this function never mutates global state.
 */
export async function pullSettings(options: PullOptions): Promise<PullResult> {
  const key = options.key ?? resolveSyncKey();
  const warn = options.warn ?? ((m, meta) => console.warn(m, meta));

  const raw = await options.client.getSnapshot();
  if (raw === null) return { status: "none" };

  const verification = verifySnapshot(raw, key);
  if (!verification.valid) {
    warn("REJECTED remote settings snapshot — failed verification", {
      reason: verification.reason,
      detail: verification.detail,
    });
    return { status: "rejected", reason: verification.reason, detail: verification.detail };
  }

  const relaxations = options.current ? detectSafetyRelaxations(options.current, raw.values) : [];

  if (relaxations.length > 0) {
    warn("Remote settings snapshot would RELAX safety-critical field(s)", {
      enforced: Boolean(options.blockOnRelax),
      violations: relaxations.map((v) => v.detail),
    });
    if (options.blockOnRelax) {
      return { status: "blocked", violations: relaxations };
    }
  }

  return { status: "ok", snapshot: raw, relaxations };
}

// ============================================================================
// Local verified-snapshot cache + layer loading
// ============================================================================

/**
 * Where a pulled+verified snapshot is cached locally so the synchronous
 * settings chain (`loadLayeredSettings`) can read it without re-hitting the
 * remote. Overridable for tests.
 */
export const SETTINGS_SYNC_CACHE_PATH_ENV = "GORDON_SETTINGS_SYNC_CACHE_PATH";

export function syncCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return env[SETTINGS_SYNC_CACHE_PATH_ENV] ?? join(GORDON_DIR, "settings.synced.json");
}

/** Persist a verified snapshot to the local cache (mode 0600, best-effort). */
export function writeSyncCache(
  snapshot: SettingsSnapshot,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = syncCachePath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
}

/**
 * Load the synced settings as a `LayeredSettings`, for `settingsLayers.ts` to
 * slot into the precedence chain.
 *
 * Returns `null` (no layer) when:
 *   - the GORDON_SETTINGS_SYNC flag is off (DEFAULT — behavior unchanged), or
 *   - no key is configured, or
 *   - no cached snapshot exists, or
 *   - the cached snapshot fails signature verification.
 *
 * It re-verifies the cache on every load: a money agent must never apply a
 * cached snapshot whose signature no longer checks out (e.g. tampered on disk).
 */
export function loadRemoteSyncLayer(env: NodeJS.ProcessEnv = process.env): LayeredSettings | null {
  if (!isSettingsSyncEnabled(env)) return null;

  const key = env[SETTINGS_SYNC_KEY_ENV];
  if (!key || key.length === 0) return null;

  const path = syncCachePath(env);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }

  const verification = verifySnapshot(parsed, key);
  if (!verification.valid) {
    console.warn("REJECTED cached settings-sync snapshot — failed verification", {
      reason: verification.reason,
      detail: verification.detail,
    });
    return null;
  }

  return {
    layer: "synced",
    values: (parsed as SettingsSnapshot).values,
    source: path,
  };
}
