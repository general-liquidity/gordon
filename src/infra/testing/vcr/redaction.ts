/**
 * Cassette-time secret redaction.
 *
 * Cassettes are JSON-on-disk snapshots of outbound HTTP traffic that we
 * intend to COMMIT so integration tests stay deterministic. They must
 * therefore never carry live credentials. This module is the redaction
 * boundary applied at RECORD time, before any interaction is written to
 * disk.
 *
 * Two orthogonal layers, both reused from existing Gordon machinery:
 *
 *   1. NAME-based header redaction — auth/credential headers are
 *      identified by header NAME (Authorization, X-Api-Key, Cookie, …)
 *      regardless of value shape. Mirrors `SECRET_KEY_PATTERN` /
 *      `IDENTITY_KEY_PATTERN` in observability/structured.ts. The header
 *      name itself is kept (matchers may legitimately key on which
 *      headers were present), but the value is replaced wholesale.
 *
 *   2. VALUE-based body/url redaction — credential-shaped substrings
 *      (sk-ant-…, JWTs, AWS keys, Bearer tokens, PEM blocks) are caught
 *      by FORMAT regardless of where they sit. Delegates to
 *      `redactString` from observability/valueRedaction.ts so the VCR
 *      layer and the runtime tool-result sanitizer share one pattern set.
 *
 * On top of those two reused layers, a cassette supplies its OWN
 * allowlist-driven planted-secret redactor: explicit literal strings the
 * test author knows are sensitive for this specific venue (an MT5 login,
 * an exchange account id) that wouldn't match a generic format pattern.
 */

import { redactString } from "../../platform/observability/valueRedaction.ts";

export const VCR_REDACTED = "[VCR_REDACTED]";

/**
 * Header names whose VALUE must be redacted before a cassette is
 * persisted. Matched case-insensitively as a substring of the header
 * name, so `x-mt5-account-id` matches via `account`. Sourced from the
 * union of Gordon's secret + identity key patterns, plus HTTP-transport
 * credential carriers (cookie, set-cookie, proxy-authorization).
 */
const SENSITIVE_HEADER_PATTERN =
  /(authorization|api[-_]?key|secret|token|bearer|password|passphrase|credential|signature|cookie|wallet|account|customer|recipient|x-mt5)/i;

export function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_PATTERN.test(name);
}

/**
 * Redact a normalized header bag (lowercased keys → string values).
 * Sensitive headers keep their key but lose their value; non-sensitive
 * header values are still passed through value-format redaction so a
 * credential accidentally placed in a custom header is caught.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeaderName(k) ? VCR_REDACTED : redactString(v);
  }
  return out;
}

/**
 * Redact a request/response body string: format-based value redaction
 * plus any explicit planted secrets the cassette author registered.
 */
export function redactBody(
  body: string | undefined,
  plantedSecrets: readonly string[] = [],
): string | undefined {
  if (body === undefined) return undefined;
  let out = redactString(body);
  out = redactPlanted(out, plantedSecrets);
  return out;
}

/**
 * Replace every occurrence of each allowlisted literal secret with the
 * placeholder. Empty / falsy entries are ignored. Plain literal replace
 * (not regex) so callers don't have to escape anything.
 */
export function redactPlanted(text: string, plantedSecrets: readonly string[]): string {
  let out = text;
  for (const secret of plantedSecrets) {
    if (!secret) continue;
    out = out.split(secret).join(VCR_REDACTED);
  }
  return out;
}
