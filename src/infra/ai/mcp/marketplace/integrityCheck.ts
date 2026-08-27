/**
 * Extension integrity check — SHA-256 verification + denylist gate.
 *
 * Before an MCP artifact is allowed to load, verify its bytes against an
 * expected hash and an optional known-bad denylist. Mismatch = block.
 *
 * The marketplace installer applies this to its installed manifest. That
 * detects local tampering and version drift after installation. It does not
 * authenticate code fetched later by a package runner or make an unsigned
 * remote catalog a trust anchor.
 *
 * No network calls — everything is local file IO + crypto.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";

export interface IntegrityCheckRequest {
  /** Absolute path to the file being checked. */
  filePath: string;
  /** SHA-256 hash declared by the catalog for this version. Hex, no prefix. */
  expectedSha256?: string;
  /** Hashes of known-bad versions; checked even when expected matches. */
  denylist?: ReadonlySet<string>;
  /** Maximum file size in bytes to accept. Default 256 MiB. */
  maxFileSizeBytes?: number;
}

export type IntegrityFailureReason =
  | "file_missing"
  | "hash_mismatch"
  | "denylisted"
  | "file_too_large"
  | "read_error";

export interface IntegrityCheckResult {
  ok: boolean;
  /** SHA-256 hex of the file (only set when the file was readable). */
  computedSha256?: string;
  /** Set when ok=false — indicates which check failed. */
  reason?: IntegrityFailureReason;
  /** Human-readable explanation, suitable for surfacing in install prompts. */
  message?: string;
}

const DEFAULT_MAX_FILE_SIZE = 256 * 1024 * 1024;

function normaliseHash(hash: string): string {
  return hash.trim().toLowerCase().replace(/^0x/, "");
}

/**
 * Stream the file through SHA-256. Returns null if the file can't be
 * read (caller will translate this into a structured failure).
 */
async function computeSha256(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Verify a file against the catalog's expected hash + denylist.
 * Pure function — performs file IO only against `request.filePath`.
 */
export async function verifyExtensionIntegrity(
  request: IntegrityCheckRequest,
): Promise<IntegrityCheckResult> {
  const { filePath } = request;

  if (!existsSync(filePath)) {
    return {
      ok: false,
      reason: "file_missing",
      message: `Integrity check failed: file not found at ${filePath}`,
    };
  }

  const maxSize = request.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  let fileSize = 0;
  try {
    const { statSync } = await import("node:fs");
    fileSize = statSync(filePath).size;
  } catch {
    return {
      ok: false,
      reason: "read_error",
      message: `Integrity check failed: unable to stat ${filePath}`,
    };
  }
  if (fileSize > maxSize) {
    return {
      ok: false,
      reason: "file_too_large",
      message: `Integrity check failed: ${fileSize} bytes exceeds the ${maxSize}-byte limit`,
    };
  }

  const computed = await computeSha256(filePath);
  if (!computed) {
    return {
      ok: false,
      reason: "read_error",
      message: `Integrity check failed: could not read ${filePath}`,
    };
  }

  if (request.denylist?.has(computed)) {
    return {
      ok: false,
      reason: "denylisted",
      computedSha256: computed,
      message: `Integrity check failed: SHA-256 ${computed} is on the denylist — refusing to load.`,
    };
  }

  if (request.expectedSha256) {
    const expected = normaliseHash(request.expectedSha256);
    if (computed !== expected) {
      return {
        ok: false,
        reason: "hash_mismatch",
        computedSha256: computed,
        message:
          `Integrity check failed: expected SHA-256 ${expected} but got ${computed}. ` +
          `Possible tamper or version drift — refusing to load.`,
      };
    }
  }

  return { ok: true, computedSha256: computed };
}
