# Slash Command Pruning Proposal

**Status:** design proposal, no code changes. Decide on cuts; execution is a follow-up project.

**Audited:** 184 unique slash commands across `src/app/slash/slashCommands.ts` (2 commands appear twice in the source — see Duplicates section).

**Headline numbers:**
- **Keep as-is:** 89 commands
- **Merge into another command:** 29
- **Convert to subcommand of an existing top-level:** 36
- **Retire entirely:** 20
- **Investigate further (need operator input):** 12 (see Open Questions)

If executed, the top-level slash menu shrinks from 184 → roughly **70-80 commands** (89 keepers + ~10-15 new top-level "noun" commands that absorb the verb explosions). Tool registry shrinks correspondingly.

---

## 1. Verb explosions → subcommands

These are the **highest-confidence cuts**. Each is a noun with multiple top-level verb commands; they should be one top-level command with subcommands. The `/thread` command already demonstrates the pattern.

### `/runtime <verb>` — collapses 12 → 1

Current top-level: `/runtime`, `/runtime-state`, `/runtime-plugins`, `/runtime-transcript`, `/runtime-scratchpad`, `/runtime-handoffs`, `/runtime-approvals`, `/runtime-approve`, `/runtime-deny`, `/runtime-bridge`, `/runtime-history`, `/rules` (= runtime-rules), `/deny-all` (= runtime-deny-all).

Proposed: keep `/runtime` only. Subcommands: `state`, `plugins`, `transcript`, `scratchpad`, `handoffs`, `approvals`, `approve`, `deny`, `bridge`, `history`, `rules`, `deny-all`.

**Net cut:** -11 top-level commands.

### `/thread <verb>` — collapses 13 → 1

Current top-level: `/thread` (already has subcommands), `/threads`, `/clone`, `/switch`, `/thread-info`, `/delete-thread`, `/rename-thread`, `/log`, `/action-log`, `/bookmark`, `/bookmarks`, `/thread-summary`, `/compact-thread`.

Proposed: keep `/thread` only. Subcommands: `list`, `clone`, `switch`, `info`, `delete`, `rename`, `summary`, `compact`, `log`, `bookmark`, `bookmarks`.

**Net cut:** -12 top-level commands.

### `/strategy <verb>` — collapses 9 → 1

Current top-level: `/strategy`, `/strategies-live`, `/deploy`, `/pause`, `/resume-strategy`, `/stop`, `/rebalance`, `/decay`, `/validate`, `/evolve`.

Keep top-level: `/strategy`, `/deploy`, `/backtest` (the highest-traffic ones).

Proposed: `/strategy` absorbs `strategies-live`, `pause`, `resume-strategy`, `stop`, `rebalance` as `/strategy live|pause|resume|stop|rebalance`. `/decay`, `/validate`, `/evolve` can also fold in but might warrant top-level given their research-loop importance — needs operator input.

**Net cut:** -5 to -8 top-level commands.

### `/goal <verb>` — collapses 4 → 1

Current top-level: `/goal`, `/goal-status`, `/pause-goal`, `/goal-clear`.

Proposed: keep `/goal` only. Subcommands: `status`, `pause`, `clear`.

**Net cut:** -3 top-level commands.

### `/learn <topic>` — collapses 4 → 1

Current top-level: `/learn-radar`, `/learn-finnhub`, `/learn-calibration`, `/best-practices`.

Proposed: introduce `/learn <topic>`. Subcommands: `radar`, `finnhub`, `calibration`, `best-practices`.

**Net cut:** -3 top-level commands.

### `/features <verb>` — collapses 4 → 1

Current top-level: `/features`, `/features-next`, `/pending`, `/answer`.

Proposed: `/features` absorbs `next`. `/pending` and `/answer` are separate-concern (human-input requests), keep `/pending`, fold `/answer` as `/pending answer`.

**Net cut:** -2 top-level commands.

**Verb-explosion subtotal: -36 to -39 top-level commands** (matches the agent's 36 subcommand verdicts).

---

## 2. Near-duplicates → merge

Pick one canonical, retire the other(s).

| Drop | Keep canonical | Rationale |
|---|---|---|
| `/strict`, `/observe`, `/planmode` | All keep — these are distinct trust modes, not duplicates | False alarm; reviewed and confirmed distinct |
| `/setup` | `/configure` | Both are full-config entry points; `/configure` is more discoverable. Keep `/doctor` separate (diagnostics ≠ configuration) |
| `/log` | `/action-log` | Same surface — `/log` is the alias-prone version. `/log` already has alias `["log"]` confusion |
| `/log-panel` | `/action-log` | Panel opens the same view |
| `/session-browser` | `/session` | `/session` already routes to `session-info` with subcommands; `/session-browser` opens the list view |
| `/fast-deep` | `/deep` | Per agent: same depth, redundant verb |
| `/pay` | `/fund` | `/pay` is x402-specific payments, `/fund` is on/off-ramp. Could keep separate but operator overlap is high — **needs review** |
| `/synth` | `/predict` | Both are forecasting; synth is broader market data — could stay distinct |
| `/regime-history` | `/regime` | Subcommand of `/regime` |
| `/privacy` | `/config` privacy | Privacy toggle belongs inside config |

**Conservative merge subtotal: -5 to -8 top-level commands.** (Agent counted 29 merges; many overlap with the verb-explosion subcommand verdicts.)

---

## 3. Cosmetic / debug / panel openers → retire

These either duplicate `/menu` panels or are developer-only tooling that doesn't belong on a daily operator's slash menu.

| Retire | Reason | Migration |
|---|---|---|
| `/theme` | Cosmetic | Move into `/config theme` |
| `/shortcuts` | Help reference | Keep at user discretion; arguably keep |
| `/cache` | Debug-only | Move into `/doctor cache` |
| `/cache-audit` | Debug-only | Move into `/doctor cache audit` |
| `/perf` | Developer profiling | Move into `/doctor perf` |
| `/settings-panel` | Duplicate `/configure` | Retire |
| `/export-panel` | Duplicate `/export` | Retire |
| `/memory-panel` | Settings submenu | Move into `/configure memory` |
| `/context-viz` | Visualization panel | Move into `/context viz` subcommand |
| `/hip3` | HyperLiquid v3 builder-perps; niche | Retire unless operator confirms usage |
| `/debate` | Agent debate viewer; rare | Investigate; likely retire |

**Retire subtotal: -7 to -11 top-level commands.**

---

## 4. Defensible keepers (89 — sample)

Truncated list of high-confidence keepers (full list in the agent's table above):

**Market discovery (10):** `/scan`, `/trending`, `/volume`, `/analyze`, `/whales`, `/breakouts`, `/score`, `/chart`, `/ta`, `/candlestick`

**Trade lifecycle (10):** `/plan`, `/grid`, `/positions`, `/orders`, `/cancel`, `/close`, `/stop-loss`, `/take-profit`, `/watch`, `/alerts`

**Trust modes (7):** `/auto`, `/ask`, `/strict`, `/paper`, `/live`, `/observe`, `/planmode`

**Session control (8):** `/status`, `/resume`, `/new-session`, `/clear`, `/compact`, `/cost`, `/effort`, `/help`

**Recent product surfaces (6):** `/shadow`, `/rate`, `/radar`, `/ack`, `/pass`, `/snooze`

**Portfolio + account (8):** `/portfolio`, `/wallet`, `/fund`, `/earn`, `/history`, `/metrics`, `/risk`, `/withdraw`

**Config (6):** `/configure`, `/doctor`, `/config`, `/keyring`, `/exchange`, `/broker`, `/stocks`, `/model`

**Strategy + research (9):** `/strategy`, `/backtest`, `/optimize`, `/compare`, `/deploy`, `/experiment`, `/evolve`, `/systematic`, `/dataset`

**Quant primitives (8):** `/effective-n`, `/kalman-beta`, `/range-vol`, `/pca-concentration`, `/efficiency-ratio`, `/kama`, `/market-profile`, `/triple-screen`

**Other discovery/menus (~17):** `/menu`, `/chat`, `/market`, `/plans`, `/lab`, `/monitor`, `/skills`, `/hooks`, `/mcp`, `/marketplace`, `/cli`, `/telemetry`, `/context`, `/audit`, `/health`, `/runtime`, `/thread`

---

## 5. Open questions (12 unclear)

Need operator input before deciding. Most likely retire if no current usage:

- `/context-viz` — visualization panel; investigate usage
- `/debate` — agent debate viewer; investigate usage
- `/labs` — experimental feature flags; useful but rare
- `/journal` vs `/reflect` — both about post-trade reflection; could merge
- `/synth` vs `/predict` — both forecasting-related; could merge
- `/pay` vs `/fund` — payment overlap
- `/decay` vs `/validate` vs `/runtime` — strategy lifecycle commands have unclear separation of concerns
- `/research` — agent-based research workflow; high value but rare
- `/rebalance` — strategy verb; could be subcommand

---

## 6. Duplicates in source

The audit reported 186 commands; `grep -u` shows 184 unique names. The 2 duplicates need investigation:

```bash
grep "name: \"" src/app/slash/slashCommands.ts | sort | uniq -d
```

Likely candidates: `/mcp` (appears in both "system menu" and "system tool" sections — confirmed earlier), and possibly `/status` (appears at trading category and again later).

**Action:** the dedup test (`slashCommands.test.ts > does not register the same name twice`) should catch these — if it passes today, both entries are probably gated by `hideFromTypeahead` or one is the canonical and the other a near-name like `status` vs `runtime-status`. Verify before pruning.

---

## 7. Estimated effort + risks

**Effort:** 1-2 focused days to execute, broken into:

1. **Subcommand consolidation (Day 1, morning):** the `/runtime`, `/thread`, `/goal`, `/learn`, `/features` collapses. Mostly mechanical — move command entries into `subcommands` arrays, update the slash dispatcher, update help text. **High mechanical complexity, low logic risk.**

2. **Near-duplicate merges (Day 1, afternoon):** retire `/setup`, `/log`, `/log-panel`, `/session-browser`, `/fast-deep`, `/regime-history`. Each is a single-line removal + a redirect note. **Low complexity, low risk.**

3. **Cosmetic/debug retirements (Day 2, morning):** retire `/theme`, `/cache`, `/cache-audit`, `/perf`, `/settings-panel`, `/export-panel`, `/memory-panel`, `/hip3`. **Low complexity, medium UX risk** — anyone with muscle memory for these gets a "command not found." Mitigate with a migration commit that prints "this command moved to X" for ~1 release.

4. **Test + docs (Day 2, afternoon):** update `slashCommands.test.ts` expectations, update `/help` output, update CLAUDE.md if it references specific commands, update any user-facing docs.

**Risks:**

- **Muscle memory.** Operators (you) have learned current commands. Aggressive renaming triggers friction. **Mitigation:** keep deprecated names as aliases that print a one-line "use `/runtime state` instead" hint for one release before removing.
- **Test churn.** Some tests probably reference specific slash command names. Search and update.
- **Hidden consumers.** Some commands may be invoked programmatically from skills, hooks, or onboarding flows. **Mitigation:** grep `'/<name>'` and `name: "<name>"` references across the repo before retiring anything.
- **The pre-existing slash test failure** (status action = "agent" vs "tool") needs to be resolved before or as part of this work.

---

## 8. Recommended phased rollout

**Phase A (lowest-risk, 2-3 hours):**
- Collapse `/runtime-*` → `/runtime <verb>` — 11 cuts
- Collapse `/goal-*` → `/goal <verb>` — 3 cuts
- Collapse `/learn-*` → `/learn <topic>` — 3 cuts
- Retire pure debug commands: `/cache`, `/cache-audit`, `/perf` — 3 cuts
- Retire panel duplicates: `/settings-panel`, `/export-panel`, `/memory-panel` — 3 cuts

**Cumulative: ~23 top-level commands removed.** No semantic changes, no operator surprises beyond a few months of "command renamed" hints.

**Phase B (medium-risk, half day):**
- Collapse `/thread-*` → `/thread <verb>` — 12 cuts (verify all subcommands work)
- Collapse `/strategy-*` → `/strategy <verb>` — 5 cuts (audit which need to stay top-level)
- Retire `/theme`, `/hip3`, `/debate` after operator confirmation — 3 cuts
- Merge `/log` + `/log-panel` → `/action-log` — 2 cuts
- Merge `/session-browser` → `/session browser` — 1 cut

**Cumulative phase B: ~23 more.**

**Phase C (operator-input gated):**
- Resolve unclear items via operator usage data
- Merge candidates needing review (`/pay` vs `/fund`, `/synth` vs `/predict`, `/journal` vs `/reflect`)

---

## 9. What stays sacred (do not touch)

- `/scan`, `/trending`, `/portfolio`, `/positions`, `/orders`, `/status`, `/menu`, `/help` — most-used commands
- All trust mode commands (`/auto`, `/ask`, `/strict`, `/paper`, `/live`, `/observe`, `/planmode`)
- `/emergency` — safety-critical operator panic button
- `/clear`, `/compact`, `/cost`, `/effort` — session-management essentials
- `/shadow`, `/rate` — recent product surface, friends-build feedback loop
- `/keyring`, `/configure`, `/doctor` — credential and config

---

## 10. Bottom line

Gordon's slash surface accreted over many feature adds without pruning. The verb-explosion patterns are the most fixable (mechanical, low-risk, immediate clarity win). The cosmetic/debug retirements are mostly free wins. The near-duplicate merges need a half-day of judgment but are also tractable.

**The single most valuable cut is the verb-explosion collapse** (Phase A): ~23 commands gone for ~3 hours of work. That alone takes the menu from 184 → ~161 and proves out the migration-with-deprecation-alias pattern for the bigger cuts.

Once Phase A is done and validated, decide Phase B based on how operators (you) reacted to Phase A. Phase C waits for usage data to disambiguate the unclear cases.
