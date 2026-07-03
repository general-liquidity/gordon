/**
 * Unit tests for the Lemon Squeezy money-leg webhook.
 *
 * These exercise the two Deno-free modules with MOCKED provider payloads and
 * injected DB/email ports. They cannot cover the live Supabase/Resend calls or
 * a registered webhook URL (those need operator secrets — see RUNBOOK.md).
 *
 * Run: bun test supabase/functions/lemonsqueezy-webhook/
 */

import { describe, expect, test } from "bun:test";
import {
  LemonSqueezyAdapter,
  type HeadersLike,
  type NormalizedEvent,
} from "./adapter.ts";
import {
  generateInviteCode,
  handleNormalizedEvent,
  type EmailSender,
  type InviteRow,
  type WebhookDb,
} from "./webhook.ts";

const SECRET = "test_signing_secret";
const encoder = new TextEncoder();

// Compute the real hex HMAC-SHA256 the way Lemon Squeezy signs the raw body.
async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

function headers(map: Record<string, string>): HeadersLike {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

function adapter() {
  return new LemonSqueezyAdapter({
    issueEvents: ["subscription_created"],
    revokeEvents: [
      "subscription_cancelled",
      "subscription_expired",
      "subscription_payment_failed",
    ],
    planByVariant: { "555001": "pro", "555002": "team" },
    defaultPlan: "pro",
  });
}

const subscriptionCreated = (email: string, variantId: number, subId = "sub_123") =>
  JSON.stringify({
    meta: { event_name: "subscription_created" },
    data: {
      type: "subscriptions",
      id: subId,
      attributes: { user_email: email, variant_id: variantId },
    },
  });

const subscriptionCancelled = (subId = "sub_123") =>
  JSON.stringify({
    meta: { event_name: "subscription_cancelled" },
    data: { type: "subscriptions", id: subId, attributes: { user_email: "x@y.com" } },
  });

// Recording test doubles for the injected ports.
function fakeDeps() {
  const inserted: InviteRow[] = [];
  const revoked: string[] = [];
  const emailed: Array<{ to: string; code: string; plan: string }> = [];

  const db: WebhookDb = {
    async insertInviteCode(row) {
      inserted.push(row);
    },
    async revokeBySubscription(subscriptionId) {
      revoked.push(subscriptionId);
      return 1;
    },
  };
  const email: EmailSender = {
    async sendInviteCode(to, code, plan) {
      emailed.push({ to, code, plan });
    },
  };
  return { db, email, inserted, revoked, emailed };
}

describe("LemonSqueezyAdapter.verifyAndParse", () => {
  test("valid purchase event parses to a purchase with mapped plan", async () => {
    const body = subscriptionCreated("buyer@example.com", 555002);
    const sig = await sign(body);
    const event = await adapter().verifyAndParse(body, headers({ "X-Signature": sig }), SECRET);

    expect(event.kind).toBe("purchase");
    if (event.kind !== "purchase") throw new Error("unreachable");
    expect(event.email).toBe("buyer@example.com");
    expect(event.plan).toBe("team");
    expect(event.subscriptionId).toBe("sub_123");
    expect(event.variantId).toBe("555002");
  });

  test("unmapped variant falls back to the default plan", async () => {
    const body = subscriptionCreated("buyer@example.com", 999999);
    const sig = await sign(body);
    const event = await adapter().verifyAndParse(body, headers({ "X-Signature": sig }), SECRET);
    expect(event.kind).toBe("purchase");
    if (event.kind === "purchase") expect(event.plan).toBe("pro");
  });

  test("bad signature is rejected as invalid", async () => {
    const body = subscriptionCreated("buyer@example.com", 555001);
    const event = await adapter().verifyAndParse(
      body,
      headers({ "X-Signature": "deadbeef" }),
      SECRET,
    );
    expect(event.kind).toBe("invalid");
  });

  test("tampered body (signature no longer matches) is rejected", async () => {
    const body = subscriptionCreated("buyer@example.com", 555001);
    const sig = await sign(body);
    const tampered = subscriptionCreated("attacker@example.com", 555002);
    const event = await adapter().verifyAndParse(tampered, headers({ "X-Signature": sig }), SECRET);
    expect(event.kind).toBe("invalid");
  });

  test("missing signature header is rejected", async () => {
    const body = subscriptionCreated("buyer@example.com", 555001);
    const event = await adapter().verifyAndParse(body, headers({}), SECRET);
    expect(event.kind).toBe("invalid");
  });

  test("missing server secret is rejected", async () => {
    const body = subscriptionCreated("buyer@example.com", 555001);
    const sig = await sign(body);
    const event = await adapter().verifyAndParse(body, headers({ "X-Signature": sig }), "");
    expect(event.kind).toBe("invalid");
  });

  test("cancel event parses to a revoke", async () => {
    const body = subscriptionCancelled("sub_777");
    const sig = await sign(body);
    const event = await adapter().verifyAndParse(body, headers({ "X-Signature": sig }), SECRET);
    expect(event.kind).toBe("revoke");
    if (event.kind === "revoke") expect(event.subscriptionId).toBe("sub_777");
  });

  test("unrelated event is ignored", async () => {
    const body = JSON.stringify({ meta: { event_name: "subscription_updated" }, data: { id: "1" } });
    const sig = await sign(body);
    const event = await adapter().verifyAndParse(body, headers({ "X-Signature": sig }), SECRET);
    expect(event.kind).toBe("ignore");
  });
});

describe("handleNormalizedEvent", () => {
  test("valid purchase inserts an invite row and emails the buyer", async () => {
    const deps = fakeDeps();
    const event: NormalizedEvent = {
      kind: "purchase",
      eventName: "subscription_created",
      email: "buyer@example.com",
      plan: "pro",
      subscriptionId: "sub_abc",
      variantId: "555001",
    };
    const now = new Date("2026-07-03T00:00:00.000Z");

    const result = await handleNormalizedEvent(event, {
      ...deps,
      generateCode: () => "GORDON-TEST-CODE-0001",
      codeTtlDays: 30,
      now: () => now,
    });

    expect(result.status).toBe(200);
    expect(result.body.issued).toBe(true);
    expect(result.body.emailed).toBe(true);

    expect(deps.inserted).toHaveLength(1);
    const row = deps.inserted[0]!;
    expect(row.code).toBe("GORDON-TEST-CODE-0001");
    expect(row.max_uses).toBe(1);
    expect(row.plan).toBe("pro");
    expect(row.subscription_id).toBe("sub_abc");
    expect(row.label).toBe("paid:buyer@example.com");
    expect(row.expires_at).toBe("2026-08-02T00:00:00.000Z"); // now + 30d

    expect(deps.emailed).toHaveLength(1);
    expect(deps.emailed[0]).toEqual({
      to: "buyer@example.com",
      code: "GORDON-TEST-CODE-0001",
      plan: "pro",
    });
  });

  test("email failure is non-fatal — code stays issued, response is 200", async () => {
    const deps = fakeDeps();
    const failingEmail: EmailSender = {
      async sendInviteCode() {
        throw new Error("provider down");
      },
    };
    const result = await handleNormalizedEvent(
      {
        kind: "purchase",
        eventName: "subscription_created",
        email: "buyer@example.com",
        plan: "pro",
        subscriptionId: "sub_abc",
        variantId: null,
      },
      { db: deps.db, email: failingEmail, generateCode: () => "GORDON-X" },
    );
    expect(result.status).toBe(200);
    expect(result.body.emailed).toBe(false);
    expect(deps.inserted).toHaveLength(1); // code still persisted
  });

  test("persistence failure surfaces a 500 so the processor retries", async () => {
    const failingDb: WebhookDb = {
      async insertInviteCode() {
        throw new Error("db down");
      },
      async revokeBySubscription() {
        return 0;
      },
    };
    await expect(
      handleNormalizedEvent(
        {
          kind: "purchase",
          eventName: "subscription_created",
          email: "buyer@example.com",
          plan: "pro",
          subscriptionId: null,
          variantId: null,
        },
        { db: failingDb, email: fakeDeps().email },
      ),
    ).rejects.toThrow();
  });

  test("cancel event flips the matching activation to revoked", async () => {
    const deps = fakeDeps();
    const result = await handleNormalizedEvent(
      { kind: "revoke", eventName: "subscription_cancelled", subscriptionId: "sub_777" },
      deps,
    );
    expect(result.status).toBe(200);
    expect(result.body.revoked).toBe(1);
    expect(deps.revoked).toEqual(["sub_777"]);
  });

  test("invalid signature maps to a 401", async () => {
    const result = await handleNormalizedEvent(
      { kind: "invalid", reason: "signature mismatch" },
      fakeDeps(),
    );
    expect(result.status).toBe(401);
  });

  test("ignored event maps to a 200 no-op", async () => {
    const result = await handleNormalizedEvent(
      { kind: "ignore", eventName: "subscription_updated" },
      fakeDeps(),
    );
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe("subscription_updated");
  });
});

describe("generateInviteCode", () => {
  test("produces a GORDON-prefixed, grouped, unique code", () => {
    const a = generateInviteCode();
    const b = generateInviteCode();
    expect(a).toMatch(/^GORDON-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(a).not.toBe(b);
  });
});
