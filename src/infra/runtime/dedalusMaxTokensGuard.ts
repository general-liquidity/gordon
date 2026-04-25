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
          if (clamped !== null) {
            return originalFetch(input, { ...init, body: clamped });
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
 * Cloak Dedalus error noise from stdout / stderr so demos and live
 * sessions don't get interrupted by 400-stack-trace dumps. The errors
 * themselves are still recoverable upstream — Mastra retries or falls
 * back. We just stop them from drowning the terminal.
 *
 * Honors GORDON_SHOW_DEDALUS_ERRORS=1 — set that to debug.
 *
 * Patterns suppressed:
 *  - "Upstream LLM API error from dedalus"
 *  - "AI_APICallError" payload blocks naming dedaluslabs.ai
 *  - bare "{ error: APICallError" trace blocks for the same provider
 */
const DEDALUS_NOISE_PATTERNS = [
  /Upstream LLM API error from dedalus/,
  /api\.dedaluslabs\.ai/,
  /AI_APICallError\b[\s\S]{0,200}dedalus/i,
];

let dedalusBufferActive = false;

function isDedalusNoise(line: string): boolean {
  if (process.env.GORDON_SHOW_DEDALUS_ERRORS === "1") return false;
  return DEDALUS_NOISE_PATTERNS.some((re) => re.test(line));
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
      if (isDedalusNoise(str)) {
        dedalusBufferActive = true;
        return true;
      }
      if (dedalusBufferActive) {
        // Continue suppressing until we see a top-level close brace on
        // its own line (end of the JSON dump) or the buffer drains.
        if (/^\s*\}\s*$/.test(str.trim())) dedalusBufferActive = false;
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
      if (isDedalusNoise(joined)) return;
    } catch {
      // fall through
    }
    originalConsoleError(...args);
  };
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
