-- ============================================================================
-- Gordon CLI — Money Leg migration
-- Additive + idempotent. Safe to re-run. Run AFTER schema.sql.
--
-- Adds the plan/tier column to activations, plus the columns the webhook needs
-- to (a) stamp the purchased plan onto an issued code and (b) link a
-- subscription back to its activation for revocation.
-- ============================================================================

-- Tier the client can gate on later (returned by the heartbeat).
alter table activations  add column if not exists plan text default 'pro';

-- Purchased plan, stamped on the code at issuance and copied onto the
-- activation when the buyer redeems it.
alter table invite_codes add column if not exists plan text default 'pro';

-- Processor subscription id, set at issuance. Revocation matches
-- invite_codes.subscription_id -> activations.invite_code.
alter table invite_codes add column if not exists subscription_id text;

-- Backfill existing rows so the column is never null for pre-migration data.
update activations  set plan = 'pro' where plan is null;
update invite_codes set plan = 'pro' where plan is null;

-- Fast revocation lookup by subscription.
create index if not exists idx_invite_codes_subscription_id
  on invite_codes(subscription_id);
