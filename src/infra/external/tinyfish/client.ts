import { createModuleLogger } from "../../logger/index.ts";
import type {
  TinyfishRunRequest,
  TinyfishRunResponse,
  TinyfishSSEEvent,
} from "./types.ts";

const logger = createModuleLogger("tinyfish-client");

const DEFAULT_BASE_URL = "https://api.tinyfish.ai";

function getTinyfishHeaders(apiKey: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${apiKey}`);
  headers.set("x-api-key", apiKey);
  return headers;
}

function buildTinyfishPayload(input: TinyfishRunRequest): Record<string, unknown> {
  return {
    url: input.url,
    goal: input.goal,
    browserProfile: input.browserProfile,
    proxyCountry: input.proxyCountry,
    allowAuthenticated: input.allowAuthenticated ?? false,
    metadata: input.metadata ?? {},
  };
}

export function summarizeTinyfishResult(payload: unknown): string {
  if (payload == null) return "No Tinyfish result returned.";
  if (typeof payload === "string") return payload.slice(0, 600);
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);

  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const preferred = obj.summary ?? obj.message ?? obj.result ?? obj.data ?? obj.output ?? obj.content;
    if (preferred !== undefined) {
      return summarizeTinyfishResult(preferred);
    }
    return JSON.stringify(obj).slice(0, 600);
  }

  return String(payload).slice(0, 600);
}

export class TinyfishClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;

  constructor(options?: { baseUrl?: string; apiKey?: string; timeoutMs?: number }) {
    this.baseUrl = options?.baseUrl ?? process.env.TINYFISH_BASE_URL ?? DEFAULT_BASE_URL;
    this.apiKey = options?.apiKey ?? process.env.TINYFISH_API_KEY ?? "";
    this.timeoutMs = options?.timeoutMs ?? 120_000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async request(path: string, input: TinyfishRunRequest, extraHeaders?: HeadersInit): Promise<Response> {
    if (!this.isConfigured()) {
      throw new Error("Tinyfish not configured. Set TINYFISH_API_KEY.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        method: "POST",
        headers: getTinyfishHeaders(this.apiKey, extraHeaders),
        body: JSON.stringify(buildTinyfishPayload(input)),
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async run(input: TinyfishRunRequest): Promise<TinyfishRunResponse> {
    const response = await this.request("/run", input);
    const raw = await response.json().catch(async () => ({ message: await response.text() }));

    if (!response.ok) {
      const error = summarizeTinyfishResult(raw);
      logger.warn("Tinyfish run failed", { status: response.status, error });
      return { success: false, status: "failed", error, raw };
    }

    return {
      success: true,
      status: (raw as Record<string, unknown>).status as string | undefined,
      runId: (raw as Record<string, unknown>).runId as string | undefined,
      summary: summarizeTinyfishResult(raw),
      result: (raw as Record<string, unknown>).result ?? (raw as Record<string, unknown>).data ?? raw,
      raw,
    };
  }

  async runAsync(input: TinyfishRunRequest): Promise<TinyfishRunResponse> {
    const response = await this.request("/run-async", input);
    const raw = await response.json().catch(async () => ({ message: await response.text() }));

    if (!response.ok) {
      return {
        success: false,
        status: "failed",
        error: summarizeTinyfishResult(raw),
        raw,
      };
    }

    return {
      success: true,
      status: (raw as Record<string, unknown>).status as string | undefined,
      runId: (raw as Record<string, unknown>).runId as string | undefined,
      summary: summarizeTinyfishResult(raw),
      result: raw,
      raw,
    };
  }

  async *runSSE(input: TinyfishRunRequest): AsyncGenerator<TinyfishSSEEvent, void, unknown> {
    const response = await this.request("/run-sse", input, { accept: "text/event-stream" });
    if (!response.ok || !response.body) {
      const fallback = await response.text().catch(() => "Unknown Tinyfish SSE error");
      throw new Error(`Tinyfish SSE failed: ${fallback}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "message";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("event:")) {
          event = trimmed.slice(6).trim() || "message";
          continue;
        }
        if (trimmed.startsWith("data:")) {
          const raw = trimmed.slice(5).trim();
          let data: unknown = raw;
          try {
            data = JSON.parse(raw);
          } catch {
            // Keep raw string if not JSON.
          }
          yield { event, data, raw };
        }
      }
    }
  }
}
