# Money Leg Runbook — Lemon Squeezy webhook

This bolts a paid front door onto the existing invite-code license system.
Payment succeeds -> a single-use invite code is minted into `invite_codes` and
emailed to the buyer. Subscription cancels/fails/expires -> the matching
`activations` are set to `status='revoked'`, and the client wipes+exits on its
next heartbeat (the existing 403 path — unchanged).

The processor is a swappable adapter (`adapter.ts`, a `verifyAndParse` seam).
Lemon Squeezy is wired today; switching to Stripe means writing a second
adapter with the same seam and swapping it in `index.ts` — the handler
(`webhook.ts`) and DB effects don't change.

## 0. What is / isn't tested

- Unit-tested (bun:test, `webhook.test.ts`, mocked payloads): signature
  verify/reject, event -> NormalizedEvent mapping, purchase -> invite row
  inserted + email sent, email-failure non-fatal, cancel -> activation revoked,
  bad signature -> 401.
- NOT testable without your secrets: the live Supabase insert/update, live
  Resend delivery, and a real Lemon Squeezy webhook hitting the deployed URL.
  Go-live steps below.

## 1. Run the migration

Supabase SQL Editor -> paste `supabase/migrations/0001_money_leg.sql` and run.
It is additive + idempotent (safe to re-run): adds `activations.plan`,
`invite_codes.plan`, `invite_codes.subscription_id`, and a lookup index.

## 2. Deploy the function

```bash
supabase functions deploy lemonsqueezy-webhook
```

The webhook URL to register is:

```
https://<YOUR_PROJECT>.supabase.co/functions/v1/lemonsqueezy-webhook
```

Note: Lemon Squeezy signs the raw body and does not send a Supabase anon key.
If your project enforces JWT on functions, deploy this one with
`--no-verify-jwt` so unauthenticated webhook POSTs reach it (signature is
verified in-function instead):

```bash
supabase functions deploy lemonsqueezy-webhook --no-verify-jwt
```

## 3. Set secrets

```bash
supabase secrets set LEMONSQUEEZY_WEBHOOK_SECRET="<signing secret from LS webhook>"
supabase secrets set RESEND_API_KEY="<resend api key>"
supabase secrets set RESEND_FROM="Gordon <codes@yourdomain.com>"   # verified sender
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Optional tuning:

```bash
# Which events mint a code. Default: subscription_created only.
# For a ONE-TIME license product, use order_created instead (or add it).
# Registering both risks double-issuing for subscription products (both fire).
supabase secrets set LEMONSQUEEZY_ISSUE_EVENTS="subscription_created"

# Which events revoke. Default below.
supabase secrets set LEMONSQUEEZY_REVOKE_EVENTS="subscription_cancelled,subscription_expired,subscription_payment_failed"

# Map purchased variant_id -> plan/tier stamped on the code + activation.
supabase secrets set LEMONSQUEEZY_PLAN_BY_VARIANT='{"555001":"pro","555002":"team"}'

# Fallback plan when the variant isn't in the map.
supabase secrets set LEMONSQUEEZY_DEFAULT_PLAN="pro"
```

Find your `variant_id`s in the Lemon Squeezy dashboard (Products -> Variant ->
the numeric ID in the URL / API). These are the same IDs that arrive in the
webhook payload under `data.attributes.variant_id`.

## 4. Register the webhook in Lemon Squeezy

Dashboard -> Settings -> Webhooks -> New:

- URL: the function URL from step 2.
- Signing secret: the same value you set as `LEMONSQUEEZY_WEBHOOK_SECRET`.
- Events: check `subscription_created`, `subscription_cancelled`,
  `subscription_expired`, `subscription_payment_failed` (match your
  ISSUE/REVOKE env lists).

## 5. Go-live checklist

1. Migration run (step 1).
2. Function deployed (step 2).
3. Secrets set (step 3) — at minimum `LEMONSQUEEZY_WEBHOOK_SECRET`.
4. Webhook registered with the matching signing secret (step 4).
5. Send a test purchase (LS has a test mode). Confirm:
   - a new row in `invite_codes` with `plan` and `subscription_id` set,
   - the buyer received the code email,
   - redeeming the code via the CLI creates an `activation` with the same plan,
   - the heartbeat response includes `plan`.
6. Cancel the test subscription. Confirm the `activation.status` flips to
   `revoked` and the CLI wipes+exits on its next heartbeat.

## Operator notes / caveats

- Email delivery: if `RESEND_API_KEY` is unset, the code is NOT emailed but is
  logged to the function logs (`supabase functions logs lemonsqueezy-webhook`)
  so you can send it manually. Email failure never fails the webhook (a failed
  webhook would be retried and could mint a second code). Swap Resend for any
  provider by editing `makeResendSender` in `index.ts`.
- At-least-once delivery: if the DB insert succeeds but the response is lost,
  Lemon Squeezy retries and a second code may be minted. Acceptable for alpha;
  revisit with an idempotency key (`meta` event id) if it becomes a problem.
- Revoke matching: revocation joins `invite_codes.subscription_id` (stamped at
  issuance) to `activations.invite_code`. A subscription that was never
  redeemed simply revokes 0 activations (the unused code still expires on its
  own TTL, default 30 days).
- Switching to Stripe: add a `StripeAdapter` implementing `ProcessorAdapter`
  (verify `Stripe-Signature`, map `checkout.session.completed` /
  `customer.subscription.deleted` etc. onto `NormalizedEvent`) and swap it in
  `index.ts`. Nothing else changes.
