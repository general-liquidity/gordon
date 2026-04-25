/**
 * Dedalus max_tokens guard — global fetch interceptor.
 *
 * Why this exists:
 * Mastra's network() routing creates an internal "routing-agent" via
 * `new Agent({ id, model, ... })` that does NOT inherit the parent
 * agent's defaultOptions / defaultNetworkOptions. When that fresh agent
 * issues a non-streaming generate() against a Dedalus-routed Anthropic
 * model (e.g. Claude Haiku 4.5 for fast-tier compaction/scan/ops
 * phases), Mastra's adapter sets max_tokens to the model's catalog max
 * (100000 for Haiku). Dedalus's Anthropic backend rejects that with
 * `{"code": "streaming_required"}` HTTP 400 and the call fails.
 *
 * We can't reach this internal agent through Mastra's public surface.
 * The bulletproof fix is to clamp max_tokens at the network boundary —
 * any non-streaming POST to api.dedaluslabs.ai/v1/chat/completions with
 * max_tokens above the safe non-stream threshold gets clamped to that
 * threshold before the request leaves the process.
 *
 * Streaming requests (`stream: true` in body) are passed through
 * untouched — they don't hit the threshold at all.
 */

const DEDALUS_HOSTS = new Set(["api.dedaluslabs.ai"]);

/** Anthropic via Dedalus rejects non-streaming above ~21333 tokens. We
 *  pick 16384 to stay comfortably under that ceiling while still allowing
 *  long structured-output / generate responses. */
const NON_STREAM_CAP = 16384;

let installed = false;

export function installDedalusMaxTokensGuard(): void {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  const patchedFetch: typeof fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url && shouldClamp(url) && init?.body && (!init.method || init.method.toUpperCase() === "POST")) {
        const body = init.body;
        if (typeof body === "string") {
          const clamped = clampMaxTokensInBody(body);
          const finalBody = clamped !== null ? clamped : body;
          // Layer the anthropic-beta header on top so the API itself
          // strips old tool_result and thinking blocks in-band before the
          // model reads them. Only sent when the request body names an
          // Anthropic-flavored model.
          const headers = maybeAddAnthropicBetas(init.headers, finalBody);
          if (clamped !== null || headers !== init.headers) {
            return originalFetch(input, { ...init, body: finalBody, headers });
          }
        }
      }
    } catch {
      // Never block a request because of a guard hiccup — fall through.
    }
    return originalFetch(input, init);
  };
  // Preserve the spec-required preconnect helper from the original fetch.
  patchedFetch.preconnect = originalFetch.preconnect.bind(originalFetch);
  globalThis.fetch = patchedFetch;
}

function shouldClamp(url: string): boolean {
  try {
    const u = new URL(url);
    return DEDALUS_HOSTS.has(u.host) && u.pathname.endsWith("/chat/completions");
  } catch {
    return false;
  }
}

/**
 * Parse the JSON body, clamp max_tokens if the call is non-streaming and
 * over cap, and return the re-serialized body. Returns null when no
 * change is needed so the caller can skip the rebuild.
 */
/**
 * Cloak upstream-API error noise from stdout / stderr so demos and live
 * sessions don't get interrupted by 400-stack-trace dumps. The errors
 * themselves are still recoverable upstream — Mastra retries, the
 * exchange clients fall back, etc. We just stop them from drowning the
 * terminal.
 *
 * Two opt-out env knobs:
 *   GORDON_SHOW_DEDALUS_ERRORS=1   — show LLM provider errors again
 *   GORDON_SHOW_BINANCE_ERRORS=1   — show Binance / exchange errors again
 *
 * Categories (independently togglable):
 *  - DEDALUS: 'Upstream LLM API error from dedalus', api.dedaluslabs.ai,
 *    AI_APICallError trace blocks naming the same provider.
 *  - BINANCE: '[time] ERROR/WARN' lines from the Binance client logger
 *    (endpoint URLs containing api.binance.com / fapi.binance.com /
 *    testnet.binance.vision, the literal 'Public API request failed' /
 *    'Signed API request failed' / 'WebSocket' / 'Rate limit' verbs the
 *    binance client emits, and Binance error codes -10xx/-11xx/-20xx).
 */
const DEDALUS_NOISE_PATTERNS = [
  /Upstream LLM API error from dedalus/,
  /api\.dedaluslabs\.ai/,
  /AI_APICallError\b[\s\S]{0,200}dedalus/i,
];

const BINANCE_NOISE_PATTERNS = [
  /api\.binance\.com|fapi\.binance\.com|testnet\.binance\.vision/i,
  /Public API request failed|Signed API request failed/,
  /Failed to get spot balances|Failed to get funding balances|Test order failed/,
  /Rate limit critical - approaching Binance limit/,
  // Binance error codes (signed numeric: -1003 too many requests, -2010
  // insufficient balance, etc.). Match in JSON-context contexts emitted
  // by our logger ("code":-1003) to avoid false-positives in prose.
  /"code":-1\d{3}|"code":-2\d{3}|"msg":"[^"]*Binance/i,
  // WebSocket noise from the binance client.
  /WebSocket connection failed|WebSocket disconnected|Reconnect attempt failed|Pong timeout/,
];

let bufferActive = false;

function isUpstreamNoise(line: string): boolean {
  if (process.env.GORDON_SHOW_DEDALUS_ERRORS !== "1") {
    if (DEDALUS_NOISE_PATTERNS.some((re) => re.test(line))) return true;
  }
  if (process.env.GORDON_SHOW_BINANCE_ERRORS !== "1") {
    if (BINANCE_NOISE_PATTERNS.some((re) => re.test(line))) return true;
  }
  return false;
}

let logsCloaked = false;

export function cloakDedalusErrors(): void {
  if (logsCloaked) return;
  logsCloaked = true;

  // Wrap process.stderr.write — pino / Mastra error logs land here.
  // Dedalus errors arrive as multi-line JSON dumps; once we see a
  // dedalus signature we drop subsequent lines until a blank-ish line
  // closes the block, so the entire trace is suppressed cohesively.
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: any, ...rest: any[]) => {
    try {
      const str = typeof chunk === "string" ? chunk : chunk?.toString?.("utf8") ?? "";
      if (isUpstreamNoise(str)) {
        bufferActive = true;
        return true;
      }
      if (bufferActive) {
        // Continue suppressing until we see a top-level close brace on
        // its own line (end of the JSON dump) or the buffer drains.
        if (/^\s*\}\s*$/.test(str.trim())) bufferActive = false;
        return true;
      }
    } catch {
      // Never break stderr because of a filter hiccup.
    }
    return originalStderrWrite(chunk as any, ...rest);
  }) as typeof process.stderr.write;

  // Wrap console.error too — some Mastra paths use it directly.
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const joined = args
        .map((a) => (typeof a === "string" ? a : (a as any)?.message ?? JSON.stringify(a)))
        .join(" ");
      if (isUpstreamNoise(joined)) return;
    } catch {
      // fall through
    }
    originalConsoleError(...args);
  };
}

/**
 * Anthropic in-band context-management betas (Claude Code parity):
 *  - clear_tool_uses_20250919: API strips Bash/Grep/Read/WebFetch tool_result
 *    bodies in old turns when the prompt approaches the ceiling. No round-
 *    trip cost — happens before the model reads the request.
 *  - clear_thinking_20251015: API strips old thinking blocks for models that
 *    expose them, preserving only the most recent few.
 *
 * Honors GORDON_DISABLE_ANTHROPIC_BETAS=1 to opt out for debugging. */
const ANTHROPIC_BETAS = "clear_tool_uses_20250919,clear_thinking_20251015";

function maybeAddAnthropicBetas(
  existing: HeadersInit | undefined,
  body: string,
): HeadersInit | undefined {
  if (process.env.GORDON_DISABLE_ANTHROPIC_BETAS === "1") return existing;
  if (!isAnthropicBody(body)) return existing;

  const headers = new Headers(existing ?? {});
  // If the caller already set anthropic-beta, append; otherwise create it.
  const prev = headers.get("anthropic-beta");
  const merged = prev && prev.length > 0 ? `${prev},${ANTHROPIC_BETAS}` : ANTHROPIC_BETAS;
  headers.set("anthropic-beta", merged);
  return headers;
}

/** Cheap body sniff — only returns true when the model name looks like an
 *  Anthropic Claude model. Avoids paying for full JSON parse on every
 *  request (we reparse for clamp anyway, but only when needed). */
function isAnthropicBody(body: string): boolean {
  // Quick string prefilter so we don't JSON.parse every request body.
  if (!body.includes("anthropic") && !body.includes("claude")) return false;
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    const model = typeof parsed.model === "string" ? parsed.model.toLowerCase() : "";
    return model.includes("anthropic/") || model.includes("claude");
  } catch {
    return false;
  }
}

function clampMaxTokensInBody(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // Streaming requests are exempt — Dedalus's threshold only applies to
  // non-streaming completion calls.
  if (obj.stream === true) return null;

  const max = obj.max_tokens;
  if (typeof max !== "number" || max <= NON_STREAM_CAP) return null;

  obj.max_tokens = NON_STREAM_CAP;
  return JSON.stringify(obj);
}
