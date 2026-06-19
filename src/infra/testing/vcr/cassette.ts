/**
 * Cassette format + request matching.
 *
 * A cassette is a JSON file recording an ordered list of HTTP
 * interactions (request → response). The format is intentionally plain
 * and stable so cassettes are diff-friendly and safe to commit.
 *
 * Matching is configurable. By default a recorded request matches a live
 * request on method + url + body. A matcher config can ignore volatile
 * fields (timestamp / nonce query params, auth headers) so a replay
 * doesn't break just because the clock moved or a nonce rotated.
 */

export interface RecordedRequest {
  method: string;
  /** Full URL including query string, after volatile-param stripping. */
  url: string;
  /** Normalized (lowercased-key) request headers, post-redaction. */
  headers: Record<string, string>;
  /** Request body as text, or undefined for bodyless requests. */
  body?: string;
}

export interface RecordedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface Interaction {
  request: RecordedRequest;
  response: RecordedResponse;
}

export interface Cassette {
  /** Format version — bump on breaking format changes. */
  version: 1;
  name: string;
  /** ISO timestamp of when the cassette was recorded. Informational. */
  recordedAt: string;
  interactions: Interaction[];
}

export interface MatcherConfig {
  matchMethod?: boolean;
  matchUrl?: boolean;
  matchBody?: boolean;
  /**
   * Query-parameter names to drop from the URL before matching (and
   * before recording). For volatile values like `timestamp`, `nonce`,
   * `_`, `recvWindow`. Case-insensitive.
   */
  ignoreQueryParams?: readonly string[];
}

export const DEFAULT_MATCHER: Required<Omit<MatcherConfig, "ignoreQueryParams">> & {
  ignoreQueryParams: readonly string[];
} = {
  matchMethod: true,
  matchUrl: true,
  matchBody: true,
  ignoreQueryParams: ["timestamp", "nonce", "signature", "recvwindow", "_"],
};

/**
 * Canonicalize a URL for matching/recording: strip configured volatile
 * query params and sort the remaining params so param ordering never
 * affects a match. Non-URL strings are returned untouched.
 */
export function canonicalizeUrl(
  rawUrl: string,
  ignoreQueryParams: readonly string[],
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const ignore = new Set(ignoreQueryParams.map((p) => p.toLowerCase()));
  const kept: Array<[string, string]> = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (!ignore.has(k.toLowerCase())) kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  parsed.search = "";
  for (const [k, v] of kept) parsed.searchParams.append(k, v);
  return parsed.toString();
}

/**
 * Does a recorded interaction match a live request under the given
 * matcher config? URL comparison is on the canonicalized form so both
 * sides have the same volatile params stripped.
 */
export function matchesRequest(
  recorded: RecordedRequest,
  live: RecordedRequest,
  config: MatcherConfig = {},
): boolean {
  const cfg = { ...DEFAULT_MATCHER, ...config };

  if (cfg.matchMethod && recorded.method.toUpperCase() !== live.method.toUpperCase()) {
    return false;
  }
  if (cfg.matchUrl) {
    const a = canonicalizeUrl(recorded.url, cfg.ignoreQueryParams);
    const b = canonicalizeUrl(live.url, cfg.ignoreQueryParams);
    if (a !== b) return false;
  }
  if (cfg.matchBody && (recorded.body ?? "") !== (live.body ?? "")) {
    return false;
  }
  return true;
}

/** Lowercase all header keys for a stable, case-insensitive bag. */
export function normalizeHeaders(
  headers: Headers | Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else {
    for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = String(v);
  }
  return out;
}
