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
