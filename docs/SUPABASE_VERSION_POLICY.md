# Supabase Version Policy — Schema & Function Changes

Gordon's license heartbeat now accepts a `versionPolicy` field in the response.
This document describes the Supabase-side changes you need to make to start
using forced upgrades, soft prompts, and the kill switch.

The TypeScript side is already wired (see `src/infra/external/license/index.ts`
`enforceVersionPolicy()`). All you have to do on Supabase is:

1. Create the `gordon_version_policy` table
2. Update the `heartbeat` edge function to read it and return it
3. Insert/update rows when you want to push a policy

---

## 1. Table schema

Run this in the Supabase SQL editor:

```sql
create table if not exists public.gordon_version_policy (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Targeting: null = applies to everyone. Otherwise filter by license tag,
  -- channel, or specific user_id (see "scoping" below for advanced use).
  target_tag      text,
  -- Hard floor — clients below this version refuse to start.
  min_version     text,
  -- Soft floor — clients below this show a warning banner.
  recommended_version text,
  -- Emergency stop — when true, all matching clients exit immediately.
  kill_switch     boolean not null default false,
  kill_switch_message text,
  -- Optional auto-deprecation date — past this, recommended becomes min.
  deprecated_after timestamptz,
  -- Optional override for upgrade command shown to user.
  upgrade_command text,
  -- Operator notes (not sent to clients).
  notes           text
);

-- Maintain updated_at on UPDATE
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gordon_version_policy_updated_at on public.gordon_version_policy;
create trigger gordon_version_policy_updated_at
  before update on public.gordon_version_policy
  for each row execute function public.set_updated_at();

-- RLS: only service role can read/write. Heartbeat function uses service key.
alter table public.gordon_version_policy enable row level security;

-- Index for fast lookup by tag
create index if not exists gordon_version_policy_target_tag_idx
  on public.gordon_version_policy (target_tag);
```

---

## 2. Heartbeat function changes

Your existing heartbeat edge function (`functions/heartbeat/index.ts` on the
Supabase side) needs to query the policy table and include it in the response.
Add this **after** your existing license validation logic and **before** you
return the response:

```typescript
// At the top of the function, add the import for the policy type
interface VersionPolicy {
  minVersion?: string;
  recommendedVersion?: string;
  killSwitch?: boolean;
  killSwitchMessage?: string;
  deprecatedAfter?: string;
  upgradeCommand?: string;
}

// After license validation, before returning the response:
async function loadVersionPolicy(supabase: SupabaseClient, licenseTag: string | null): Promise<VersionPolicy | null> {
  // Pick the most recently updated row that matches: either an exact
  // tag match, or a global policy (target_tag IS NULL).
  // Tag-specific rows beat global rows.
  const { data: rows, error } = await supabase
    .from("gordon_version_policy")
    .select("*")
    .or(licenseTag ? `target_tag.eq.${licenseTag},target_tag.is.null` : "target_tag.is.null")
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error || !rows || rows.length === 0) return null;

  // Tag-specific rows take precedence
  const tagSpecific = rows.find((r) => r.target_tag === licenseTag);
  const row = tagSpecific ?? rows[0];

  const policy: VersionPolicy = {};
  if (row.min_version) policy.minVersion = row.min_version;
  if (row.recommended_version) policy.recommendedVersion = row.recommended_version;
  if (row.kill_switch) {
    policy.killSwitch = true;
    if (row.kill_switch_message) policy.killSwitchMessage = row.kill_switch_message;
  }
  if (row.deprecated_after) policy.deprecatedAfter = row.deprecated_after;
  if (row.upgrade_command) policy.upgradeCommand = row.upgrade_command;
  return policy;
}

// Then in your existing handler, after the license is validated:
const versionPolicy = await loadVersionPolicy(supabase, license?.tag ?? null);

return new Response(
  JSON.stringify({
    ok: true,
    announcements: yourExistingAnnouncements,
    ...(versionPolicy ? { versionPolicy } : {}),
  }),
  { headers: { "Content-Type": "application/json" } }
);
```

If your `licenses` table doesn't have a `tag` column, ignore the
tag-targeting and just return the most recent global row.

---

## 3. Rollout recipes

### Force all friends to upgrade to v0.9.0 right now

```sql
insert into public.gordon_version_policy (min_version, notes)
values ('0.9.0', 'Force upgrade — auth bug fix in v0.9.0');
```

Within ~60 seconds (next heartbeat tick) every running Gordon process below
0.9.0 will exit with the upgrade message. New starts on 0.8.x exit during the
license check before TUI loads.

### Soft warning only — recommend v0.9.0 but allow 0.8.x

```sql
insert into public.gordon_version_policy (recommended_version, notes)
values ('0.9.0', 'Recommend 0.9.0 — new feature available');
```

Friends on 0.8.x see a banner on next heartbeat. They keep running.

### Stage a deprecation — soft today, hard in 30 days

```sql
insert into public.gordon_version_policy (recommended_version, deprecated_after, notes)
values (
  '0.9.0',
  (now() + interval '30 days')::timestamptz,
  'Deprecating 0.8.x in 30 days'
);
```

For 30 days they see a banner. After the cutoff, the same row enforces as a
hard floor without intervention.

### Emergency kill switch

```sql
insert into public.gordon_version_policy (kill_switch, kill_switch_message, notes)
values (
  true,
  'Gordon is temporarily disabled while we investigate an exchange API outage. Follow @general_liquidity for updates.',
  'INCIDENT 2026-04-14 — exchange API issue'
);
```

All running Gordons exit on next heartbeat. To resume:

```sql
update public.gordon_version_policy
set kill_switch = false, notes = notes || ' [resolved 2026-04-14 18:30 UTC]'
where kill_switch = true;
```

(Or delete the row.)

### Target a specific friend cohort

```sql
-- Only friends whose license has tag = 'beta'
insert into public.gordon_version_policy (target_tag, min_version, notes)
values ('beta', '0.9.1-beta.5', 'Beta channel — fix for FOOBAR');
```

The heartbeat function picks tag-matching rows over global rows.

---

## 4. Verifying the policy is reaching clients

To confirm a friend's client is actually picking up a policy:

1. Insert a soft `recommended_version` row higher than their current version
2. Watch their heartbeat events table for a `startup` event with the
   `cliVersion` field
3. Within ~60s of their next session start, they should see the banner
4. If they don't, check:
   - Is the heartbeat function actually returning `versionPolicy`? Add
     temporary logging
   - Is their `cliVersion` actually below the recommended? (compare strings)
   - Is `GORDON_SKIP_LICENSE=1` set in their env? (bypasses everything)

The client-side enforcement is in `src/infra/external/license/index.ts`
`enforceVersionPolicy()` if you need to debug the comparison logic.

---

## 5. Operational guardrails

- **Always test on yourself first.** Set a `target_tag` matching your own
  license and test the policy before going broad.
- **Don't set `min_version` to a version that hasn't been published.**
  Friends will be locked out with no upgrade path.
- **Don't combine `min_version` and `kill_switch` in the same row** unless
  you mean to disable everyone. Kill switch wins.
- **Audit the table.** The `notes` column exists for your future self.
  Always fill it in when you push a policy — you will forget why next month.
- **The policy is cached for ~60s on the client side** (one heartbeat
  interval). Don't expect instant propagation. Operations that need
  sub-second response should use a different mechanism (e.g. revoking the
  license token, which takes effect on the next heartbeat too).
