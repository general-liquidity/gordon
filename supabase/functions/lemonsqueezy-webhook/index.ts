/**
 * Supabase Edge Function: lemonsqueezy-webhook
 *
 * The paid front door for the invite-code license system. On a successful
 * payment / subscription-created event it mints a single-use code into the
 * existing `invite_codes` table and emails it to the buyer. On
 * cancel / payment-failure / expiry it flips the matching activations to
 * status='revoked' (the client already wipes+exits on the heartbeat 403).
 *
 * The processor is a swappable adapter: this wires the Lemon Squeezy adapter,
 * but the handler consumes a NormalizedEvent, so switching to Stripe means
 * swapping the adapter only.
 *
 * POST /functions/v1/lemonsqueezy-webhook
 * Header: X-Signature: <hex hmac-sha256 of raw body>
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Supabase, auto-injected)
 *   LEMONSQUEEZY_WEBHOOK_SECRET               (webhook signing secret)
 *   LEMONSQUEEZY_ISSUE_EVENTS                 (csv, default subscription_created)
 *   LEMONSQUEEZY_REVOKE_EVENTS                (csv, default cancel/expire/payment_failed)
 *   LEMONSQUEEZY_PLAN_BY_VARIANT              (json map variant_id -> plan)
 *   LEMONSQUEEZY_DEFAULT_PLAN                 (default "pro")
 *   RESEND_API_KEY, RESEND_FROM               (email delivery; see RUNBOOK)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { LemonSqueezyAdapter } from "./adapter.ts";
import {
  handleNormalizedEvent,
  type EmailSender,
  type InviteRow,
  type WebhookDb,
} from "./webhook.ts";

const responseHeaders = {
  "Content-Type": "application/json",
};

function csvEnv(name: string, fallback: string[]): string[] {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function planMapEnv(): Record<string, string> {
  const raw = Deno.env.get("LEMONSQUEEZY_PLAN_BY_VARIANT");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    console.error("[lemonsqueezy-webhook] LEMONSQUEEZY_PLAN_BY_VARIANT is not valid JSON — ignoring.");
    return {};
  }
}

// deno-lint-ignore no-explicit-any
function makeDb(supabase: any): WebhookDb {
  return {
    async insertInviteCode(row: InviteRow): Promise<void> {
      const { error } = await supabase.from("invite_codes").insert({
        code: row.code,
        label: row.label,
        max_uses: row.max_uses,
        expires_at: row.expires_at,
        plan: row.plan,
        subscription_id: row.subscription_id,
      });
      if (error) throw new Error(`invite_codes insert failed: ${error.message}`);
    },

    async revokeBySubscription(subscriptionId: string): Promise<number> {
      // Link: invite_codes.subscription_id (set at issuance) -> activations.invite_code.
      const { data: codes, error: codesError } = await supabase
        .from("invite_codes")
        .select("code")
        .eq("subscription_id", subscriptionId);

      if (codesError) throw new Error(`invite_codes lookup failed: ${codesError.message}`);
      if (!codes || codes.length === 0) return 0;

      const codeList = codes.map((c: { code: string }) => c.code);
      const { data: updated, error: updateError } = await supabase
        .from("activations")
        .update({ status: "revoked" })
        .in("invite_code", codeList)
        .select("id");

      if (updateError) throw new Error(`activations revoke failed: ${updateError.message}`);
      return updated?.length ?? 0;
    },
  };
}

function makeResendSender(): EmailSender {
  return {
    async sendInviteCode(to: string, code: string, plan: string): Promise<void> {
      const apiKey = Deno.env.get("RESEND_API_KEY");
      const from = Deno.env.get("RESEND_FROM") ?? "Gordon <onboarding@resend.dev>";

      // Always log the code so the operator can recover it from function logs
      // if email delivery is unconfigured or fails.
      console.log(`[lemonsqueezy-webhook] issued code ${code} (plan ${plan}) for ${to}`);

      if (!apiKey) {
        // TODO(operator): set RESEND_API_KEY (or swap this for your provider)
        // to enable automatic delivery. Until then, email codes manually from
        // the function logs above.
        console.error(`[lemonsqueezy-webhook] RESEND_API_KEY not set — code ${code} NOT emailed to ${to}.`);
        throw new Error("email provider not configured");
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject: "Your Gordon invite code",
          text:
            `Welcome to Gordon.\n\n` +
            `Your invite code: ${code}\n` +
            `Plan: ${plan}\n\n` +
            `Run Gordon and paste the code when prompted. The code is single-use.\n`,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[lemonsqueezy-webhook] Resend send failed for ${to}: ${res.status} ${detail}`);
        throw new Error(`resend send failed: ${res.status}`);
      }
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const secret = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET") ?? "";

    const adapter = new LemonSqueezyAdapter({
      issueEvents: csvEnv("LEMONSQUEEZY_ISSUE_EVENTS", ["subscription_created"]),
      revokeEvents: csvEnv("LEMONSQUEEZY_REVOKE_EVENTS", [
        "subscription_cancelled",
        "subscription_expired",
        "subscription_payment_failed",
      ]),
      planByVariant: planMapEnv(),
      defaultPlan: Deno.env.get("LEMONSQUEEZY_DEFAULT_PLAN") ?? "pro",
    });

    const event = await adapter.verifyAndParse(rawBody, req.headers, secret);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await handleNormalizedEvent(event, {
      db: makeDb(supabase),
      email: makeResendSender(),
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("lemonsqueezy-webhook error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error." }),
      { status: 500, headers: responseHeaders },
    );
  }
});
