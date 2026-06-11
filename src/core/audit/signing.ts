/**
 * Audit Chain Signing — Tamper-Evidence for AuditTraces
 *
 * Every saved trace carries three signing fields:
 *
 *   content_hash   — SHA-256 over the canonical JSON of the trace content
 *                    (every field except the signing fields themselves)
 *   prev_signature — the signature of the previously saved trace
 *                    (GENESIS_SIGNATURE for the first trace in the chain)
 *   signature      — HMAC-SHA256(key, content_hash + prev_signature)
 *
 * Together they form a verifiable hash chain: editing a stored trace breaks
 * its content hash, re-signing without the key is infeasible, and deleting
 * or reordering traces breaks the prev_signature links.
 *
 * SCOPE: this is tamper-EVIDENCE for a single-operator tool. The HMAC key
 * lives on the same machine as the data, so anyone with full local access
 * (including the operator) can rewrite the chain and re-sign it. It is NOT
 * third-party non-repudiation — it detects accidental corruption and
 * tampering by processes that don't hold the key.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getGordonDir } from "../../infra/storage/paths.ts";
import type { AuditTrace } from "./types.ts";

/** Explicit key material (hex or any non-empty string). Takes priority. */
export const AUDIT_HMAC_KEY_ENV = "GORDON_AUDIT_HMAC_KEY";
/** Override for where the auto-generated key file lives (tests use this). */
export const AUDIT_HMAC_KEY_PATH_ENV = "GORDON_AUDIT_HMAC_KEY_PATH";
/** prev_signature of the first trace in a chain. */
export const GENESIS_SIGNATURE = "genesis";

const SIGNING_FIELDS = new Set(["content_hash", "prev_signature", "signature"]);

/**
 * Deterministic JSON: sorted object keys, undefined-valued keys dropped.
 * Needed so a trace hashes identically before persistence and after a
 * round-trip through the SQLite store (where absent and undefined converge).
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

/** SHA-256 hex over the canonical trace content (signing fields excluded). */
export function computeTraceContentHash(trace: AuditTrace): string {
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(trace)) {
    if (!SIGNING_FIELDS.has(k)) content[k] = v;
  }
  return createHash("sha256").update(canonicalize(content)).digest("hex");
}

function hmacSignature(key: string, contentHash: string, prevSignature: string): string {
  return createHmac("sha256", key).update(contentHash + prevSignature).digest("hex");
}

/**
 * Return a copy of the trace stamped with content_hash, prev_signature and
 * signature, chained onto `prevSignature`.
 */
export function signTrace(trace: AuditTrace, prevSignature: string, key: string): AuditTrace {
  const contentHash = computeTraceContentHash(trace);
  return {
    ...trace,
    content_hash: contentHash,
    prev_signature: prevSignature,
    signature: hmacSignature(key, contentHash, prevSignature),
  };
}

let ephemeralTestKey: string | null = null;

/**
 * Resolve the HMAC key:
 *   1. GORDON_AUDIT_HMAC_KEY env var
 *   2. key file (GORDON_AUDIT_HMAC_KEY_PATH or ~/.gordon/audit-hmac.key),
 *      auto-generated on first use and persisted with mode 0600
 *      (0600 is best-effort on Windows, which has no POSIX modes)
 *
 * Under `bun test` (NODE_ENV=test) with no explicit env config, a
 * process-local ephemeral key is used so tests never create or read
 * operator key material under ~/.gordon.
 */
export function resolveAuditHmacKey(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[AUDIT_HMAC_KEY_ENV];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const overridePath = env[AUDIT_HMAC_KEY_PATH_ENV];
  if (!overridePath && env.NODE_ENV === "test") {
    if (!ephemeralTestKey) ephemeralTestKey = randomBytes(32).toString("hex");
    return ephemeralTestKey;
  }

  const keyPath = overridePath ?? join(getGordonDir(), "audit-hmac.key");
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath, "utf8").trim();
    if (key.length > 0) return key;
  }
  const generated = randomBytes(32).toString("hex");
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, generated, { mode: 0o600 });
  return generated;
}

export type AuditChainBreakReason =
  | "unsigned_trace"
  | "content_hash_mismatch"
  | "signature_mismatch"
  | "chain_link_mismatch";

export interface AuditChainBreak {
  /** Index into the verified trace array where the chain first broke. */
  index: number;
  traceId: string;
  reason: AuditChainBreakReason;
  detail: string;
}

export type AuditChainVerification =
  | { valid: true; checked: number }
  | { valid: false; checked: number; firstBreak: AuditChainBreak };

/**
 * Verify a chain of traces in storage order. Returns the FIRST broken link.
 *
 * The link check is skipped for the first trace in the array — pruning old
 * traces legitimately removes the head of the chain, so a verification
 * window may start mid-chain. Each trace's own signature is still verified
 * against its claimed prev_signature, so a mid-window splice is detected.
 */
export function verifyAuditChain(
  traces: AuditTrace[],
  key: string = resolveAuditHmacKey(),
): AuditChainVerification {
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i]!;
    const broken = (reason: AuditChainBreakReason, detail: string): AuditChainVerification => ({
      valid: false,
      checked: i,
      firstBreak: { index: i, traceId: trace.trace_id, reason, detail },
    });

    if (!trace.signature || !trace.content_hash || !trace.prev_signature) {
      return broken("unsigned_trace", "trace is missing one or more signing fields");
    }

    const expectedHash = computeTraceContentHash(trace);
    if (expectedHash !== trace.content_hash) {
      return broken(
        "content_hash_mismatch",
        `stored content_hash ${trace.content_hash.slice(0, 12)}… does not match recomputed ${expectedHash.slice(0, 12)}…`,
      );
    }

    const expectedSignature = hmacSignature(key, trace.content_hash, trace.prev_signature);
    if (expectedSignature !== trace.signature) {
      return broken("signature_mismatch", "HMAC signature does not verify with the configured key");
    }

    if (i > 0 && trace.prev_signature !== traces[i - 1]!.signature) {
      return broken(
        "chain_link_mismatch",
        `prev_signature does not match the signature of the preceding trace ${traces[i - 1]!.trace_id}`,
      );
    }
  }
  return { valid: true, checked: traces.length };
}
