/**
 * Web fetch + search service — the thin transport/sanitization layer the
 * `web_fetch` / `web_search` Mastra tools delegate into. Keeps the tool
 * definitions declarative; all network + safety logic lives here.
 *
 * Safety boundary held here (NOT in the tool definitions):
 *   1. Outbound allowlist — every URL passes `enforceOutbound`. In block
 *      mode a miss throws `BlockedOutboundError`; in warn mode it is logged
 *      and allowed (consistent with the rest of Gordon's outbound surface).
 *      This is a MONEY agent reaching the open web — the allowlist is the
 *      exfiltration gate.
 *   2. HTML→text extraction strips <script>/<style>/<noscript> and tags so
 *      no markup (and no script payload) reaches the model.
 *   3. Result cap — extracted text is truncated to the harness offload limit
 *      so a hostile page can't blow the context window.
 *   4. Untrusted-content wrapping — fetched/searched text is wrapped in
 *      `<external_content>` markers (defense-in-depth on top of the
 *      instrumented-tools result sanitizer) so injected instructions inside
 *      page content read as DATA, not commands.
 *
 * The search provider is pluggable + env-keyed — no hardcoded vendor. A
 * generic JSON search endpoint is configured via env; absent config returns
 * a structured "not configured" result instead of throwing.
 */

import { createModuleLogger } from "../../../logger/index.ts";
import { enforceOutbound } from "../../../safety/networkAllowlist.ts";
import { wrapUntrustedContent } from "../../../security/untrustedContent.ts";

const logger = createModuleLogger("web-fetch-service");

/**
 * Result cap for fetched/extracted page text. Mirrors the "raw/noisy
 * protocol output" tier in `runtimeHarness.ts` (TOOL_RESULT_LIMITS) — web
 * pages are low signal-density, so we keep the inline cap modest. The
 * harness spill layer still applies on top; this is the in-service cap so
 * the wrapped block itself is bounded.
 */
export const WEB_FETCH_MAX_CHARS = 8000;

/** Max search results returned regardless of what the provider sends back. */
export const WEB_SEARCH_MAX_RESULTS = 8;

/** Default fetch timeout (ms). */
const DEFAULT_TIMEOUT_MS = 15_000;

// ── env keys for the pluggable search provider ──────────────────────────────
export const WEB_SEARCH_ENDPOINT_ENV = "GORDON_WEB_SEARCH_ENDPOINT";
export const WEB_SEARCH_API_KEY_ENV = "GORDON_WEB_SEARCH_API_KEY";

export interface WebFetchResult {
  ok: boolean;
  url: string;
  /** Resolved host (lowercased). */
  host: string;
  /** Sanitized, capped page text wrapped as untrusted content. */
  content: string;
  /** Raw extracted length before the cap (chars). */
  extractedChars: number;
  /** True when the result was truncated to the cap. */
  truncated: boolean;
  /** HTTP status when the fetch completed. */
  status?: number;
  error?: string;
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  ok: boolean;
  query: string;
  results: WebSearchHit[];
  /** Hits rendered as wrapped untrusted content for the model. */
  untrustedContentBlock: string;
  /** True when no search provider is configured (not an error). */
  notConfigured: boolean;
  error?: string;
}

// ── HTML → text ─────────────────────────────────────────────────────────────

/**
 * Strip markup and script/style payloads, collapse whitespace. Conservative
 * regex extraction — we are NOT building a renderer, just getting readable
 * text and ensuring no executable markup reaches the model. Removing script
 * bodies first means injected JS never lands in context even pre-cap.
 */
export function extractText(html: string): string {
  let text = html;
  // Drop entire script/style/noscript/template element bodies.
  text = text.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Drop HTML comments.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  // Remaining tags → space.
  text = text.replace(/<[^>]+>/g, " ");
  // Common entities.
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Collapse whitespace.
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= WEB_FETCH_MAX_CHARS) return { text, truncated: false };
  return { text: text.slice(0, WEB_FETCH_MAX_CHARS), truncated: true };
}

// ── injectable fetch (tests pass a mock; never hit the real network) ─────────

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json?: () => Promise<unknown>;
}>;

function resolveFetch(injected?: FetchLike): FetchLike {
  if (injected) return injected;
  return globalThis.fetch as unknown as FetchLike;
}

// ── web_fetch ───────────────────────────────────────────────────────────────

export interface WebFetchOptions {
  timeoutMs?: number;
  /** Test seam — inject a mock fetch. Production passes nothing. */
  fetchImpl?: FetchLike;
}

export async function fetchUrl(url: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
  // 1. Allowlist gate. Block mode throws BlockedOutboundError; we convert it
  //    to a structured error result so the agent loop sees a clean signal.
  let host = url;
  try {
    const guard = enforceOutbound({ url, caller: "web_fetch" });
    host = guard.host;
    if (!guard.allowed) {
      // warn mode — log + proceed.
      logger.warn("web_fetch outside allowlist (warn mode)", { host: guard.host, url });
    }
  } catch (e) {
    return {
      ok: false,
      url,
      host: host === url ? extractHostSafe(url) : host,
      content: "",
      extractedChars: 0,
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const doFetch = resolveFetch(opts.fetchImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const resp = await doFetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "gordon-web-fetch/1.0",
        accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
    const raw = await resp.text();
    const extracted = extractText(raw);
    const { text, truncated } = capText(extracted);
    return {
      ok: resp.ok,
      url,
      host: host === url ? extractHostSafe(url) : host,
      content: wrapUntrustedContent(text, `web:${host}`),
      extractedChars: extracted.length,
      truncated,
      status: resp.status,
      ...(resp.ok ? {} : { error: `HTTP ${resp.status}` }),
    };
  } catch (e) {
    return {
      ok: false,
      url,
      host: host === url ? extractHostSafe(url) : host,
      content: "",
      extractedChars: 0,
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractHostSafe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

// ── web_search ──────────────────────────────────────────────────────────────

export interface WebSearchOptions {
  count?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
}

/**
 * Pluggable search. Expects a generic JSON endpoint configured via
 * `GORDON_WEB_SEARCH_ENDPOINT` (the query is appended as `?q=`), authorized
 * with `GORDON_WEB_SEARCH_API_KEY` (Bearer). The endpoint is expected to
 * return `{ results: [{ title, url, snippet }] }` — the common shape across
 * Brave / Serper / Tavily / SearXNG-style APIs, so the operator can point at
 * any of them without a code change. Unrecognized fields are tolerated.
 */
export async function searchWeb(
  query: string,
  opts: WebSearchOptions = {},
): Promise<WebSearchResult> {
  const env = opts.env ?? process.env;
  const endpoint = env[WEB_SEARCH_ENDPOINT_ENV];
  const apiKey = env[WEB_SEARCH_API_KEY_ENV];

  if (!endpoint) {
    return {
      ok: false,
      query,
      results: [],
      untrustedContentBlock: "",
      notConfigured: true,
      error:
        `Web search is not configured. Set ${WEB_SEARCH_ENDPOINT_ENV} (a generic JSON search ` +
        `endpoint returning { results: [{ title, url, snippet }] }) and optionally ` +
        `${WEB_SEARCH_API_KEY_ENV}. No vendor is hardcoded.`,
    };
  }

  const cap = Math.min(opts.count ?? WEB_SEARCH_MAX_RESULTS, WEB_SEARCH_MAX_RESULTS);
  const sep = endpoint.includes("?") ? "&" : "?";
  const requestUrl = `${endpoint}${sep}q=${encodeURIComponent(query)}&count=${cap}`;

  // Allowlist-gate the search endpoint host too.
  try {
    const guard = enforceOutbound({ url: requestUrl, caller: "web_search" });
    if (!guard.allowed) {
      logger.warn("web_search endpoint outside allowlist (warn mode)", { host: guard.host });
    }
  } catch (e) {
    return {
      ok: false,
      query,
      results: [],
      untrustedContentBlock: "",
      notConfigured: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const doFetch = resolveFetch(opts.fetchImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const resp = await doFetch(requestUrl, { signal: controller.signal, headers });
    if (!resp.ok) {
      return {
        ok: false,
        query,
        results: [],
        untrustedContentBlock: "",
        notConfigured: false,
        error: `Search provider returned HTTP ${resp.status}`,
      };
    }
    const body = (resp.json ? await resp.json() : JSON.parse(await resp.text())) as unknown;
    const results = normalizeSearchResults(body).slice(0, cap);
    const untrustedContentBlock = results
      .map((r) => wrapUntrustedContent(`${r.title}\n${r.snippet}`, `search:${safeHost(r.url)}`))
      .join("\n");
    return { ok: true, query, results, untrustedContentBlock, notConfigured: false };
  } catch (e) {
    return {
      ok: false,
      query,
      results: [],
      untrustedContentBlock: "",
      notConfigured: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

/**
 * Tolerant normalizer — accepts `{ results: [...] }`, `{ web: { results } }`,
 * or a bare array, and maps common field aliases (link/href for url,
 * description/content for snippet). Anything unparseable yields [].
 */
export function normalizeSearchResults(body: unknown): WebSearchHit[] {
  let arr: unknown[] = [];
  if (Array.isArray(body)) arr = body;
  else if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.results)) arr = o.results;
    else if (
      o.web &&
      typeof o.web === "object" &&
      Array.isArray((o.web as Record<string, unknown>).results)
    ) {
      arr = (o.web as Record<string, unknown>).results as unknown[];
    }
  }
  const hits: WebSearchHit[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = str(o.url) || str(o.link) || str(o.href);
    if (!url) continue;
    hits.push({
      title: str(o.title) || str(o.name) || url,
      url,
      snippet: str(o.snippet) || str(o.description) || str(o.content) || "",
    });
  }
  return hits;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
