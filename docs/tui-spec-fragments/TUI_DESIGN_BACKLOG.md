# Gordon TUI — Design Backlog

Derived from the 8-lens TUI design review of `src/tui/` on 2026-06-12 (8 parallel design reviewers judging against a best-in-class terminal-product bar: Claude Code, lazygit, k9s — plus a full comparison read of Hermes `ui-tui`). Companion to `PRODUCTION_READINESS.md` (engineering) — this doc is product/design.

**The review's central finding:** the engineering substructure is strong, but the product layer is chat-only. Gordon copied Claude Code's chat-first shape faithfully, while its audience (vibe trader, not terminal-native developer) needs MORE structured UI than Claude Code, not the same. The trader's work product is live state — positions, P&L, approvals, kill switches, radar — and today that exists only as prose scrolling away in chat history.

Lens scores (5 = typical well-built OSS TUI, 8+ = best-in-class): shell/state **7**, design-system **5**, interaction **5**, information architecture **4**, onboarding **6**, trading-UX legibility **6**, rendering **6**, vs-Hermes fitness **7**.

## Locked design decisions (operator, 2026-06-12)

1. **Screen model: HYBRID.** Chat stays inline (terminal scrollback = audit trail; alt-screen kills scrollback/copy/tmux — deliberate divergence from Hermes's fullscreen `?1049` model). The boot moment paints the full initial viewport (no alt-buffer, just content). Alt-screen is reserved for future full-screen overlay views (trade-queue panel, safety dashboard) — lazygit-style: enter, work, return to chat exactly where you were.
2. **Banner: every launch.** Pre-Ink raw-ANSI print (the existing `printBootCard()` trick — zero perceived startup cost). Width-responsive per Hermes `branding.tsx` pattern: full block logo ≥ ~60 cols, compact `GORDON` wordmark below, skipped in ACP/headless/CI/non-TTY.
3. **Boot composition: banner + merged info panel.** The Codex-style session panel (model, thread, cwd, mode) and the trading preflight (venue/connectivity, equity, guards, kill-switches, radar liveness) merge into one composition so all of it sits under the GORDON title.

## P0 — Safety-correctness in the UI (bugs, not features)

- [ ] **1. Permission-mode transition guard** (S) — `App.tsx:~923` dispatches `SET_PERMISSION_MODE` unguarded. Switching ask→auto with a pending approval on screen means the next trade auto-executes. Gate the transition: if `pendingApprovals.length > 0 || isStreaming`, require resolving/cancelling first (or explicitly dismiss + re-evaluate). FSM, not bare dispatch.
- [ ] **2. `/clear` session-reset contract** (M) — no atomic reset of messages + approvals + streaming state + dialog flags exists; users must restart the process. Add `/clear` routed through a `RESET_SESSION` action with confirmation when approvals are pending.
- [ ] **3. Multi-instance collision guard** (S) — two TUI instances on the same resourceId silently share state. Detect (lockfile under `~/.gordon`) and warn/bail on second open.
- [ ] **4. Loud PAPER/LIVE visibility** (S) — mode is a subtle color code. Persistent badge in the status line + prominent banner for 5–10s on startup and on every mode change crossing the paper/live boundary.
- [ ] **5. Kill-switch/halt status line** (S) — armed/tripped state invisible unless queried. Small persistent badge (`[Halt] armed` / red `[HALTED: firm]`) below the header; ties into the boot preflight block.

## P1 — Latency plan (the "Hermes responsiveness" gap)

Why Hermes feels faster: alt-screen fixed-viewport repaints (not adopted — see decision 1), interim tool-progress streaming, constant loader motion. Gordon's measured latency sources: token-per-reconcile streaming, 1:1 EventBus→setState market ticks, 214 independent `useInput` listeners, and the AppInner god component (any dialog toggle reconciles the whole tree).

### Tier 1 — perceived latency (days; biggest felt difference)
- [ ] **6. Keystroke-echo independence** (S) — memo-isolate `PromptInput` so no parent re-render ever delays character echo. The single highest-leverage "feels fast" change.
- [ ] **7. Stream batching** (S) — buffer stream tokens 50–100ms before reconciling (10–20× fewer renders; invisible at reading speed).
- [ ] **8. Interim tool-progress streaming** (M) — replace the mute spinner with Hermes-style progress lines ("Fetching BTC candles… ✓ 2.1s"). Perceived speed + trust.

### Tier 2 — structural (week-scale; overlaps the architecture fix)
- [ ] **9. Evict the 80 dialog `useState` toggles from AppInner** (L) — into a `DialogProvider`/dialog reducer. Simultaneously the god-component fix and the biggest real re-render win. New dialogs become declarative registry entries, not new useState lines.
- [ ] **10. Single FocusContext-routed `useInput`** (M) — one listener dispatching to the active focus owner, replacing 214 independent listeners evaluating every keystroke; eliminates double-fire risk by construction.
- [ ] **11. Market/position event coalescing** (S) — rAF/33ms batching for `position:updated` / price events; `React.memo` on message renderers and position rows.
- [ ] **12. Render budget + enforcement** (S) — use the existing `fpsTracker`: <16ms commit on keystroke, <33ms on stream tick; fail loudly in dev when breached.

### Tier 3 — only if measurement still demands it
- [ ] **13. Revive `ink-custom` framebuffer** (L) — cell-diff in-place updates (the Claude Code renderer architecture, ~80% built, parked by operator decision). Prerequisite: Tiers 1–2 land and `fpsTracker` still shows paint-cost breaches. Known blocker: mount-time cell interleaving bug in `customRender.ts`/`renderNodeToOutput.ts`.

## P2 — Boot composition: GORDON banner + merged preflight panel

- [ ] **14. Block-glyph GORDON banner** (S) — teal `rgb(52,238,176)` to match `GordonHeader`; Hermes `branding.tsx` pattern: width check → full logo / compact wordmark fallback; version + tagline line; pre-Ink raw-ANSI print; suppressed for non-TTY/ACP/headless.
- [ ] **15. Merged session + preflight panel** (M) — single composition under the banner replacing today's boot card:
  - session row: model (+effort), thread id, cwd, permission mode (mode-colored, PAPER loud per item 4)
  - venue row: exchange/broker + paper/live + connectivity check, account equity snapshot
  - safety row: guards installed (fetch ✓ / fs ✓), kill-switches armed/tripped, audit chain ok
  - radar row: producer count live, last card age
  - footer: live BTC/ETH ticker + one contextual hint (rotates; replaces the empty-chat dead air — this IS the welcome feed)
  Static rows print pre-Ink; live rows (connectivity, equity, ticker) hydrate when Ink mounts. Degrade gracefully when offline ("connecting…", never block boot).

## P3 — Information architecture (review's weakest score: 4/10)

- [ ] **16. Workflow command palette** (L) — Ctrl+P; commands from `slashCommands.ts` tagged with a `workflowId` (discover / plan / execute / monitor / safety / system); fuzzy search; renders key-hints inline. Kills the memorize-189-commands problem.
- [ ] **17. Trade-queue panel** (L) — first alt-screen overlay view (per decision 1): pending approvals as risk-sorted cards, open positions with live P&L + per-position risk, radar queue with ack/snooze. The trader's "what needs me right now" surface.
- [ ] **18. Safety dashboard** (M) — second overlay view: armed kill switches, active approval rules, recent denials with reasons, approval velocity. The moat, visible.
- [ ] **19. Actionable radar cards** (M) — in-place key actions on cards (`a`=ack, `p`=pass, `d`=dismiss) instead of read-only cards + typed slash commands.
- [ ] **20. Position risk columns** (S) — `LivePositions` gains RISK (stop distance %, red if stop missing) and ACCOUNT % (capital at risk if stop hits) columns.
- [ ] **21. Workspace visual differentiation** (M) — market/plan/lab/monitor workspaces currently identical; minimum: workspace-tinted header + workspace-scoped palette section.
- [ ] **22. Pager overlay for dense output** (M) — Hermes steal: `< space >` paged display for trade journals, compliance dumps, long tool output, instead of flooding chat scrollback.

## P4 — Onboarding

- [ ] **23. Guided first trade** (M) — post-wizard 1–2 screen walkthrough: `/scan` → pick symbol → `/plan` → **approval-dialog preview** (mock low-risk vs critical, so ask-mode isn't scary). Esc to skip, never shown again.
- [ ] **24. Wire or delete `GordonOnboarding`** (S) — built, never mounted; `SetupWizard` is canonical. Apply the deleted-features discipline: merge its step-N-of-M affordances or delete.
- [ ] **25. `/modes` help page** (S) — the 6-mode matrix (auto/ask/strict/paper/observe/plan) with use-cases; linked from boot hint and `/help`.
- [ ] **26. First-chat welcome feed** (S) — covered by item 15's footer; verify empty-state never renders blank chat.
- [ ] **27. Radar onboarding hint** (S) — one progressive hint explaining what radar cards are and where they appear (currently unexplained anywhere).

## P5 — Component/design-system coherence

- [ ] **28. Semantic color utility layer** (M) — `design-system/colorMap.ts`: `getRiskColor`, `getMoneyColor`, `getSignalColor`, `getAgentColor` as the single source of truth; migrate the **238 hardcoded color call sites** and the 4+ duplicated local risk-color lambdas. The token system (6 themes incl. daltonized) already exists — this makes it real. Highest coherence-per-effort item in the doc.
- [ ] **29. `MultiStepPicker<T>` abstraction** (M) — 5+ pickers (Broker/Exchange/Model…) hand-roll the same cursor/step FSM; `Wizard.tsx` exists and is underused. One generic component, five deletions.
- [ ] **30. Themed primitives actually themed** (S) — `ThemedText`/`ThemedBox` accept semantic tones resolved via `useThemeColor`, not hardcoded `cyanBright`; dialog/pane borders from tokens.
- [ ] **31. Button variant family** (S) — `Button.Primary` / `Button.Danger` / `Button.Success` mapped to theme tokens; resolve the `DiffDialog` name collision.
- [ ] **32. Keybinding hygiene** (M) — conflict detection in the loader (warn which binding wins); inline `<KeyboardHints/>` on every dialog/picker ("Esc cancel · ↑↓ navigate · Enter select"); context-sensitive `?` (approval dialog shows approval keys, not the full browser).
- [ ] **33. Vim-mode decision** (M) — currently advertised globally, works only in PromptInput. Either extend (`useVimKeyboard` hook applying hjkl to any cursor-navigable component) or scope the `[VIM]` indicator to the prompt. Half-modality is worse than either choice.

## Hermes comparison — steal / skip ledger

| Steal | Why |
|---|---|
| Width-responsive banner pattern (`branding.tsx`) | item 14 |
| Pager overlay for long output | item 22 |
| Interim tool-progress streaming | item 8 |
| Command registry modularity (one file per category + registry) | structure for item 16 |
| Indicator-style accessibility config (ascii/unicode spinner choice) | nice-to-have, screen-reader friendly |

| Skip deliberately | Why |
|---|---|
| Fullscreen alt-screen app model (`?1049`) | scrollback is the audit trail; macOS Cmd+C breakage; decision 1 |
| Subagent delegation tree overlay | traders need one accountable agent, not orchestration internals |
| Nanostores distributed state | Gordon's reducer+selectors is sound; the problem is AppInner bypassing it (item 9), not the store model |

## Sequencing

1. **Safety-correctness first:** items 1–5 (P0) — small diffs, real exposure.
2. **Feel-fast week:** items 6–8 + 11–12 (Tier 1 latency + coalescing) — the visceral Hermes-gap closer.
3. **Identity moment:** items 14–15 (banner + preflight boot) — cheap, high product-presence.
4. **The structural pair:** items 9–10 (dialog eviction + FocusContext) — unlocks both latency Tier 2 and IA work.
5. **IA build-out:** items 16–22, with 28 (color layer) running as background hygiene.
6. **Onboarding pass:** items 23–27.
7. **Measure, then decide:** item 13 (framebuffer) only on evidence.
