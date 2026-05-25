/**
 * Value-Level Secret Redaction.
 *
 * Pure-TS port of reverse-quant's `redaction.py` (MIT). Complements
 * Gordon's existing KEY-based redaction in `observability/structured.ts`
 * (`SECRET_KEY_PATTERN`), which matches field NAMES like `{ api_key: ... }`
 * in structured logs. This module covers the orthogonal path: raw
 * strings that may CONTAIN credential-shaped values regardless of
 * field name (alert payloads, tool error messages, news scrape
 * content, audit metadata blobs).
 *
 * Detection is by value FORMAT, not heuristic: each pattern matches a
 * specific high-confidence shape (Anthropic sk-ant-api… prefix,
 * GitHub gh[pousr]_ prefix, AWS AKIA/ASIA prefix, Slack xoxa/b/p/r/s,
 * JWT three-segment base64url, PEM BEGIN/END blocks, Bearer headers).
 * False positives are cheaper than false negatives here — better to
 * over-redact a public string than under-redact a real secret. The
 * pattern set is intentionally conservative; broad "any 40-character
 * base64-ish string" matchers are deliberately excluded.
 *
 * Integration intent:
 *   - Wrap into `withResultSanitizer` so every tool result string
 *     passes through redaction before it reaches the next agent turn
 *     or the audit log.
 *   - Available as a standalone helper any persistence/log call site
 *     can wrap output through.
 *   - Returns the matched pattern names alongside the redacted text so
 *     callers can surface "credential leak attempt" telemetry without
 *     ever persisting the raw matched value.
 *
 * Pure compute. Stateless. Zero dependencies. Safe to call from any
 * synchronous code path.
 */

export const REDACTION_PLACEHOLDER = "[REDACTED]";

/**
 * Conservative high-confidence credential patterns. Ordered so the
 * AWS secret-access-key pattern (which captures a group) runs before
 * looser patterns that might accidentally match the same surface.
 */
const PATTERNS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
  /**
   * Replacement strategy:
   *   - "full": replace the entire match with REDACTION_PLACEHOLDER
   *   - "group1": replace only capture group 1
   *   - "prefix-preserve": keep the prefix (group 1), redact the rest
   */
  strategy: "full" | "group1" | "prefix-preserve";
}> = [
  // Anthropic API keys — `sk-ant-api01-…`, `sk-ant-api02-…`, etc.
  {
    name: "anthropic_api_key",
    pattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g,
    strategy: "full",
  },
  // OpenAI API keys (including project-scoped `sk-proj-…`).
  {
    name: "openai_api_key",
    pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    strategy: "full",
  },
  // GitHub tokens: ghp_ (personal), gho_ (oauth), ghu_ (user-server),
  // ghs_ (server), ghr_ (refresh).
  {
    name: "github_token",
    pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g,
    strategy: "full",
  },
  // AWS access key IDs — AKIA (long-term) / ASIA (temporary).
  {
    name: "aws_access_key_id",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    strategy: "full",
  },
  // AWS secret access keys — match only when prefixed with an obvious
  // key-name to avoid false positives on arbitrary 40-char strings.
  // Capture group 1 is the secret value itself.
  {
    name: "aws_secret_access_key",
    pattern:
      /(?:aws_secret_access_key|aws_secret|secret_access_key)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    strategy: "group1",
  },
  // Slack tokens: xoxa- / xoxb- / xoxp- / xoxr- / xoxs-.
  {
    name: "slack_token",
    pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    strategy: "full",
  },
  // JWTs — three base64url segments separated by dots. Header begins
  // with `eyJ` (base64 of `{"`).
  {
    name: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    strategy: "full",
  },
  // `Authorization: Bearer <token>` headers. Keep the prefix so the
  // remaining log is still operator-readable.
  {
    name: "bearer_token",
    pattern: /(authorization\s*:\s*bearer\s+)[A-Za-z0-9._-]{16,}/gi,
    strategy: "prefix-preserve",
  },
  // PEM private-key blocks (RSA / EC / DSA / OPENSSH).
  {
    name: "private_key_block",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    strategy: "full",
  },
];

export interface RedactionResult {
  /** The redacted text. */
  text: string;
  /** Names of patterns that matched at least once. Empty when clean. */
  matched: string[];
  /** Total number of redactions applied across all patterns. */
  redactionCount: number;
}

/**
 * Scan `text` for known credential value formats; return the redacted
 * text + the list of pattern names that fired. Idempotent on already-
 * redacted strings (the REDACTION_PLACEHOLDER itself matches none of
 * the patterns).
 */
export function redactValues(text: string): RedactionResult {
  if (!text) return { text, matched: [], redactionCount: 0 };
  let current = text;
  const matched: string[] = [];
  let redactionCount = 0;

  for (const { name, pattern, strategy } of PATTERNS) {
    // Build a fresh regex per pattern to reset stateful matching.
    const re = new RegExp(pattern.source, pattern.flags);
    let n = 0;

    if (strategy === "full") {
      current = current.replace(re, () => {
        n++;
        return REDACTION_PLACEHOLDER;
      });
    } else if (strategy === "group1") {
      current = current.replace(re, (match, secretGroup: string) => {
        n++;
        return match.replace(secretGroup, REDACTION_PLACEHOLDER);
      });
    } else if (strategy === "prefix-preserve") {
      current = current.replace(re, (_match, prefix: string) => {
        n++;
        return `${prefix}${REDACTION_PLACEHOLDER}`;
      });
    }

    if (n > 0) {
      matched.push(name);
      redactionCount += n;
    }
  }

  return { text: current, matched, redactionCount };
}

/**
 * Convenience: redact a string and return only the redacted text.
 * Use this when callers don't care about which patterns matched
 * (most internal usage). The full `redactValues` is preferred when
 * the caller wants to emit a "credential leak attempt" telemetry
 * event with the pattern names.
 */
export function redactString(text: string): string {
  return redactValues(text).text;
}

/**
 * Deep-redact arbitrary structured values. Recurses into objects and
 * arrays; redacts string leaves only. Safe with cycles via the
 * standard `seen` set pattern. Useful when log/audit metadata may
 * contain nested objects with credential-shaped strings buried in
 * them (e.g. webhook payloads, broker API responses).
 *
 * Max depth bounded at 8 to match the existing structured-log convention
 * (`MAX_DEPTH=4` for Axiom, doubled here since this runs locally).
 */
const MAX_DEPTH = 8;
const MAX_ITEMS = 200;

export function redactDeep(value: unknown): unknown {
  return redactDeepInner(value, 0, new WeakSet());
}

function redactDeepInner(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth > MAX_DEPTH) return "[REDACTED_DEPTH_LIMIT]";
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[REDACTED_CYCLE]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((v) => redactDeepInner(v, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value)) {
    if (count++ >= MAX_ITEMS) break;
    out[k] = redactDeepInner(v, depth + 1, seen);
  }
  return out;
}
