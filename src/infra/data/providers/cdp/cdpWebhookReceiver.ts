/**
 * CDP Webhook Receiver
 *
 * Local HTTP listener that accepts incoming CDP webhook POSTs, verifies the
 * X-Hook0-Signature HMAC, and buffers decoded events in a ring buffer the
 * agent can query via tool calls. Turns the Gordon process into a webhook
 * receiver without needing a deployed service.
 *
 * Users still need a public URL for CDP to deliver to — the tools surface
 * ngrok/cloudflared/smee.io guidance via describe_cdp_webhook_setup. Once
 * the tunnel is running, point a CDP subscription at it and Gordon starts
 * receiving real-time events.
 *
 * Signature format (from CDP docs):
 *   Header: X-Hook0-Signature: t=<timestamp>,h=<header_names>,v1=<hmac_hex>
 *   HMAC:   HMAC-SHA256(secret, `${timestamp}.${header_names}.${header_values}.${raw_body}`)
 *   Window: 5 minutes (timestamp freshness check)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("cdp-webhook-receiver");

const MAX_BUFFERED_EVENTS = 500;
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Types
// ============================================================================

export interface BufferedWebhookEvent {
  /** Monotonic auto-increment id, unique per receiver lifetime. */
  id: number;
  /** CDP event id from X-Hook0-Id header. */
  eventId?: string;
  /** When Gordon received the event (ms since epoch). */
  receivedAt: number;
  /** Content of X-Hook0-Signature timestamp claim. */
  cdpTimestamp?: number;
  /** True if the HMAC verified. */
  verified: boolean;
  /** Reason if verification failed. */
  verificationError?: string;
  /** Parsed JSON payload (may be undefined if body wasn't JSON). */
  payload?: unknown;
  /** Raw body text if parsing failed. */
  rawBody?: string;
}

export interface WebhookReceiverStatus {
  running: boolean;
  port: number | null;
  path: string;
  eventCount: number;
  totalReceived: number;
  verifiedCount: number;
  rejectedCount: number;
  startedAt: string | null;
  secretConfigured: boolean;
}

// ============================================================================
// Singleton receiver
// ============================================================================

class CdpWebhookReceiver {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private ringBuffer: BufferedWebhookEvent[] = [];
  private nextId = 1;
  private totalReceived = 0;
  private verifiedCount = 0;
  private rejectedCount = 0;
  private startedAt: number | null = null;
  private signingSecret: string | null = null;
  private pathPrefix = "/cdp-webhook";

  isRunning(): boolean {
    return this.server !== null;
  }

  getStatus(): WebhookReceiverStatus {
    return {
      running: this.server !== null,
      port: this.server?.port ?? null,
      path: this.pathPrefix,
      eventCount: this.ringBuffer.length,
      totalReceived: this.totalReceived,
      verifiedCount: this.verifiedCount,
      rejectedCount: this.rejectedCount,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      secretConfigured: this.signingSecret !== null,
    };
  }

  start(options: { port?: number; path?: string; signingSecret?: string }): { port: number; url: string } {
    if (this.server) {
      throw new Error(`CDP webhook receiver already running on port ${this.server.port}`);
    }
    this.pathPrefix = options.path ?? "/cdp-webhook";
    this.signingSecret = options.signingSecret ?? null;
    this.startedAt = Date.now();

    const requestedPort = options.port ?? 0;
    this.server = Bun.serve({
      port: requestedPort,
      fetch: async (req) => this.handleRequest(req),
    });

    logger.info("CDP webhook receiver started", {
      port: this.server.port,
      path: this.pathPrefix,
      hasSecret: this.signingSecret !== null,
    });

    return {
      port: this.server.port!,
      url: `http://localhost:${this.server.port}${this.pathPrefix}`,
    };
  }

  stop(): boolean {
    if (!this.server) return false;
    this.server.stop(true);
    this.server = null;
    this.startedAt = null;
    logger.info("CDP webhook receiver stopped");
    return true;
  }

  getRecentEvents(limit = 50, onlyVerified = false): BufferedWebhookEvent[] {
    const all = onlyVerified ? this.ringBuffer.filter((e) => e.verified) : this.ringBuffer;
    const start = Math.max(0, all.length - limit);
    return all.slice(start).reverse();
  }

  clearBuffer(): void {
    this.ringBuffer = [];
  }

  // --------------------------------------------------------------------------
  // Request handling
  // --------------------------------------------------------------------------

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === `${this.pathPrefix}/health`) {
      return new Response(JSON.stringify(this.getStatus()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!url.pathname.startsWith(this.pathPrefix) || req.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    this.totalReceived += 1;
    const receivedAt = Date.now();
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("x-hook0-signature") ?? "";
    const eventId = req.headers.get("x-hook0-id") ?? undefined;

    const verification = this.verifySignature(signatureHeader, rawBody, req.headers);

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      payload = undefined;
    }

    const event: BufferedWebhookEvent = {
      id: this.nextId++,
      eventId,
      receivedAt,
      cdpTimestamp: verification.timestamp,
      verified: verification.verified,
      verificationError: verification.error,
      payload,
      rawBody: payload === undefined ? rawBody.slice(0, 2000) : undefined,
    };

    this.ringBuffer.push(event);
    if (this.ringBuffer.length > MAX_BUFFERED_EVENTS) {
      this.ringBuffer.shift();
    }

    if (verification.verified) {
      this.verifiedCount += 1;
    } else {
      this.rejectedCount += 1;
      logger.debug("Webhook signature verification failed", {
        reason: verification.error,
        eventId,
      });
    }

    // Always 200 so CDP doesn't retry — we've accepted responsibility by
    // storing the event, even if signature verification failed.
    return new Response(JSON.stringify({ received: true, id: event.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private verifySignature(
    header: string,
    rawBody: string,
    headers: Headers,
  ): { verified: boolean; timestamp?: number; error?: string } {
    if (!this.signingSecret) {
      return { verified: false, error: "No signing secret configured on receiver" };
    }
    if (!header) {
      return { verified: false, error: "Missing X-Hook0-Signature header" };
    }

    // Header format: t=<ts>,h=<space-separated header names>,v1=<hmac hex>
    const parts: Record<string, string> = {};
    for (const piece of header.split(",")) {
      const [k, ...rest] = piece.trim().split("=");
      if (k) parts[k] = rest.join("=");
    }
    const timestampStr = parts.t;
    const headerNames = parts.h ?? "";
    const providedHex = parts.v1;

    if (!timestampStr || !providedHex) {
      return { verified: false, error: "Malformed X-Hook0-Signature header" };
    }

    const timestampSec = Number(timestampStr);
    if (!Number.isFinite(timestampSec)) {
      return { verified: false, error: "Invalid timestamp in signature" };
    }
    const timestampMs = timestampSec * 1000;
    if (Math.abs(Date.now() - timestampMs) > TIMESTAMP_WINDOW_MS) {
      return {
        verified: false,
        timestamp: timestampMs,
        error: "Timestamp outside 5-minute freshness window",
      };
    }

    // Build the signed payload: timestamp.headerNames.headerValues.rawBody
    const headerValues = headerNames
      .split(/\s+/)
      .filter((name) => name.length > 0)
      .map((name) => headers.get(name.toLowerCase()) ?? "")
      .join(" ");

    const signedPayload = `${timestampStr}.${headerNames}.${headerValues}.${rawBody}`;
    const computed = createHmac("sha256", this.signingSecret).update(signedPayload).digest("hex");

    const providedBuf = Buffer.from(providedHex, "hex");
    const computedBuf = Buffer.from(computed, "hex");
    if (providedBuf.length !== computedBuf.length) {
      return { verified: false, timestamp: timestampMs, error: "Signature length mismatch" };
    }
    const ok = timingSafeEqual(providedBuf, computedBuf);
    return ok
      ? { verified: true, timestamp: timestampMs }
      : { verified: false, timestamp: timestampMs, error: "HMAC verification failed" };
  }
}

// Module-level singleton — one receiver per Gordon process.
const receiver = new CdpWebhookReceiver();

export function getCdpWebhookReceiver(): CdpWebhookReceiver {
  return receiver;
}
