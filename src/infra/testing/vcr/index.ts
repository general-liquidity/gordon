/**
 * HTTP record-replay (VCR / cassette) for deterministic integration tests.
 *
 * Gordon's venue adapters and news pipelines hit live HTTP endpoints.
 * That makes their integration tests slow, flaky, and network-dependent.
 * This layer records real outbound HTTP traffic to a JSON cassette once,
 * then replays it deterministically on subsequent runs — the classic
 * Ruby-VCR / Python-vcrpy pattern, ported to Bun + the WHATWG `fetch`
 * surface Gordon already injects in tests.
 *
 * Design constraints (see module CLAUDE.md "Ground rules"):
 *   - SELF-CONTAINED test utility. Nothing here is wired into production
 *     code paths. Code under test receives an INJECTED fetch (preferred)
 *     or opts into a scoped global install that is always reversed.
 *   - NEVER a leaking global monkeypatch. `installGlobal()` returns an
 *     uninstall handle and `withCassette()` always restores the prior
 *     `globalThis.fetch` in a finally block, even on throw.
 *   - SAFE TO COMMIT cassettes: every interaction is redacted at RECORD
 *     time (auth headers, credential-shaped values, planted secrets).
 *
 * Two ways in:
 *   1. `session.fetch` — an injectable fetch with the exact `fetch`
 *      signature. Pass it to the code under test. This mirrors how
 *      Gordon's news/broker code already accepts an injected fetch.
 *   2. `session.installGlobal()` / `withCassette()` — scoped swap of
 *      `globalThis.fetch` for code that calls the global directly,
 *      auto-restored.
 *
 * Modes:
 *   - "replay" (default): match each request against the cassette; an
 *     UNMATCHED request throws loudly (never silently passes through to
 *     the network — that would defeat determinism).
 *   - "record": pass through to the real fetch, persist each redacted
 *     interaction, and write the cassette to disk on `save()`.
 *   - "auto": replay if the cassette exists on disk, else record it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Cassette,
  type Interaction,
  type MatcherConfig,
  type RecordedRequest,
  type RecordedResponse,
  matchesRequest,
  normalizeHeaders,
} from "./cassette.ts";
import { canonicalizeUrl, DEFAULT_MATCHER } from "./cassette.ts";
import { redactBody, redactHeaders } from "./redaction.ts";

export {
  type Cassette,
  type Interaction,
  type MatcherConfig,
  type RecordedRequest,
  type RecordedResponse,
} from "./cassette.ts";
export { VCR_REDACTED, redactBody, redactHeaders, redactPlanted } from "./redaction.ts";

export type VcrMode = "record" | "replay" | "auto";

const DEFAULT_CASSETTE_DIR = join(process.cwd(), "src", "infra", "testing", "vcr", "__cassettes__");

export interface VcrOptions {
  name: string;
  mode?: VcrMode;
  /** Directory cassettes live in. Defaults to a sibling `__cassettes__/`. */
  cassetteDir?: string;
  /** Real fetch used in record/auto-record mode. Defaults to global. */
  realFetch?: typeof fetch;
  matcher?: MatcherConfig;
  /**
   * Literal secret strings to scrub from bodies/urls at record time,
   * on top of the format-based redactor. For per-venue values that
   * aren't credential-shaped (an MT5 login id, an account number).
   */
  plantedSecrets?: readonly string[];
}

/** Thrown when a replayed request has no matching cassette interaction. */
export class VcrNoMatchError extends Error {
  constructor(public readonly request: RecordedRequest, cassetteName: string) {
    super(
      `[vcr] no recorded interaction in cassette "${cassetteName}" for ` +
        `${request.method} ${request.url}` +
        (request.body ? ` (body length ${request.body.length})` : ""),
    );
    this.name = "VcrNoMatchError";
  }
}

export class VcrSession {
  readonly name: string;
  readonly mode: VcrMode;
  private readonly cassettePath: string;
  private readonly realFetch: typeof fetch;
  private readonly matcher: MatcherConfig;
  private readonly plantedSecrets: readonly string[];
  private readonly recordMode: boolean;
  private interactions: Interaction[];
  /** Replay cursor consumption — which recorded interactions were used. */
  private readonly consumed = new Set<number>();
  private dirty = false;

  constructor(opts: VcrOptions) {
    this.name = opts.name;
    const dir = opts.cassetteDir ?? DEFAULT_CASSETTE_DIR;
    this.cassettePath = join(dir, `${opts.name}.json`);
    this.realFetch = opts.realFetch ?? globalThis.fetch;
    this.matcher = opts.matcher ?? {};
    this.plantedSecrets = opts.plantedSecrets ?? [];

    const requested = opts.mode ?? "replay";
    const exists = existsSync(this.cassettePath);
    if (requested === "auto") {
      this.mode = exists ? "replay" : "record";
    } else {
      this.mode = requested;
    }
    this.recordMode = this.mode === "record";

    if (!this.recordMode) {
      if (!exists) {
        throw new Error(
          `[vcr] cassette not found for replay: ${this.cassettePath}. ` +
            `Run with mode "record" or "auto" to create it.`,
        );
      }
      const loaded = JSON.parse(readFileSync(this.cassettePath, "utf8")) as Cassette;
      this.interactions = loaded.interactions ?? [];
    } else {
      this.interactions = [];
    }
  }

  /**
   * The injectable fetch. Bound to this session; safe to pass anywhere a
   * `typeof fetch` is expected. Preferred over `installGlobal`.
   */
  readonly fetch: typeof fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const live = await this.toRecordedRequest(input, init);

    if (this.recordMode) {
      const response = await this.realFetch(input, init);
      await this.recordInteraction(live, response.clone());
      return response;
    }

    for (let i = 0; i < this.interactions.length; i++) {
      if (this.consumed.has(i)) continue;
      const candidate = this.interactions[i];
      if (candidate && matchesRequest(candidate.request, live, this.matcher)) {
        this.consumed.add(i);
        return this.toResponse(candidate.response);
      }
    }
    throw new VcrNoMatchError(live, this.name);
  }) as typeof fetch;

  /**
   * Scoped swap of `globalThis.fetch`. Returns an uninstall handle that
   * restores the previous global. Always pair with uninstall (or use
   * `withCassette`, which does it for you).
   */
  installGlobal(): { uninstall: () => void } {
    const previous = globalThis.fetch;
    globalThis.fetch = this.fetch;
    return {
      uninstall: () => {
        globalThis.fetch = previous;
      },
    };
  }

  /** Persist the cassette to disk. No-op in replay mode. */
  save(): void {
    if (!this.recordMode || !this.dirty) return;
    const cassette: Cassette = {
      version: 1,
      name: this.name,
      recordedAt: new Date().toISOString(),
      interactions: this.interactions,
    };
    mkdirSync(dirname(this.cassettePath), { recursive: true });
    writeFileSync(this.cassettePath, JSON.stringify(cassette, null, 2) + "\n", "utf8");
  }

  /** In-memory interactions (post-redaction in record mode). For tests. */
  getInteractions(): readonly Interaction[] {
    return this.interactions;
  }

  private async toRecordedRequest(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<RecordedRequest> {
    let url: string;
    let method: string;
    let headers: Record<string, string>;
    let body: string | undefined;

    if (typeof input === "string" || input instanceof URL) {
      url = input.toString();
      method = (init?.method ?? "GET").toUpperCase();
      headers = normalizeHeaders(init?.headers as Record<string, string> | Headers | undefined);
      body = await readBody(init?.body);
    } else {
      // Request object.
      url = input.url;
      method = (init?.method ?? input.method ?? "GET").toUpperCase();
      headers = normalizeHeaders(input.headers);
      body = init?.body !== undefined ? await readBody(init.body) : await input.clone().text();
      if (body === "") body = undefined;
    }

    return {
      method,
      url: canonicalizeUrl(
        url,
        this.matcher.ignoreQueryParams ?? DEFAULT_MATCHER.ignoreQueryParams,
      ),
      headers,
      body,
    };
  }

  private async recordInteraction(live: RecordedRequest, response: Response): Promise<void> {
    const request: RecordedRequest = {
      method: live.method,
      url: live.url,
      headers: redactHeaders(live.headers),
      body: redactBody(live.body, this.plantedSecrets),
    };
    const recordedResponse: RecordedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: redactHeaders(normalizeHeaders(response.headers)),
      body: redactBody(await response.text(), this.plantedSecrets) ?? "",
    };
    this.interactions.push({ request, response: recordedResponse });
    this.dirty = true;
  }

  private toResponse(recorded: RecordedResponse): Response {
    return new Response(recorded.body, {
      status: recorded.status,
      statusText: recorded.statusText,
      headers: recorded.headers,
    });
  }
}

async function readBody(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  // Blob / ReadableStream / FormData — best-effort via Response wrapper.
  try {
    return await new Response(body as BodyInit).text();
  } catch {
    return undefined;
  }
}

/**
 * Run `fn` with a VCR session active on the global fetch, restoring the
 * previous global afterwards (even on throw) and saving the cassette in
 * record mode. `fn` also receives the session so it can use the injected
 * `session.fetch` directly when injection is available.
 */
export async function withCassette<T>(
  opts: VcrOptions,
  fn: (session: VcrSession) => Promise<T> | T,
): Promise<T> {
  const session = new VcrSession(opts);
  const handle = session.installGlobal();
  try {
    return await fn(session);
  } finally {
    handle.uninstall();
    session.save();
  }
}
