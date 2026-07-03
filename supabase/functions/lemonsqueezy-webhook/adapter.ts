/**
 * Payment-processor adapter seam.
 *
 * The webhook handler is processor-agnostic: it consumes a NormalizedEvent.
 * Each processor (Lemon Squeezy today, Stripe tomorrow) supplies a thin
 * `verifyAndParse(rawBody, headers, secret)` that verifies the signature and
 * maps the provider payload onto NormalizedEvent. Swap the processor by
 * swapping the adapter in index.ts; the handler and DB effects don't change.
 *
 * This module is intentionally free of Deno / esm.sh imports so it can be
 * unit-tested under bun:test. It uses only Web Crypto (globalThis.crypto),
 * which both Deno and Bun provide.
 */

export type NormalizedEvent =
  | { kind: "invalid"; reason: string }
  | { kind: "ignore"; eventName: string }
  | {
      kind: "purchase";
      eventName: string;
      email: string;
      plan: string;
      subscriptionId: string | null;
      variantId: string | null;
    }
  | { kind: "revoke"; eventName: string; subscriptionId: string };

/** Minimal shape shared by Deno's `Request.headers` and a test double. */
export interface HeadersLike {
  get(name: string): string | null;
}

export interface ProcessorAdapter {
  readonly name: string;
  verifyAndParse(
    rawBody: string,
    headers: HeadersLike,
    secret: string,
  ): Promise<NormalizedEvent>;
}

export interface LemonSqueezyAdapterConfig {
  /** Event names that mint a new invite code (default: subscription_created). */
  issueEvents: string[];
  /** Event names that revoke access. */
  revokeEvents: string[];
  /** Optional variant_id -> plan tier map, e.g. { "123456": "pro" }. */
  planByVariant?: Record<string, string>;
  /** Fallback plan when the variant isn't in the map. */
  defaultPlan?: string;
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Constant-time hex-string compare (avoids leaking via early return). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Lemon Squeezy webhook. The `X-Signature` header is the hex
 * HMAC-SHA256 of the raw request body keyed with the webhook signing secret.
 * The signature MUST be checked against the exact bytes received, not a
 * re-serialized payload.
 */
export async function verifyLemonSqueezySignature(
  rawBody: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = toHex(new Uint8Array(mac));
  return timingSafeEqualHex(expected, signatureHex.trim().toLowerCase());
}

export class LemonSqueezyAdapter implements ProcessorAdapter {
  readonly name = "lemonsqueezy";
  private readonly issueEvents: Set<string>;
  private readonly revokeEvents: Set<string>;
  private readonly planByVariant: Record<string, string>;
  private readonly defaultPlan: string;

  constructor(config: LemonSqueezyAdapterConfig) {
    this.issueEvents = new Set(config.issueEvents);
    this.revokeEvents = new Set(config.revokeEvents);
    this.planByVariant = config.planByVariant ?? {};
    this.defaultPlan = config.defaultPlan ?? "pro";
  }

  async verifyAndParse(
    rawBody: string,
    headers: HeadersLike,
    secret: string,
  ): Promise<NormalizedEvent> {
    if (!secret) return { kind: "invalid", reason: "server missing webhook secret" };

    const signature = headers.get("x-signature") ?? headers.get("X-Signature");
    if (!signature) return { kind: "invalid", reason: "missing signature header" };

    const verified = await verifyLemonSqueezySignature(rawBody, signature, secret);
    if (!verified) return { kind: "invalid", reason: "signature mismatch" };

    let payload: LemonSqueezyPayload;
    try {
      payload = JSON.parse(rawBody) as LemonSqueezyPayload;
    } catch {
      return { kind: "invalid", reason: "malformed json body" };
    }

    const eventName = payload?.meta?.event_name;
    if (typeof eventName !== "string") {
      return { kind: "ignore", eventName: "unknown" };
    }

    if (this.issueEvents.has(eventName)) {
      const attrs = payload.data?.attributes ?? {};
      const email = attrs.user_email ?? attrs.email ?? "";
      if (!email) return { kind: "invalid", reason: "purchase event missing buyer email" };

      const variantId =
        attrs.variant_id != null
          ? String(attrs.variant_id)
          : attrs.first_order_item?.variant_id != null
            ? String(attrs.first_order_item.variant_id)
            : null;

      const subscriptionId =
        payload.data?.type === "subscriptions" && payload.data.id != null
          ? String(payload.data.id)
          : attrs.first_subscription_id != null
            ? String(attrs.first_subscription_id)
            : null;

      const plan =
        (variantId && this.planByVariant[variantId]) || this.defaultPlan;

      return { kind: "purchase", eventName, email, plan, subscriptionId, variantId };
    }

    if (this.revokeEvents.has(eventName)) {
      const subscriptionId =
        payload.data?.id != null ? String(payload.data.id) : "";
      if (!subscriptionId) {
        return { kind: "invalid", reason: "revoke event missing subscription id" };
      }
      return { kind: "revoke", eventName, subscriptionId };
    }

    return { kind: "ignore", eventName };
  }
}

// Loose shape of the slice of the Lemon Squeezy payload we read. The provider
// nests everything under meta / data.attributes (JSON:API style).
interface LemonSqueezyPayload {
  meta?: { event_name?: string; custom_data?: Record<string, unknown> };
  data?: {
    type?: string;
    id?: string | number;
    attributes?: {
      user_email?: string;
      email?: string;
      variant_id?: string | number;
      first_subscription_id?: string | number;
      first_order_item?: { variant_id?: string | number };
    };
  };
}
