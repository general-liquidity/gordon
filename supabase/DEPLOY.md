# Supabase Setup — Gordon CLI Alpha

## 1. Create Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project URL** and **anon key** from Settings → API

## 2. Run Schema

1. Go to SQL Editor in Supabase Dashboard
2. Paste the contents of `schema.sql` and run it
3. Uncomment the seed INSERT at the bottom to generate invite codes (customize labels)

## 3. Deploy Edge Functions

```bash
# Install Supabase CLI if needed
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy both functions
supabase functions deploy activate
supabase functions deploy heartbeat
```

## 4. Configure CLI

Set these environment variables in `src/infra/license/types.ts` or via env vars:

```
GORDON_LICENSE_URL=https://YOUR_PROJECT.supabase.co
GORDON_LICENSE_KEY=YOUR_ANON_KEY
```

## 5. Generate Invite Codes

In Supabase SQL Editor:

```sql
insert into invite_codes (code, label) values
  ('GORDON-ALPHA-001', 'for_alex'),
  ('GORDON-ALPHA-002', 'for_mike');
```

## 6. Admin Operations

**Revoke a user:**
```sql
update activations set status = 'revoked' where display_name = 'user_name';
```

**Check active users:**
```sql
select display_name, cli_version, last_seen_at, os, arch
from activations where status = 'active'
order by last_seen_at desc;
```

**View telemetry:**
```sql
select a.display_name, e.event_type, e.metadata, e.created_at
from telemetry_events e
join activations a on a.id = e.activation_id
order by e.created_at desc
limit 50;
```
