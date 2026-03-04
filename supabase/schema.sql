-- ============================================================================
-- Gordon CLI — Alpha License System Schema
-- Run this in the Supabase SQL Editor after creating your project.
-- ============================================================================

-- Invite codes (generate 10-15 of these for alpha testers)
create table invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  label text,                    -- "for_alex", "for_mike" etc.
  max_uses int default 1,
  current_uses int default 0,
  created_at timestamptz default now(),
  expires_at timestamptz         -- null = never expires
);

-- Activated installs
create table activations (
  id uuid primary key default gen_random_uuid(),
  invite_code text references invite_codes(code),
  machine_id text not null,
  display_name text,
  token text unique not null,
  activated_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  cli_version text,
  os text,
  arch text,
  status text default 'active'  -- active | revoked
);

-- Usage telemetry
create table telemetry_events (
  id bigserial primary key,
  activation_id uuid references activations(id),
  event_type text not null,
  metadata jsonb default '{}',
  cli_version text,
  created_at timestamptz default now()
);

-- RLS: Edge Functions use service_role key, no public access
alter table invite_codes enable row level security;
alter table activations enable row level security;
alter table telemetry_events enable row level security;

-- Index for token lookups
create index idx_activations_token on activations(token);

-- Index for invite code lookups
create index idx_invite_codes_code on invite_codes(code);

-- Atomic invite code claim (prevents race conditions)
create or replace function claim_invite(p_code text)
returns invite_codes as $$
  update invite_codes
  set current_uses = current_uses + 1
  where code = p_code
    and current_uses < max_uses
    and (expires_at is null or expires_at > now())
  returning *;
$$ language sql;

-- Compensating action: rollback a claim if activation insert fails
create or replace function unclaim_invite(p_code text)
returns void as $$
  update invite_codes
  set current_uses = greatest(current_uses - 1, 0)
  where code = p_code;
$$ language sql;

-- Restrict RPC functions to service_role only (prevent anon abuse)
revoke execute on function claim_invite from anon;
revoke execute on function unclaim_invite from anon;

-- ============================================================================
-- Seed: Generate invite codes for alpha testers
-- Uncomment and customize labels as needed.
-- ============================================================================

-- insert into invite_codes (code, label) values
--   ('GORDON-ALPHA-001', 'for_friend_1'),
--   ('GORDON-ALPHA-002', 'for_friend_2'),
--   ('GORDON-ALPHA-003', 'for_friend_3'),
--   ('GORDON-ALPHA-004', 'for_friend_4'),
--   ('GORDON-ALPHA-005', 'for_friend_5'),
--   ('GORDON-ALPHA-006', 'for_friend_6'),
--   ('GORDON-ALPHA-007', 'for_friend_7'),
--   ('GORDON-ALPHA-008', 'for_friend_8'),
--   ('GORDON-ALPHA-009', 'for_friend_9'),
--   ('GORDON-ALPHA-010', 'for_friend_10');
