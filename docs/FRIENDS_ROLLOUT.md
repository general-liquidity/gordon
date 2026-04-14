# Friends Rollout Playbook

The minimal procedure for shipping Gordon to a small group of trusted
testers via npm with license-key gating.

## What this gives you

- Friends install with `npm install -g @general-liquidity/gordon-cli@friends`
- First run prompts for an invite code → Supabase issues a license token
- Token cached locally, validated every 60s via heartbeat
- Server can push **forced upgrades**, **soft warnings**, or a **kill switch**
  via the Supabase `gordon_version_policy` table
- Each license is per-machine — friends on multiple machines need multiple codes
- Revoking a friend's access takes effect on their next heartbeat (≤60s)

## Threat model

This is **friends testing**, not public release. Assumptions:

- Friends won't try to reverse-engineer or share the license code
- The bundle is on public npm but the code paths require an active license
- A motivated reverse engineer could read the bundled JS — that's an
  acceptable risk for friends testing
- Anyone who isn't a friend can install the package but can't use it
  (license check blocks before TUI loads)

For stronger protection later (public beta or paid release), the next
escalation is shipping compiled binaries via the existing
`bun build --compile` path — not JavaScript.

---

## Pre-flight checklist

Before tagging the first friends release:

- [ ] On the `friends-rollout-prep` branch
- [ ] `bun run build` succeeds locally
- [ ] `npm run check:no-sourcemaps` passes (no `.map` files in `dist/`)
- [ ] `npm run audit:npm-pack` passes (only whitelisted files in tarball)
- [ ] Supabase `gordon_version_policy` table exists (see SUPABASE_VERSION_POLICY.md)
- [ ] Supabase `heartbeat` function returns `versionPolicy` field
- [ ] `npm/package.json` has `publishConfig.access: "public"` and `tag: "friends"`
- [ ] You have a fresh invite code generated from your Supabase activate function
- [ ] Tested activation flow locally with `GORDON_LICENSE_URL` pointing to your dev project

---

## Tagging the first friends release

Friend releases use a pre-release version tag so they don't pollute the
`@latest` dist-tag on npm:

```bash
# From the friends-rollout-prep branch
git checkout friends-rollout-prep

# Bump version to a friends pre-release
# (or edit package.json directly; the release workflow uses the tag)
git tag v0.9.0-friends.1
git push origin v0.9.0-friends.1
```

The release workflow:

1. Runs tests, source map guardrail, npm pack audit
2. Builds binaries for 5 platforms
3. Uploads binaries to `gordon-cli-dist` GitHub release
4. Updates Homebrew formula and Scoop manifest
5. Publishes to npm with `--tag friends` (because the tag matches `friends|alpha|beta|rc`)

Friends install with:

```bash
npm install -g @general-liquidity/gordon-cli@friends
# or
bun install -g @general-liquidity/gordon-cli@friends
```

`@latest` is not affected — public users running
`npm install -g @general-liquidity/gordon-cli` get whatever is currently
tagged `@latest` (which should be the last stable release, or nothing).

---

## Friends' first run

1. Friend runs `gordon`
2. License gate fires before TUI loads:
   ```
     Gordon CLI — Private Alpha
     ─────────────────────────────
     This build requires an invite code.

     Enter invite code: _
   ```
3. They paste the code you sent them
4. Activation request goes to Supabase, returns a token
5. Token cached at `~/.gordon/license.json` (mode 0o600)
6. Heartbeat starts, version policy enforced if any
7. Privacy consent wizard fires (first run only — see Tier 1 docs)
8. They're in

Subsequent starts: cached token, no prompt, immediate launch.

---

## Updating friends to a new version

### The notify-and-prompt path (default)

1. You publish a new tag: `git tag v0.9.0-friends.2 && git push origin v0.9.0-friends.2`
2. Friends' next start: `update-notifier.ts` polls npm registry (24h cache)
3. They get an interactive prompt: `Update available: v0.9.0-friends.1 → v0.9.0-friends.2  Run now? [Y/n/s]`
4. They press `Y`, the right command runs for their channel

This is the soft path. Friends can defer or skip.

### The forced upgrade path (when you need everyone on a version)

1. Publish the new tag (above)
2. Wait for the npm publish to complete (check the release workflow)
3. In Supabase SQL editor:
   ```sql
   insert into public.gordon_version_policy (min_version, notes)
   values ('0.9.0-friends.2', 'Force upgrade — fixes auth bug from friends.1');
   ```
4. Within ~60 seconds, every running Gordon below 0.9.0-friends.2 exits with:
   ```
     Gordon — update required
     ──────────────────────────────
     Your version: 0.9.0-friends.1
     Required:     0.9.0-friends.2

     Run: gordon --upgrade
   ```
5. Friends run the suggested command and they're back

### Promoting a friends release to stable (public)

When you're ready for a wider audience:

```bash
# Tell npm that the current friends version is now @latest
npm dist-tag add @general-liquidity/gordon-cli@0.9.0-friends.5 latest
```

After this, anyone running `npm install -g @general-liquidity/gordon-cli` gets
`0.9.0-friends.5` even though the tag still has the `-friends.5` suffix.
Cleaner option: tag a stable version and re-publish.

---

## Revoking a friend's access

When a friend leaves the program (or you suspect a leak):

1. Find their license row in your Supabase `licenses` table
2. Set `revoked = true` (or whatever your column is)
3. Their next heartbeat returns 403
4. The client deletes `~/.gordon/license.json` and exits

If they have a long-cached token (TTL_MS = 24h), they'll keep running until
the cache expires OR until their next heartbeat fails. You can shorten this
window by lowering `TOKEN_CACHE_TTL_MS` in `src/infra/external/license/types.ts`.

---

## Emergency procedures

### Kill switch (incident response)

If something is actively going wrong:

```sql
insert into public.gordon_version_policy (kill_switch, kill_switch_message, notes)
values (
  true,
  'Gordon is temporarily paused while we investigate an issue with [exchange]. We will email you when service resumes.',
  'INCIDENT YYYY-MM-DD — describe the issue'
);
```

All friends exit on next heartbeat (≤60s). To resume:

```sql
update public.gordon_version_policy set kill_switch = false where kill_switch = true;
```

### npm package leak

If a friend leaks their license code or shares the package with someone:

1. Revoke their specific license in the `licenses` table
2. **Don't unpublish from npm.** npm's unpublish window is 72h and the
   action is loud. Better: push a `min_version` policy that requires
   tomorrow's release with a new license validation
3. Rotate the Supabase anon key in `src/infra/external/license/types.ts`
   (this requires a new Gordon release — old versions stop working)
4. Optional nuclear option: rotate the Supabase project entirely

### Source code leak via npm

This shouldn't happen because:
- `package.json` `files` field whitelists only the wrapper files
- `scripts/check-no-sourcemaps.cjs` runs in `prepublishOnly` and CI
- `scripts/audit-npm-pack.cjs` runs in CI before publish

If somehow it does:
1. `npm unpublish @general-liquidity/gordon-cli@<bad-version>` (within 72h)
2. After 72h, you can't unpublish — push a deprecation: `npm deprecate @general-liquidity/gordon-cli@<bad-version> "Reason"`
3. Treat the leaked code as public from that point forward

---

## What gets logged about each friend

The heartbeat sends:
- `cliVersion` (e.g. "0.9.0-friends.1")
- `os` (linux/darwin/win32)
- `arch` (x64/arm64)
- `machineId` (random per-install UUID, not a user identifier)
- Batched events (startup, activation, command_invoked, error_occurred — see
  `src/infra/external/license/telemetry.ts` line 11 comment for what's NEVER
  sent)

Friends can see what was collected via `/telemetry export` and wipe their
local state via `/telemetry forget`.

---

## Checklist for the first friend session

When you send the first invite, include this in your message:

> Hey, Gordon alpha access:
>
> 1. Install: `npm install -g @general-liquidity/gordon-cli@friends`
> 2. Run: `gordon`
> 3. When it asks for an invite code, paste: `<their-code>`
> 4. The first screen is a privacy consent wizard — both options default to off
> 5. Try `/help` to see commands, or `/best-practices` for the field guide
> 6. To update later: `gordon --upgrade`
> 7. To wipe local state: `/telemetry forget`
> 8. If anything breaks, send me the output of `/audit-stats` (no PII)

---

## Operational notes

- **Pre-release tags don't get auto-installed.** `npm install -g @general-liquidity/gordon-cli` (no tag) won't pick up `0.9.0-friends.1`. Friends must use `@friends` explicitly.
- **The update-notifier polls `@latest` by default.** If you want friends to be notified about new friends releases, you'll need to extend `update-notifier.ts` to poll `@friends` for them. For now, the heartbeat's forced-upgrade path is the reliable channel.
- **License token caching is generous (24h).** A friend who lost access can keep running for up to 24h. Lower `TOKEN_CACHE_TTL_MS` if you need faster revocation.
- **The privacy consent wizard fires on first run regardless of license state.** Make sure friends know what they're consenting to before they activate.
- **`GORDON_SKIP_LICENSE=1` bypasses the entire license check.** This is for your dev environment only — never tell friends about it.
