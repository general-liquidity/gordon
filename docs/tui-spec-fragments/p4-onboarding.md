# P4 — Onboarding (Items 23–27)

Anchors verified against the tree on 2026-06-12 (branch `cleanup-integrations`). Conventions the implementer must follow: `.ts`/`.tsx` extensions on relative imports; co-located `*.test.ts` with bun:test; typecheck = `bun tsc --noEmit -p tsconfig.json`; NEVER run bare `bun test` (sweeps vendored repos) — scope as `bun test src/tui` / `bun test src/app`; TUI state changes go through the reducer (`src/tui/state/types.ts` + `reducer.ts`), not new `useState` in `App.tsx`; the 22-tool agent surface is untouched by all five items (these are pure TUI/app-layer changes).

---

### Item 23 — Guided first trade (M, P4)

**Current state:**
- `SetupWizard` is the only onboarding surface, mounted as a full-screen early-return at `src/tui/App.tsx:1456` (`if (showSetup) { return <SetupWizard .../> }`). Its `onComplete` tail dispatches `{ type: "SET_SHOW_SETUP", show: false }` (App.tsx:1652) and an `ADD_MESSAGE` "Setup complete — … Try /scan to see what's moving." (App.tsx:1653–1665).
- First-run detection: the provider gate at App.tsx:795–806 opens the wizard when no LLM provider is configured. Session counting lives in `src/app/setup/onboarding/versionReset.ts` — `OnboardingState` (line 23) persisted to `~/.gordon/onboarding-state.json` (`GORDON_HOME`-overridable via `src/infra/storage/paths.ts:20`), `incrementSessionCount()` (line 102) called once per session from the hints effect at App.tsx:850.
- `ApprovalDialog` (`src/tui/components/dialogs/ApprovalDialog.tsx`): `ApprovalRequest` interface at line 28 (`id`, `shortId`, `toolName`, `permissionScope`, `riskClass: "low"|"medium"|"high"|"critical"`, `sideEffectLevel`, `reason?`, `riskReasons?`, `counterOffer?`); exported `buildApprovalOptions(approval, opts)` at line 57 builds the option labels (counter-offer first, `CONFIRM (CRITICAL)` variants, no "always" on critical). Critical variant has a 3-second countdown + interactive `useInput` (line 174–223). App.tsx:1855–1865 renders only ONE live ApprovalDialog at a time precisely because multiple mounted `useInput`/Select listeners double-fire Enter.
- No guided first trade exists anywhere; after setup the user lands in an empty chat.

**Problem:** A vibe trader who just finished the wizard has never seen the approval dialog — the product's core safety interaction — and meets it for the first time with real (or paper) money on the line. One 2-screen tour converts "ask mode is scary friction" into "ask mode is the guardrail."

**Spec:**

State + persistence:
- Extend `OnboardingState` (versionReset.ts) with `firstTradeTourDone: boolean`; add `firstTradeTourDone: false` to `DEFAULT_STATE`. The spread-merge in `loadOnboardingState()` already defaults missing fields — no migration needed.
- New pure module `src/app/setup/onboarding/firstTradeTour.ts`:
  ```ts
  import { loadOnboardingState, saveOnboardingState, type OnboardingState } from "./versionReset.ts";

  /** True exactly when the tour should mount: never completed/skipped, and the setup wizard is not on screen. */
  export function shouldShowFirstTradeTour(state: OnboardingState, showSetup: boolean): boolean;
  // → !state.firstTradeTourDone && !showSetup

  /** Persist never-show-again (both completion and Esc-skip call this). */
  export function markFirstTradeTourDone(): void;
  ```
  Note: do NOT gate on `sessionCount <= 1`. The flag alone is the trigger — every install that predates this feature sees the tour exactly once, which is intended (the approval education is new content). Re-export both functions plus the field from `src/app/setup/onboarding/index.ts`.
- TUI state: add to `AppState` (src/tui/state/types.ts, "UI" block next to `showSetup` at line 114): `showFirstTradeTour: boolean;` — `INITIAL_STATE` value `false`. New action following the existing `SET_SHOW_*` convention:
  ```ts
  | { type: "SET_SHOW_FIRST_TRADE_TOUR"; show: boolean }
  ```
  Reducer case in `src/tui/state/reducer.ts` next to `SET_SHOW_SETUP` (line 113): `return { ...state, showFirstTradeTour: action.show }`.

Trigger (App.tsx): one effect, placed immediately after the progressive-hints effect (App.tsx:847–875):
```ts
useEffect(() => {
  if (!runtimeReady || showSetup) return;
  if (shouldShowFirstTradeTour(loadOnboardingState(), showSetup)) {
    dispatch({ type: "SET_SHOW_FIRST_TRADE_TOUR", show: true });
  }
}, [runtimeReady, showSetup]);
```
Because the effect re-runs when `showSetup` flips false, this fires post-wizard (both complete and skip paths) AND on first launch when the wizard never opens (provider already configured). Mount as a full-screen early-return placed directly AFTER the `if (showSetup)` branch (App.tsx:1456–1671) so the wizard always wins:
```tsx
if (showFirstTradeTour) {
  return <FirstTradeTour
    permissionMode={permissionMode}
    onDone={() => { markFirstTradeTourDone(); dispatch({ type: "SET_SHOW_FIRST_TRADE_TOUR", show: false }); }}
  />;
}
```
Both Esc-skip and Enter-finish call `onDone` — single never-again flag, per the locked backlog decision ("Esc to skip, never shown again").

Component — `src/tui/components/wizards/FirstTradeTour.tsx`:
```ts
import type { PermissionMode } from "../../state/types.ts";

interface FirstTradeTourProps {
  permissionMode: PermissionMode;
  onDone: () => void;
}
export function FirstTradeTour({ permissionMode, onDone }: FirstTradeTourProps): React.JSX.Element;
```
Two screens, single `useState<0 | 1>` for the screen index, single `useState<"standard" | "critical">` for the screen-2 preview toggle. ONE `useInput` listener for the whole component: Enter advances (screen 0 → 1, screen 1 → `onDone()`); Esc → `onDone()` from anywhere; Tab on screen 1 toggles the preview variant. The approval previews are STATIC renders — never mount the real `ApprovalDialog` here (its `GordonSelect` + critical-countdown `useInput` would double-handle Enter/Esc with the tour's listener; this is the exact double-fire trap App.tsx:1855 documents).

Screen 1 (copy verbatim; round border, `cyanBright`, paddingX=2 paddingY=1 — match GordonOnboarding's container style before it is deleted in item 24):
```
╭────────────────────────────────────────────────────────────╮
│  FIRST TRADE — how Gordon works                       1/2  │
│                                                            │
│  Every trade follows the same loop. You stay in control    │
│  at every step:                                            │
│                                                            │
│   1  /scan trending      find what's moving                │
│   2  /plan BTC           Gordon drafts entry, stop, size   │
│   3  approve             you say yes (or no) in a dialog   │
│   4  Gordon executes     and tracks the position           │
│                                                            │
│  You're in paper mode — fills are simulated until you      │
│  run /live.                                                │
│                                                            │
│  [Enter] Next  ·  [Esc] Skip — won't show again            │
╰────────────────────────────────────────────────────────────╯
```
The mode line is conditional on the `permissionMode` prop (verbatim variants):
- `paper` → `You're in paper mode — fills are simulated until you run /live.`
- `ask` → `You're in ask mode — every trade waits for your approval.`
- `auto` → `You're in auto mode — trades execute without a dialog. Run /ask to approve each one.`
- `strict` / `observe` / `plan` → `You're in {mode} mode — execution is blocked. Run /modes to see all modes.`

Screen 2 (header + intro verbatim):
```
╭────────────────────────────────────────────────────────────╮
│  FIRST TRADE — approvals are your guardrail           2/2  │
│                                                            │
│  Before money moves, Gordon stops and asks. This is a      │
│  preview — nothing below is real:                          │
│                                                            │
│  ── PREVIEW: a routine approval ──────────────────────     │
│  ⚠ APPROVAL [a3f]                                          │
│    Gordon wants to use `execute_plan`                      │
│    Scope: trading:execute · Risk: MEDIUM                   │
│    Why this needs approval:                                │
│      • Position size 2.1% of equity — inside your 3% limit │
│      • Paper venue — no real capital at risk               │
│      ❯ Allow this time                                     │
│        Always allow this tool                              │
│        Deny                                                │
│                                                            │
│  [Tab] See the critical variant                            │
│  [Enter] Start trading  ·  [Esc] Skip — won't show again   │
╰────────────────────────────────────────────────────────────╯
```
Tab swaps the preview block for the critical variant (double red border around the inner block, mirroring `CriticalApproval`):
```
│  ── PREVIEW: a critical approval ─────────────────────     │
│  ╔══════════════════════════════════════════════════╗     │
│  ║  CRITICAL  APPROVAL [9c2]                         ║     │
│  ║   Tool: execute_plan                              ║     │
│  ║   Scope: trading:execute                          ║     │
│  ║   Effect: live order — real capital               ║     │
│  ║   Why this needs approval:                        ║     │
│  ║     • Order size 12% of equity — exceeds your     ║     │
│  ║       3% limit                                    ║     │
│  ║     • No stop-loss attached to the plan           ║     │
│  ║   ⚠ CRITICAL — This action may be irreversible.   ║     │
│  ║     ❯ Reduce to 0.12 BTC to fit your limits       ║     │
│  ║       CONFIRM ORIGINAL SIZE (CRITICAL)            ║     │
│  ║       DENY                                        ║     │
│  ║   (real dialogs add a 3s hold before confirm)     ║     │
│  ╚══════════════════════════════════════════════════╝     │
│  [Tab] Back to the routine variant                         │
```
Mock data (exported from the component file so tests can type-check them against `ApprovalRequest`):
```ts
export const TOUR_MOCK_STANDARD: ApprovalRequest = {
  id: "tour-demo-standard", shortId: "a3f", toolName: "execute_plan",
  permissionScope: "trading:execute", riskClass: "medium", sideEffectLevel: "order placement",
  riskReasons: ["Position size 2.1% of equity — inside your 3% limit", "Paper venue — no real capital at risk"],
};
export const TOUR_MOCK_CRITICAL: ApprovalRequest = {
  id: "tour-demo-critical", shortId: "9c2", toolName: "execute_plan",
  permissionScope: "trading:execute", riskClass: "critical", sideEffectLevel: "live order — real capital",
  riskReasons: ["Order size 12% of equity — exceeds your 3% limit", "No stop-loss attached to the plan"],
  counterOffer: { symbol: "BTC", side: "buy", originalQuantity: 0.5, adjustedQuantity: 0.12 },
};
```
The option rows in both previews MUST be rendered from `buildApprovalOptions(TOUR_MOCK_*, { critical })` (imported from `../dialogs/ApprovalDialog.tsx`) — first option prefixed `❯ `, rest indented two extra spaces. This keeps tour copy in lockstep with the real dialog forever.

**Files:**
- CREATE `src/tui/components/wizards/FirstTradeTour.tsx` (two-screen tour + static `ApprovalPreview` sub-component + exported mocks)
- CREATE `src/app/setup/onboarding/firstTradeTour.ts` (`shouldShowFirstTradeTour`, `markFirstTradeTourDone`)
- CREATE `src/app/setup/onboarding/firstTradeTour.test.ts`
- EDIT `src/app/setup/onboarding/versionReset.ts` (add `firstTradeTourDone` to `OnboardingState` + `DEFAULT_STATE`)
- EDIT `src/app/setup/onboarding/index.ts` (re-export new module)
- EDIT `src/tui/state/types.ts` (`showFirstTradeTour` field + `SET_SHOW_FIRST_TRADE_TOUR` action)
- EDIT `src/tui/state/reducer.ts` (new case beside `SET_SHOW_SETUP`)
- EDIT `src/tui/App.tsx` (trigger effect after the hints effect; early-return mount after the `showSetup` branch; `useAppState` selector for the new field)

**Acceptance criteria:**
1. Fresh state (`GORDON_HOME` pointing at an empty temp dir): launching the TUI after wizard completion/skip shows the tour; Enter→Enter dismisses it and `onboarding-state.json` contains `"firstTradeTourDone": true`.
2. Esc on either screen dismisses and persists the same flag; relaunching never shows the tour again.
3. Existing install with `firstTradeTourDone: true`: tour never mounts (verify by launching the app).
4. On screen 2, Tab toggles routine ↔ critical preview; option labels exactly match `buildApprovalOptions` output for the two mocks (asserted in tests).
5. Pressing Enter inside the tour never resolves/creates a real approval and never sends a chat message (the tour is an early-return; `pendingApprovals` untouched — assert reducer state unchanged in test or by manual run).
6. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/app/setup/onboarding src/tui` green.

**Test plan:**
- `src/app/setup/onboarding/firstTradeTour.test.ts` (set `process.env.GORDON_HOME` to a `mkdtemp` dir per test): `shouldShowFirstTradeTour` truth table (fresh state + showSetup false → true; showSetup true → false; done flag → false); `markFirstTradeTourDone` persists and round-trips through `loadOnboardingState`; legacy state file without the field defaults to `false`.
- Extend with a `FirstTradeTour` data test (no Ink render needed): import `TOUR_MOCK_STANDARD` / `TOUR_MOCK_CRITICAL`, assert `buildApprovalOptions(TOUR_MOCK_CRITICAL, { critical: true })` yields exactly `["Reduce to 0.12 BTC to fit your limits", "CONFIRM ORIGINAL SIZE (CRITICAL)", "DENY"]` labels and the standard mock yields `["Allow this time", "Always allow this tool", "Deny"]`.
- `src/tui/state/` — extend reducer coverage: `SET_SHOW_FIRST_TRADE_TOUR` toggles the field and nothing else.

**Gotchas:**
- Do NOT mount the real `<ApprovalDialog>` for previews — `GordonSelect` and the critical countdown each register `useInput`; combined with the tour's listener you get the double-Enter bug App.tsx:1855 explicitly works around. Static render + `buildApprovalOptions` is the contract.
- The tour early-return must sit AFTER the `showSetup` branch and BEFORE the model-picker branch (App.tsx:1674) — wizard precedence, and other dialogs unmount while touring.
- `incrementSessionCount()` already runs in the hints effect — don't add a second call.
- Persistence goes in `onboarding-state.json` via `versionReset.ts`, NOT `config.json`/`settings.json` — that file already owns `completedOnce`/`hintShowCounts` and merges defaults for old files.
- Ordering with item 24: this tour replaces `GordonOnboarding`'s reason to exist; land 23 before (or with) 24 so the educate-the-flow content is never gone entirely.
- Ordering with item 27: the tour mentions `/modes` only via mode lines; item 25's command must exist before screen-1 copy referencing `/modes` ships (the strict/observe/plan variant) — either land 25 first or in the same PR.

---

### Item 24 — Wire or delete `GordonOnboarding` (S, P4)

**Current state:** `src/tui/components/wizards/GordonOnboarding.tsx` (187 lines) — a 6-step advisory wizard (`welcome → exchange → broker → risk → first_scan → complete`) with a `ProgressBar` ("Step 2 of 5 ────●────"). Verified zero importers: grep for `GordonOnboarding` matches only the file itself. `SetupWizard` (`src/tui/components/wizards/SetupWizard.tsx:438`) is canonical and already has both step affordances GordonOnboarding offers: a numeric `(N/M)` progress counter (line 495–504) and per-step `✓ ● ○` indicators (lines 508–518).

**Problem:** Dead component that looks like the onboarding entry point to any future contributor (it's named like one), inviting parallel-onboarding drift — the exact failure the deleted-features discipline exists to prevent.

**Spec:** DELETE. Justification: (a) zero importers; (b) its only unique affordance (step-N-of-M indicator) already exists in SetupWizard in richer form; (c) its advisory content ("try /scan", "use /risk") is superseded by item 23's FirstTradeTour and the progressive-hints system; (d) repo rule: "if something is unused, delete it" (CLAUDE.md ground rule 3). Nothing to merge.

Also delete the type `OnboardingStep` it exports — verify first that no other file imports it (grep `OnboardingStep` across `src/`; at audit time the only definition+use is in this file).

**Files:**
- DELETE `src/tui/components/wizards/GordonOnboarding.tsx`

**Acceptance criteria:**
1. `grep -r "GordonOnboarding" src/` → no matches.
2. `bun tsc --noEmit -p tsconfig.json` clean.
3. `bun test src/tui` green (no test references the component today; confirms nothing broke).

**Test plan:** None to add — deletion only. Run the scoped suites above.

**Gotchas:**
- Item 23's `FirstTradeTour` deliberately borrows GordonOnboarding's container style (round `cyanBright` border, `[Enter] Next · [Esc] Skip` footer). If you implement 23 and 24 in one PR, copy the styling into FirstTradeTour BEFORE deleting.
- Do not also delete `GordonWelcomeFeed` in this item — its disposition is item 26's decision (also delete, but specced there with its replacement).
- No backwards-compat re-export shim. Just remove it.

---

### Item 25 — `/modes` help page (S, P4)

**Current state:**
- The six `PermissionMode`s are defined with one-line comments at `src/tui/state/types.ts:36–43`. Each has a switch command in `src/app/slash/slashCommands.ts` (`auto` 584, `ask` 595, `strict` 606, `paper` 617, `live` 628, `observe` 639, `planmode` 650) but there is NO overview page; `/help` (slashCommands.ts:1122, `action: "agent"`, target `teacher`) routes to an LLM and the local summary view (`src/app/slash/commandHelp.ts:163` `formatHelpSummaryView`) never mentions modes.
- Menu-command plumbing: a seed with `action: "menu"` + `target` is dispatched from `src/tui/bridge/runtime.ts:364` → `handleMenuCommand` → `handleSystemMenuCommand` (`src/tui/bridge/menuHandlers.ts:622`), which posts text via the local `addMessage` helper (menuHandlers.ts:55). Deterministic targets must be registered in `DIRECT_MENU_TARGETS` (slashCommands.ts:56) or the drift test (`src/app/slash/slashCommands.test.ts:123` — `getSlashCommandRuntimeDrift()` must be `[]`) fails.
- The boot-time `permission_mode` progressive hint (`src/app/setup/onboarding/progressiveHints.ts:43–47`) names three modes only.

**Problem:** The mode system is Gordon's risk dial, and a vibe trader currently has to discover six modes one slash command at a time. One canonical matrix page makes the safety model legible.

**Spec:**

1. New formatter in `src/app/slash/commandHelp.ts`:
```ts
export function formatTradingModesHelp(): string;
```
Returns EXACTLY (verbatim; markdown table — `/help` already emits `|` tables via `formatAnalysisCommandsHelp`):
```
**Trading Modes** — how much Gordon may do without you

| Mode | Command | What it does | When to use it | Risk |
|---|---|---|---|---|
| auto | /auto | Trades execute without per-action approval; only your risk rules and the trading constitution block | You trust the setup and want hands-free execution | Highest — real orders fire without a dialog |
| ask | /ask | Every trade pauses for your approval dialog (default) | Day-to-day trading; you keep the final say | Guarded — nothing fires without you |
| plan | /planmode | Plans can be created but never executed | Drafting trades to review later | None — execution blocked |
| paper | /paper | Real orders blocked; fills simulated against live prices | Practice, strategy testing, onboarding | None to capital — simulated only |
| strict | /strict | Read-only — all trades blocked, analysis and planning only | Audits and research sessions | None — read-only |
| observe | /observe | No execution of any kind, not even paper trades | Pure market watching | None — fully inert |

Switch anytime by typing the command. `/live` returns from paper to live trading (approval required).
Your current mode is shown in the header. `/help` lists everything else.
```
2. Re-export from `slashCommands.ts` alongside the existing line-2558 re-export: `export { formatCommandHelp, formatAnalysisCommandsHelp, formatPaginatedCommandHelp, formatTradingModesHelp } from "./commandHelp.ts";`
3. Register the command — add a seed in slashCommands.ts directly after the `planmode` entry (line ~660):
```ts
{
  name: "modes",
  aliases: ["mode"],
  description: "Explain the 6 trading modes and when to use each",
  usage: "/modes",
  category: "system",
  level: 1,
  action: "menu",
  target: "modes",
  whenToUse: "You're not sure which permission mode fits — see the full matrix",
},
```
(Verified: no existing command or alias named `mode`/`modes`.) Add `"modes"` to `DIRECT_MENU_TARGETS` (slashCommands.ts:56).
4. Handle it — `handleSystemMenuCommand` in `src/tui/bridge/menuHandlers.ts`, new case before `"help"` (line 629):
```ts
case "modes": {
  addMessage(setState, "gordon", formatTradingModesHelp());
  return true;
}
```
(import `formatTradingModesHelp` next to the existing `formatPaginatedCommandHelp` import at menuHandlers.ts:4).
5. Link from `/help`: in `formatHelpSummaryView` (commandHelp.ts:163), immediately before the `lines.push("\n---")` (line 184), add: `lines.push("\n**New to Gordon?** \`/modes\` explains the 6 trading modes.");`
6. Link from boot hint: change the `permission_mode` hint message (progressiveHints.ts:44) to verbatim: `"Tip: Use /auto for hands-free trading, /ask for per-trade approval (default), or /strict for read-only mode. /modes shows the full matrix."`

**Files:**
- EDIT `src/app/slash/commandHelp.ts` (add `formatTradingModesHelp`; one line in `formatHelpSummaryView`)
- EDIT `src/app/slash/slashCommands.ts` (seed after `planmode`; `"modes"` into `DIRECT_MENU_TARGETS`; re-export formatter)
- EDIT `src/tui/bridge/menuHandlers.ts` (case `"modes"` in `handleSystemMenuCommand` + import)
- EDIT `src/app/setup/onboarding/progressiveHints.ts` (`permission_mode` hint message)

**Acceptance criteria:**
1. In the TUI, `/modes` prints the table locally (no LLM call, instant) with all 6 mode rows plus the `/live` footer line.
2. `/mode` (alias) does the same.
3. `/help` summary output contains the line `**New to Gordon?** \`/modes\` explains the 6 trading modes.`
4. `bun test src/app/slash` green — including the existing drift test `getSlashCommandRuntimeDrift()).toEqual([])` (proves the `DIRECT_MENU_TARGETS` registration).
5. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:** Extend `src/app/slash/slashCommands.test.ts`:
- `formatTradingModesHelp()` contains each of `"/auto"`, `"/ask"`, `"/planmode"`, `"/paper"`, `"/strict"`, `"/observe"`, `"/live"`.
- `SLASH_COMMANDS.find(c => c.name === "modes")` has `action === "menu"`, `target === "modes"`, alias `"mode"`, and `isRuntimeHandledSlashCommand(modes) === true` (mirrors the `sprint-status` test at line 193).
- `formatPaginatedCommandHelp()` (no args) contains `"/modes"`.

**Gotchas:**
- Forgetting `DIRECT_MENU_TARGETS` fails the existing drift test — that's the intended guard, not a flake.
- `mergeSlashCommands` is first-seen-wins; a skill named `modes` would lose to the core seed (correct), but confirm no generated command collides: the suggestions test will surface duplicates.
- Mode copy must stay consistent with `PermissionMode` comments in types.ts:36–43 and with the mode-switch messages in `handleUIMenuCommand` (menuHandlers.ts:570–585) — if you adjust phrasing, adjust in one direction only (the table follows types.ts).
- `/planmode` is the command for `plan` mode (`/plan` at slashCommands.ts:275 is trade-plan creation, a different thing). The table must use `/planmode` — do not "fix" it to `/plan`.

---

### Item 26 — First-chat welcome feed / empty-state (S, P4)

**Current state:**
- `src/tui/components/layout/GordonWelcomeFeed.tsx` exists (verified) but is mounted nowhere — grep matches only its own file. It renders a "◈ GORDON Ready to trade" header + optional market/session/tip rows; all props optional.
- The empty-chat path: App.tsx:1848 renders `VirtualMessageList` only when `messages.length > 0`; with zero messages the conversation area is empty and the only signal is the rotating `EXAMPLE_PROMPTS` placeholder inside the prompt input (App.tsx:1821–1840). The pre-Ink boot card (`printBootCard`, `src/tui/index.tsx:165`) sits above in scrollback with a rotating tip from the `TIPS` array (index.tsx:142) chosen by the oldest-first picker (index.tsx:~95–140).
- `GordonHeader` is imported at App.tsx:17 but `<GordonHeader` appears nowhere — the comment at App.tsx:1847 ("header box handles the branding") is stale; the boot card does.
- Locked decision (backlog item 15): the merged boot panel's footer "IS the welcome feed."

**Problem:** After `/clear` (item 2) or any state where the boot card has scrolled away, an empty chat is pure dead air; and `GordonWelcomeFeed` is a second never-mounted onboarding component inviting the same drift as item 24.

**Spec:**
1. DELETE `src/tui/components/layout/GordonWelcomeFeed.tsx`. Its concept is superseded by item 15's boot-panel footer (live ticker + rotating hint); keeping a parallel feed component violates the no-parallel-surfaces discipline. (Same justification class as item 24: zero importers, superseded.)
2. CREATE a minimal `EmptyChatHint` so the Ink-rendered area is never blank when chat is empty — works independently of item 15 and stays correct after it lands (item 15's panel is pre-Ink scrollback; this is the live tree):
   `src/tui/components/layout/EmptyChatHint.tsx`
   ```ts
   interface EmptyChatHintProps {
     hasExchange: boolean;
   }
   export function EmptyChatHint({ hasExchange }: EmptyChatHintProps): React.JSX.Element;
   ```
   Render (verbatim; single dim line, teal diamond `rgb(52,238,176)` matching the boot card):
   - `hasExchange === true`:
     `◈ Ready — try /scan trending · /modes explains trading modes · /help for everything`
   - `hasExchange === false`:
     `◈ Ready — connect a venue with /setup, or explore with /scan trending · /help`
3. Mount in App.tsx in the conversation `Box`, replacing the stale comment at line 1847:
   ```tsx
   {messages.length === 0 && runtimeReady && !isStreaming && (
     <EmptyChatHint hasExchange={connectivityHints.hasExchange} />
   )}
   {messages.length > 0 && (
     <VirtualMessageList ... />
   )}
   ```
   (`connectivityHints` already exists in AppInner scope — set at App.tsx:832.)
4. While editing this region, delete the unused `GordonHeader` import at App.tsx:17 only if it is still unreferenced at implementation time (the item-15 implementer may have mounted it — check first).

**Files:**
- DELETE `src/tui/components/layout/GordonWelcomeFeed.tsx`
- CREATE `src/tui/components/layout/EmptyChatHint.tsx`
- EDIT `src/tui/App.tsx` (mount in the empty-state branch beside `VirtualMessageList`; stale comment removed)

**Acceptance criteria:**
1. Launch with a configured provider and send no message: the line `◈ Ready — …` renders above the prompt (run the app to verify).
2. Send a message: the hint disappears and `VirtualMessageList` renders (no flash of both).
3. `grep -r "GordonWelcomeFeed" src/` → no matches; `bun tsc --noEmit -p tsconfig.json` clean.
4. With no exchange configured, the `/setup` variant of the copy renders.
5. `bun test src/tui` green.

**Test plan:** No new test file for the presentational component (repo precedent: layout components are untested; logic lives elsewhere). Cover via:
- Manual run for criteria 1–2–4 (document in PR).
- If item 2 (`/clear` → `RESET_SESSION`) has landed, add to its reducer test: after reset, `messages.length === 0` (the hint's render condition).

**Gotchas:**
- Coordinate with item 15: do NOT build a full feed (ticker rows, session summary) here — that's item 15's footer. This item is only the never-blank guarantee plus the `/modes` onboarding link. If item 15's implementer wants to enrich the empty state later, they extend `EmptyChatHint`, not resurrect a feed component.
- Condition must include `!isStreaming` — the first user turn removes messages-empty only when the streaming placeholder message is inserted; without the guard you can get hint + spinner stacked for a frame.
- Item 25 must land first (the copy references `/modes`); if shipping out of order, drop that clause from the copy: `◈ Ready — try /scan trending · /help for everything`.
- `rgb(52,238,176)` is the established Gordon teal (index.tsx:174, GordonWelcomeFeed:77); use it via a `<Text color="rgb(52,238,176)">` literal consistent with current neighbors — do not invent a new token here (item 28 will migrate all 238 sites at once).

---

### Item 27 — Radar onboarding hint (S, P4)

**Current state:**
- Progressive-hint system: `src/app/setup/onboarding/progressiveHints.ts` — `InlineHint` (line 17: `id`, `message`, `maxShows`, optional `condition(ctx)`), `HINTS` array (line 35, currently 7 entries), `getNextHint` (line 88) returns the FIRST eligible hint in array order, at most one per session; `recordHintShown` persists counts into `onboarding-state.json`. Wired in App.tsx:847–875 (hint posted as a system chat message at session start). Note the existing wiring quirk: `hintContext.sessionCount` is passed as `0` from App.tsx:853 with a comment claiming it's "loaded from state inside getNextHint" — it is NOT; `getNextHint` uses the context as-given, so session-window conditions currently evaluate against 0. See gotchas.
- Radar cards arrive as chat messages via `useProactiveChatSubscription` (`src/tui/hooks/useProactiveChatSubscription.ts`) — `proactive:suggestion_fired` bus events become `variant: "proactive_suggestion"` messages. The `/radar` command (slashCommands.ts:670–684) controls the observer (`on|off|status|tune`). Nothing anywhere explains to a new user what these unsolicited cards are.

**Problem:** Radar is Gordon's signature proactive surface, and its cards appear unannounced — a new trader can't tell an agent suggestion from a system warning, so they ignore or distrust both.

**Spec:**
1. Fix the sessionCount wiring so session-window conditions actually work (prerequisite for the new hint, and it repairs the four existing windowed hints): in `versionReset.ts`, change `incrementSessionCount()` to return the new count:
   ```ts
   export function incrementSessionCount(): number;  // returns state.sessionCount after increment
   ```
   In App.tsx:850–853, use it: `const sessionCount = incrementSessionCount();` then `sessionCount` in the `HintContext` instead of the hardcoded `0` (delete the stale comment).
2. Add the radar hint to `HINTS`, inserted immediately AFTER the `slash_commands` entry (line 48–53) and BEFORE `keybindings` — array order is priority order and radar matters more than keybinding customization. Entry verbatim:
   ```ts
   {
     id: "radar_cards",
     message: "Tip: Radar cards are unsolicited heads-ups from Gordon's market observer — news, regime shifts, volatility spikes. They show up inline in chat, marked as suggestions. Turn on with /radar on, inspect with /radar status.",
     maxShows: 3,
     condition: (ctx) => ctx.sessionCount >= 2 && ctx.sessionCount <= 12,
   },
   ```
   (Window starts at session 2 so the first session stays focused on setup + the item-23 tour; `maxShows: 3` matches the other discovery hints.)

**Files:**
- EDIT `src/app/setup/onboarding/progressiveHints.ts` (new `HINTS` entry at the specified position)
- EDIT `src/app/setup/onboarding/versionReset.ts` (`incrementSessionCount` returns the new count)
- EDIT `src/tui/App.tsx` (use the returned count in `hintContext`; remove the stale `// Loaded from state inside getNextHint` comment)
- CREATE `src/app/setup/onboarding/progressiveHints.test.ts`

**Acceptance criteria:**
1. `bun test src/app/setup/onboarding` green with the new test file covering the cases below.
2. With a fresh `GORDON_HOME` and `sessionCount` forced to 2 (write the state file), `getNextHint` with a context where earlier hints are exhausted/ineligible returns `radar_cards`; after `recordHintShown("radar_cards")` ×3 it never returns again.
3. On session 1 (`sessionCount: 1`), `radar_cards` is not returned.
4. Manual: second-ever session launch shows the ℹ radar tip as a system message at session start.
5. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:** `src/app/setup/onboarding/progressiveHints.test.ts` (new; set `process.env.GORDON_HOME` to a fresh temp dir per test — module reads the file on every call, no cache):
- `radar_cards` exists in `HINTS` with `maxShows === 3` and sits before `keybindings` / after `slash_commands` (index assertion — order IS behavior here).
- Condition truth table: `sessionCount` 1 → ineligible, 2 → eligible, 12 → eligible, 13 → ineligible.
- `getNextHint` returns first eligible by order: with a context making both `slash_commands` and `radar_cards` eligible, `slash_commands` wins; exhaust it via `recordHintShown` ×3, then `radar_cards` is returned.
- `incrementSessionCount()` returns 1, then 2 on consecutive calls against a fresh dir.

**Gotchas:**
- `GORDON_DIR` is computed once at module import from `GORDON_HOME` (`src/infra/storage/paths.ts:20,26`) — in tests set `process.env.GORDON_HOME` BEFORE importing the onboarding modules (use dynamic `await import` after setting env, or set it at the top of the test file before other imports).
- Do not reorder existing `HINTS` entries; `getNextHint` is first-match and the current priority (init → permission_mode → slash_commands → …) is deliberate.
- The sessionCount fix changes behavior of four existing hints (they were all evaluating at `sessionCount === 0`, which made `<= N` windows permanently true and `>= 2` windows permanently false). That's the bug being fixed, not a regression — note it in the PR.
- Don't touch `useProactiveChatSubscription` or any radar producer — the hint is the entire scope. Radar card interactivity is item 19, not this.
- One hint per session is by design; the radar hint will naturally appear a session or two after the earlier hints exhaust. Do not add a "force show" path.
