# P3 — Information Architecture (Items 16–22)

Spec fragment for `docs/TUI_DESIGN_BACKLOG.md` items 16–22. Standalone — all file anchors verified against the tree on 2026-06-12.

Shared context for this section (locked operator decisions, 2026-06-12):
- **Hybrid screen model.** Chat stays inline (scrollback = audit trail). Alt-screen (`\x1b[?1049h/l`) is reserved for full-screen overlay views — lazygit-style: enter, work, return to chat exactly where you were. Items 17 and 18 are the first two such views.
- Repo conventions that apply to every item here: `.ts`/`.tsx` extensions on relative imports; co-located `*.test.ts` using `bun:test`; typecheck with `bun tsc --noEmit -p tsconfig.json`; **never run bare `bun test`** (sweeps vendored repos) — always scope, e.g. `bun test src/tui`; app-level state changes go through the reducer in `src/tui/state/` (new `Action` variants in `types.ts`, handled in `reducer.ts`, read via selectors in `selectors.ts`), not new `useState` in `App.tsx`; colors come from theme tokens (`src/tui/themes/themes.ts` via `useTheme()`/`useThemeColor()`); the agent tool surface stays exactly 22 tools (nothing in this section touches agent tools — all reads go directly to infra modules); no backwards-compat shims; comments only where the WHY is non-obvious.

---

### Item 16 — Workflow command palette (L, P3)

**Current state:**
- A flat command palette already exists and is already bound to Ctrl+P:
  - `src/tui/components/CommandPalette.tsx` — `CommandPalette({ items, onSelect, onClose })`, `PaletteItem { id, label, description?, category? }`. Filtering is plain case-insensitive substring (`label/description/category .includes(lower)`), capped at 15 results, no grouping, hardcoded `yellow` chrome, footer hint "↑↓ navigate · Enter select · Esc close".
  - Binding: `src/tui/keybindings/keybindings.ts` `DEFAULT_BINDINGS` contains `{ key: "ctrl+p", action: "togglePalette" }`; the single global `useInput` in `App.tsx` (the "Global keybindings (dynamic via keybindings.json)" block, ~`App.tsx:885`) resolves it via `getActionsForKey` and dispatches `{ type: "TOGGLE_PALETTE" }` (`App.tsx:906`). Render site: `App.tsx:1977` gated on `showPalette` from `useAppState`; `onSelect` = `handlePaletteSelect` (`App.tsx:1345`) which closes the palette and calls `handleSubmit(item.label)` — i.e. selecting an item runs the slash command.
  - Items: `src/tui/hooks/useMergedCommands.ts` merges `SLASH_COMMANDS` + plugin + MCP commands into `MergedCommand extends PaletteItem`, already setting `category: cmd.workflow`.
- Workflow metadata already exists on every command: `src/app/slash/slashCommands.ts` `SlashCommand` has `workflow: WorkflowGroup` (+ `workflowLabel`, `workflowOrder`), stamped by `normalizeCommandUx` in `src/app/slash/commandUx.ts`. `WorkflowGroup` is the 8-way union `"discover" | "analyze" | "trade" | "run" | "accounts" | "monitor" | "build" | "operate"`, inferred by `inferWorkflowGroup` (override sets `ANALYZE_COMMANDS`, `RUN_COMMANDS`, … + `CATEGORY_DEFAULT_WORKFLOW`).
- So the gap is NOT "no palette": it is (a) the trader-facing 6-bucket grouping (incl. a **safety** bucket which the 8-way taxonomy has no concept of), (b) grouped rendering, (c) real fuzzy matching, (d) inline key-hints, (e) theme-token chrome.

**Problem:** 189 slash commands behind a flat substring list is a memorization tax. The vibe trader thinks in workflow verbs (discover → plan → execute → monitor) and needs the safety controls findable as a named group, not scattered across "system".

**Spec:**

1. **Palette workflow taxonomy** — add to `src/app/slash/commandUx.ts` (NOT a new file — it lives beside the existing `WorkflowGroup` machinery and derives from it):

```ts
export type PaletteWorkflowId = "discover" | "plan" | "execute" | "monitor" | "safety" | "system";

export interface PaletteWorkflowConfigEntry {
  label: string;      // group header text, uppercase rendered
  icon: string;
  order: number;      // render order
  /** theme token used for the group header + selected-row accent */
  colorToken: "agentScanner" | "agentPlanner" | "agentExecutor" | "agentMonitor" | "riskDanger" | "uiMuted";
}

export const PALETTE_WORKFLOW_CONFIG: Record<PaletteWorkflowId, PaletteWorkflowConfigEntry> = {
  discover: { label: "DISCOVER", icon: "◆", order: 0, colorToken: "agentScanner" },
  plan:     { label: "PLAN",     icon: "▲", order: 1, colorToken: "agentPlanner" },
  execute:  { label: "EXECUTE",  icon: "≫", order: 2, colorToken: "agentExecutor" },
  monitor:  { label: "MONITOR",  icon: "○", order: 3, colorToken: "agentMonitor" },
  safety:   { label: "SAFETY",   icon: "⛨", order: 4, colorToken: "riskDanger" },
  system:   { label: "SYSTEM",   icon: "●", order: 5, colorToken: "uiMuted" },
};
```

2. **Mapping** — pure derivation from the existing per-command `workflow` field plus name-level override sets. Precedence: `PALETTE_SAFETY_COMMANDS` > other override sets > base table. Exported function:

```ts
export function paletteWorkflowFor(cmd: Pick<SlashCommand, "name" | "workflow">): PaletteWorkflowId;
```

Base table (every `WorkflowGroup` maps; this is the full category mapping):

| `WorkflowGroup` (existing) | `PaletteWorkflowId` | Rationale |
|---|---|---|
| `discover` | `discover` | scan / trending / volume / breakouts / regime |
| `analyze`  | `discover` | analysis is part of finding the trade (analyze, ta, chart, whales, deep, mtf, …) |
| `trade`    | `execute`  | orders / cancel / close / stop-loss / take-profit (planning names overridden below) |
| `run`      | `plan`     | backtest / optimize / gen / strategy construction (live-strategy ops overridden below) |
| `accounts` | `monitor`  | portfolio / positions / history / earn — "watch my money" |
| `monitor`  | `monitor`  | health / audit / watch / alerts |
| `build`    | `system`   | mcp / routing / workflow / export / keyring |
| `operate`  | `system`   | setup / config / threads / model / theme / runtime-* |

Override sets (exported `ReadonlySet<string>` of command **names**, all verified to exist in `SLASH_COMMANDS` seeds):

```ts
export const PALETTE_SAFETY_COMMANDS: ReadonlySet<string> = new Set([
  "killswitch", "emergency", "risk", "rules", "deny-all",
  "runtime-approvals", "runtime-approve", "runtime-deny",
  "auto", "ask", "strict", "paper", "live", "observe", "planmode",
]);
export const PALETTE_PLAN_COMMANDS: ReadonlySet<string> = new Set([
  "plan", "plans", "simulate",            // trade-group commands that are planning, not execution
]);
export const PALETTE_EXECUTE_COMMANDS: ReadonlySet<string> = new Set([
  "deploy", "rebalance",                  // run/accounts-group commands that move money
  "withdraw",
]);
export const PALETTE_MONITOR_COMMANDS: ReadonlySet<string> = new Set([
  "strategies-live", "pause", "resume-strategy", "stop",   // operating RUNNING strategies = monitoring
  "radar", "ack", "pass", "snooze",
  "goal-status", "sprint-status", "wip-status", "shadow-divergence",
  "perf", "journal",
]);
```

Plugin/MCP-sourced palette entries (no `workflow` field) map to `system`.

3. **Palette item shape** — extend `PaletteItem` in `CommandPalette.tsx`:

```ts
export interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
  workflowId?: PaletteWorkflowId;   // grouping key; undefined → "system"
  keyHint?: string;                  // e.g. "Ctrl+Shift+X", right-aligned
}
```

`useMergedCommands.ts` sets `workflowId: paletteWorkflowFor(cmd)` for builtins (`"system"` for plugin/MCP) and `keyHint` from this map (resolved via the existing `getBinding(action)` in `src/tui/keybindings/keybindings.ts` so user rebinds show correctly; format the chord with the existing helpers in `src/tui/design-system/KeyboardShortcutHint.tsx` if a formatter exists there — grep before writing a new one):

| command name (target) | BindableAction |
|---|---|
| `emergency` | `toggleEmergencyHalt` |
| `menu` | `togglePalette` |
| `settings-panel` | `toggleSettings` |
| `export-panel` | `toggleExport` |
| `privacy` | `togglePrivacy` |
| `context-viz` | `toggleContextView` |

4. **Fuzzy matching** — CREATE `src/tui/utils/fuzzy.ts`:

```ts
export interface FuzzyResult { score: number }  // higher = better
/** null = no match. Scoring: exact substring (300+) > prefix (200+) > word-start subsequence (100+) > scattered subsequence (1+); shorter targets break ties. Case-insensitive. */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null;
```

`CommandPalette` filters with `fuzzyMatch(query, item.label) ?? fuzzyMatch(query, item.description ?? "")`, sorts by score desc within group, keeps the 15-result cap **per render** (not per group — global cap, groups render only if non-empty).

5. **Grouped render** — pure helper, exported for tests:

```ts
export function groupPaletteItems(items: PaletteItem[], query: string): Array<{ group: PaletteWorkflowId; items: PaletteItem[] }>;
```

Empty query: show the 3 highest-`workflowOrder`-priority items per group (discover→system order). Selection index moves linearly across the flattened list; group headers are not selectable. Chrome colors: border `uiBorder`, search caret + selected row `uiFocus`, group headers their `colorToken` — all via `useTheme()`, replacing the hardcoded `yellow`.

Mockup (width 64, themed):

```
╭──────────────────────────────────────────────────────────────╮
│ ▶ pla█                                                       │
│                                                              │
│ ▲ PLAN                                                       │
│ ▸ /plan        Create a trade plan for a symbol              │
│   /plans       Review pending plans                          │
│   /backtest    Run a strategy backtest                       │
│ ⛨ SAFETY                                                     │
│   /planmode    Plan-only mode — create but never execute     │
│ ● SYSTEM                                                     │
│   /runtime-plugins  Plugin registry state                    │
│                                                              │
│ 5 of 189 · ↑↓ navigate · Enter run · Esc close               │
╰──────────────────────────────────────────────────────────────╯
```

Footer copy verbatim: `{n} of {total} · ↑↓ navigate · Enter run · Esc close`. Items with `keyHint` render it right-aligned dim, e.g. `/emergency   Halt everything            Ctrl+Shift+X`.

**Files:**
- EDIT `src/app/slash/commandUx.ts` — add `PaletteWorkflowId`, `PALETTE_WORKFLOW_CONFIG`, the four override sets, `paletteWorkflowFor` (beside `inferWorkflowGroup`).
- CREATE `src/tui/utils/fuzzy.ts` (+ co-located `fuzzy.test.ts`) — `fuzzyMatch`.
- EDIT `src/tui/components/CommandPalette.tsx` — extend `PaletteItem`, add `groupPaletteItems`, grouped render, theme tokens, keyHint column.
- EDIT `src/tui/hooks/useMergedCommands.ts` — stamp `workflowId` + `keyHint`.
- CREATE `src/app/slash/commandUx.palette.test.ts` — mapping tests.

**Acceptance criteria:**
1. `bun test src/app/slash` passes: every entry in `SLASH_COMMANDS` resolves to exactly one `PaletteWorkflowId`; every name in the four override sets exists in `SLASH_COMMANDS` (typo guard); `paletteWorkflowFor({name:"killswitch", workflow:"operate"}) === "safety"`, `plan → plan`, `deploy → execute`, `analyze → discover`, `strategies-live → monitor`.
2. `bun test src/tui` passes fuzzy tests: `fuzzyMatch("pln","plan")` matches; `fuzzyMatch("xyz","plan")` is null; exact substring scores above scattered subsequence.
3. Run the TUI (`bun start` / project run script), press Ctrl+P, type `kill` — `/killswitch` renders under a red `⛨ SAFETY` header; Enter runs it; Esc closes.
4. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:** `commandUx.palette.test.ts` — totality over `SLASH_COMMANDS`, override precedence (safety beats execute for `planmode`), typo guard. `fuzzy.test.ts` — match classes, scoring order, case-insensitivity, empty query. Extend nothing else; component behavior is covered by the pure `groupPaletteItems` helper test (add cases to `fuzzy.test.ts` or a small `CommandPalette.test.ts` exercising the helper only — no Ink render harness exists in this repo).

**Gotchas:**
- There are TWO keybinding systems: `src/tui/keybindings/keybindings.ts` (`BindableAction`, `getActionsForKey`, `getBinding` — the one `App.tsx` actually uses) and `src/tui/keybindings/defaultBindings.ts` + `KeybindingContext` (`KeyContext.CommandPalette` exists there). Use the first; do not wire the second.
- Do NOT replace the existing 8-way `WorkflowGroup` — `/help`, `getQuickActionItems`, and `sortCommandsForPresentation` consume it. `PaletteWorkflowId` is a derived projection, not a parallel store of truth.
- `useMergedCommands` memoizes with `[]` deps — plugin commands are snapshot-at-mount. Leave that as is (out of scope).
- `design-system/FuzzyPicker.tsx` has its own substring filter; do not migrate it in this item (orthogonal damage) — but `fuzzyMatch` is written so it can adopt later.
- `handlePaletteSelect` submits `item.label` — labels for builtins are `/{name}`; keep that invariant when adding fields.
- Item 21 adds a workspace section prop to this component — land 16 first.

---

### Item 17 — Trade-queue panel (L, P3)

**Current state:**
- No full-screen overlay views exist. `?1049` appears only in a comment in `src/tui/ink-custom/syncTerminal.ts:98`; that module exports `detectTerminalCapability(env)` → `{ hasAlternateScreen, ... }` (env-only detection, marked NOT WIRED) — reuse it.
- `src/tui/components/layout/FullscreenLayout.tsx` — an existing three-zone (header/content/status/input) full-height layout component with `useFullscreenLayout()` context; suitable shell for the view.
- Data sources, all verified:
  - Pending approvals: `state.pendingApprovals: ApprovalRequest[]` (`src/tui/state/types.ts:79`); `ApprovalRequest` (`src/tui/components/dialogs/ApprovalDialog.tsx:28`) has `riskClass: "low"|"medium"|"high"|"critical"`, `riskReasons?`, `counterOffer?`. Decisions flow through `handleApproval` (`App.tsx:1353`) → `handleApprovalDecision(decision, id, stateUpdater, approval)` from `src/tui/bridge/runtime.ts`.
  - Positions: `getPositionStore()` (async) → `PositionStore.getActive(): Promise<PositionRecord[]>` (`src/core/positions/store.ts:298,428`); live updates via EventBus `position:updated` / `position:closed` (pattern already in `src/tui/components/status/LivePositions.tsx` using `useEventBusSubscriptions`).
  - Radar queue: `getSuggestionStore().getRecent(20, { status: "pending" })` (`src/infra/proactive/storage/suggestionStore.ts:64,158`) — synchronous, in-memory.
- The ink render instance exposes `clear()` (`src/tui/ink-custom/render.ts:89` `Instance.clear`) but `src/tui/index.tsx:23` only destructures `waitUntilExit`.
- Reducer action naming convention (`src/tui/state/types.ts:175`): `SET_*` / `TOGGLE_*` upper-snake with payload fields.
- Legacy bridge note: menu handlers mutate a parallel state object via `StateUpdater` (`src/tui/bridge/menuHandlers.ts`); `App.tsx` forwards changed fields to the reducer in the diff block at ~`App.tsx:740` (`if (next.showPalette !== prev.showPalette) dispatch(...)`).

**Problem:** "What needs me right now" — pending approvals, open risk, radar — exists only as prose scrolling away in chat. The trader needs one persistent surface, and per the locked hybrid decision it must be an alt-screen overlay that returns to chat exactly where they were.

**Spec:**

1. **Alt-screen helper** — CREATE `src/tui/utils/altScreen.ts`:

```ts
const ALT_ENTER = "\x1b[?1049h\x1b[H\x1b[2J";
const ALT_LEAVE = "\x1b[?1049l";
export function enterAltScreen(out: NodeJS.WriteStream = process.stdout): boolean; // false when unsupported (no-op)
export function leaveAltScreen(out: NodeJS.WriteStream = process.stdout): void;    // no-op if not entered
```

Gate on `detectTerminalCapability().hasAlternateScreen` AND `out.isTTY`. Track entered-state in module scope so `leaveAltScreen` is idempotent (process-exit safety: also register a one-time `process.on("exit")` leave). When unsupported, the view still renders (tree swap below) — it just scrolls inline; degrade, never block.

2. **Ink instance holder** — CREATE `src/tui/utils/inkInstance.ts` with `setInkInstance(i: { clear: () => void }): void` / `clearInkOutput(): void`. EDIT `src/tui/index.tsx` (`startGordonTUI`, the `render(<App />…)` call): capture the instance, call `setInkInstance(instance)`. After every buffer switch, `enterAltScreen`/`leaveAltScreen` callers invoke `clearInkOutput()` so the renderer's line-diff state doesn't bleed stale frames across buffers (same reason `incrementalRendering` forces full repaints on scroll — see the comment at `index.tsx:24`).

3. **State** — EDIT `src/tui/state/types.ts`:

```ts
export type OverlayViewId = "tradeQueue" | "safety";
// AppState:
activeOverlayView: OverlayViewId | null;   // INITIAL_STATE: null
// Actions:
| { type: "OPEN_OVERLAY_VIEW"; view: OverlayViewId }
| { type: "CLOSE_OVERLAY_VIEW" }
```

Reducer: trivial set/clear. Selector in `selectors.ts`: `selectActiveOverlayView`. Opening also closes the palette (`showPalette: false` in the same reducer case).

4. **Entry points:**
- Keybinding: add `"toggleTradeQueue"` to `BindableAction` in `src/tui/keybindings/keybindings.ts`, `{ key: "ctrl+t", action: "toggleTradeQueue" }` in its `DEFAULT_BINDINGS`, and a case in the `App.tsx` global `useInput` switch (~`App.tsx:900`) dispatching `OPEN_OVERLAY_VIEW`/`CLOSE_OVERLAY_VIEW` based on current state.
- Slash command: add seed `{ name: "queue", aliases: ["tq", "trade-queue"], description: "Trade queue — pending approvals, open positions, radar", usage: "/queue", category: "system", level: 1, action: "menu", target: "trade-queue" }` to `slashCommands.ts`; add `"trade-queue"` to `DIRECT_MENU_TARGETS`; handle in `handleUIMenuCommand` (`src/tui/bridge/menuHandlers.ts`, beside `case "menu"`): `setState(prev => ({ ...prev, activeOverlayView: "tradeQueue" }))`; forward in the `App.tsx` ~740 diff block: `if (next.activeOverlayView !== prev.activeOverlayView) dispatch(next.activeOverlayView ? { type:"OPEN_OVERLAY_VIEW", view: next.activeOverlayView } : { type:"CLOSE_OVERLAY_VIEW" })`.

5. **Render model** — in `App.tsx`, after all hooks, before the main chat tree return: when `activeOverlayView === "tradeQueue"`, return `<TradeQueueView …/>` INSTEAD of the chat tree. A `useEffect` keyed on `activeOverlayView !== null` calls `enterAltScreen()` + `clearInkOutput()` on mount-of-overlay and `leaveAltScreen()` + `clearInkOutput()` on cleanup. Unmounting the chat tree is what makes the key model safe: the inline `ApprovalDialog`'s and `PromptInput`'s `useInput` listeners unmount, so no double-fire by construction.

6. **Component** — CREATE `src/tui/components/views/TradeQueueView.tsx`:

```ts
export interface TradeQueueViewProps {
  pendingApprovals: ApprovalRequest[];
  permissionMode: PermissionMode;
  onApprovalDecision: (decision: ApprovalDecision, id: string) => void;  // = App's handleApproval
  onRadarAction: (cmd: string) => void;   // = handleSubmit("/ack <id>" | "/pass <id>" | "/snooze <cat> 60")
  onClose: () => void;                    // dispatch CLOSE_OVERLAY_VIEW
}
```

Internally: loads positions (`getPositionStore().getActive()` on mount → map `PositionRecord` → row; `stopLoss` → stop) and subscribes to `position:updated`/`position:closed`; reads radar via `getSuggestionStore().getRecent(20, { status: "pending" })` refreshed on a 2s interval (store is sync; no event hook exists — do not add one). Approvals sort: `critical > high > medium > low`, then `requestedAt`-order as received.

Layout (use `FullscreenLayout` with a 1-line header; theme tokens — section headers `uiBrand`, risk badges `riskCritical`/`riskDanger`/`riskWarning`/`riskSafe`, P&L `moneyProfit`/`moneyLoss`):

```
 TRADE QUEUE                                      ask · 14:32:08
────────────────────────────────────────────────────────────────
 APPROVALS (2)
 ▸ ⛔ CRITICAL  place_order — BTC buy 0.5 @ market
      Why: order notional 12.4% of equity exceeds 5% cap
      y approve once · n deny · m reduce to 0.2 BTC
   ● high      cancel_all_orders — kraken
────────────────────────────────────────────────────────────────
 POSITIONS (2)                                     P&L +823.00
 SYM   SIDE  QTY    ENTRY    LAST     PNL      RISK     ACCT%
 BTC   LONG  0.25   67,432   68,100   +668.00  2.3%     0.8%
 ETH   SHORT 5.00   3,821    3,790    +155.00  NO STOP  —
────────────────────────────────────────────────────────────────
 RADAR (3 pending)
 ▸ ▲ VOLATILITY  BTC 1h realized vol 2.4× baseline
      a ack · p pass · d mute category 60m
   ◉ WHALE MOVE  4,200 BTC moved to Coinbase
────────────────────────────────────────────────────────────────
 Tab section · ↑↓ select · q / Esc back to chat
```

Key model (single `useInput` inside the view — no other listener is mounted):
- `Tab` / `Shift+Tab` — cycle section focus (Approvals → Positions → Radar); `↑`/`↓` — move row cursor within the focused section.
- Approvals section: `y` → `onApprovalDecision("once", id)`, `n` → `("deny", id)`, `m` → `("modify", id)` only when `counterOffer` present (hint line only shows `m reduce to …` when present). Mirrors the existing `KeyContext.Approval` y/n/a vocabulary; deliberately no `a` (always-allow) from the panel — that stays a deliberate inline-dialog act.
- Radar section: `a` → `onRadarAction("/ack <id>")`, `p` → `"/pass <id>"`, `d` → `"/snooze <category> 60"` (same semantics as item 19).
- Positions section: read-only in v1.
- `q` or `Esc` → `onClose()`.
- RISK / ACCT% columns reuse the item-20 helpers (`positionRisk.ts`) — land item 20 first.

**Files:**
- CREATE `src/tui/utils/altScreen.ts` (+ `altScreen.test.ts`).
- CREATE `src/tui/utils/inkInstance.ts`.
- CREATE `src/tui/components/views/TradeQueueView.tsx`.
- EDIT `src/tui/index.tsx` — capture render instance into `setInkInstance` (anchor: the `render(<App />…)` call in `startGordonTUI`).
- EDIT `src/tui/state/types.ts` / `reducer.ts` / `selectors.ts` — `OverlayViewId`, `activeOverlayView`, `OPEN_OVERLAY_VIEW` / `CLOSE_OVERLAY_VIEW`, selector.
- EDIT `src/tui/keybindings/keybindings.ts` — `toggleTradeQueue` action + ctrl+t default.
- EDIT `src/tui/App.tsx` — keybinding case, overlay-instead-of-chat-tree branch, alt-screen effect, bridge diff forwarding (~line 740 block).
- EDIT `src/app/slash/slashCommands.ts` — `/queue` seed + `DIRECT_MENU_TARGETS` entry.
- EDIT `src/tui/bridge/menuHandlers.ts` — `case "trade-queue"` in `handleUIMenuCommand`.

**Acceptance criteria:**
1. `bun test src/tui` passes: reducer handles open/close (palette force-closed on open); `altScreen` writes `\x1b[?1049h` exactly once on enter and `\x1b[?1049l` on leave against a fake TTY stream, and is a no-op when `TERM=dumb` or non-TTY.
2. In the running TUI: Ctrl+T enters a full-screen trade-queue; pressing q returns to chat with scrollback intact (previous messages still visible, no duplicated frames).
3. `/queue` opens the same view; with a pending approval queued, `y` resolves it (identical effect to the inline dialog's "Allow this time").
4. With radar pending suggestions, `a` on a selected card records an accept (visible via `/radar status` counts).
5. Typecheck clean.

**Test plan:** `altScreen.test.ts` — capability gating (env injection per `detectTerminalCapability`'s test pattern in `syncTerminal.test.ts`), idempotent leave, exact escape sequences. `reducer.test.ts` (CREATE `src/tui/state/reducer.test.ts` if absent) — open/close actions, palette interaction. `TradeQueueView` logic: extract `sortApprovalsByRisk(approvals)` as an exported pure helper and test ordering (critical first, stable within class).

**Gotchas:**
- The locked decision is hybrid: chat NEVER moves to alt-screen; only this view (and item 18) does. Do not wire `?1049` into the main render path or `syncTerminal`'s BSU/ESU machinery.
- tmux strips unknown DEC modes per `syncTerminal.ts` comments — `hasAlternateScreen` is still true there (1049 is broadly supported, incl. tmux/Windows Terminal); only `TERM=dumb` is excluded. Trust `detectTerminalCapability`, don't invent new detection.
- Approval resolution MUST go through `handleApprovalDecision` (it owns counter-offer denial reasons, risk-kernel health, runtime approve/deny) — never call `getRuntime()?.approvePendingRequest` directly from the view.
- `getPositionStore()` is async and touches disk; call it in `useEffect`, never at module top level.
- Suggestion-store polling: 2s `setInterval`, cleared on unmount. Don't subscribe to the EventBus for radar — proactive cards arrive as chat messages, not as a store event.
- Ordering: item 20 (risk helpers) before this; item 18 reuses the same overlay plumbing (state field, alt-screen helper, keybinding pattern) — land 17 first.
- Item 9 (different writer) evicts dialog `useState`s into a provider; `activeOverlayView` already lives in the reducer so it is forward-compatible — don't add any `useState` for it.

---

### Item 18 — Safety dashboard (M, P3)

**Current state:**
- Kill switches: `src/infra/safety/killSwitches.ts` exports `isKillSwitchesEnabled(env?)`, `KillSwitchScope` (8 scopes: strategy/trader/account/client/instrument/venue/gateway/firm), `listTrippedSwitches(): Array<{ key: KillSwitchKey; reason: string; trippedAt: number }>`, `isExecutionAllowed(ctx)`. State persists to `~/.gordon/kill-switches.json`.
- Approval rules + history: the TUI's `SessionRuntime` (via `getRuntime()` from `src/tui/bridge/runtime.ts:294`) exposes `listApprovalRules(): RuntimeApprovalRule[]` and `getRecentApprovals(limit?): RuntimeApprovalRequest[]` (`src/runtime/session/SessionRuntime.ts:189,201`). `RuntimeApprovalRequest` (`src/runtime/contracts/types.ts:169`) has `status: "pending"|"approved"|"denied"|"expired"`, `reason?`, `actor?`, `decisionSource?: "human"|"rule"|"classifier"|"hook"`, `requestedAt`, `decidedAt?`. `RuntimeApprovalRule` has `toolName?`, `toolNamePattern?`, `permissionScope?`, `decision`, `scope`, `createdAt`, `createdBy`, `expiresAt?`.
- No UI surfaces any of this except `/runtime-approvals` text dumps. `EmergencyHalt` dialog exists but shows nothing about armed state.

**Problem:** The capital-safety plane is Gordon's moat and it is invisible — the trader cannot see what is armed, what rules auto-approve, or what was recently denied and why. Visible safety is what makes auto-mode trustable.

**Spec:**

Second alt-screen overlay reusing all item-17 plumbing (`activeOverlayView: "safety"`).

1. **Entry points:** `BindableAction` `"toggleSafetyDashboard"`, default `{ key: "ctrl+shift+d", action: "toggleSafetyDashboard" }`; slash seed `{ name: "safety", aliases: ["safety-dashboard"], description: "Safety dashboard — kill switches, approval rules, recent denials", usage: "/safety", category: "system", level: 1, action: "menu", target: "safety" }` + `DIRECT_MENU_TARGETS` entry + `case "safety"` in `handleUIMenuCommand` setting `activeOverlayView: "safety"`. App renders `<SafetyDashboardView/>` when `activeOverlayView === "safety"` (same effect/branch as item 17).

2. **Component** — CREATE `src/tui/components/views/SafetyDashboardView.tsx`:

```ts
export interface SafetyDashboardViewProps {
  permissionMode: PermissionMode;
  onClose: () => void;
}
/** Pure, exported for tests. */
export function summarizeApprovalVelocity(recent: RuntimeApprovalRequest[], nowMs: number): {
  approvedLastHour: number; deniedLastHour: number; autoApprovedLastHour: number; // decisionSource !== "human"
};
```

Data loading (all read-only, on mount + on `r`):
- `isKillSwitchesEnabled()` + `listTrippedSwitches()` — render all 8 scopes; a scope renders `armed` (`riskSafe`) unless a trip exists for it (any id), then `TRIPPED — <reason>` (`riskCritical`, bold). If the engine is disabled via `GORDON_KILL_SWITCHES=0`, banner line: `⚠ kill-switch engine DISABLED (GORDON_KILL_SWITCHES=0)` in `riskWarning`.
- `getRuntime()?.listApprovalRules() ?? []` — table: decision (`allow` `riskSafe` / `deny` `riskDanger`), tool (`toolName ?? toolNamePattern ?? "<scope-wide>"`), scope, createdBy, relative age, `expires <t>` when set.
- `getRuntime()?.getRecentApprovals(50) ?? []` filtered `status === "denied"` — time, toolName, `denied by <decisionSource>`, reason (truncate to one line).
- Velocity: `summarizeApprovalVelocity(recent, Date.now())` over the same 50.

```
 SAFETY                                           ask · 14:32:08
────────────────────────────────────────────────────────────────
 KILL SWITCHES                              engine: enabled
   firm        armed     │  instrument  TRIPPED — BTC spread anomaly
   venue       armed     │  account     armed
   strategy    armed     │  trader      armed
   client      armed     │  gateway     armed
────────────────────────────────────────────────────────────────
 APPROVAL RULES (3)
   allow  get_market_data        session     user      2h ago
   allow  kraken_*               persistent  user      1d ago
   deny   wallet_transfer        persistent  operator  3d ago
────────────────────────────────────────────────────────────────
 RECENT DENIALS (last 50 decisions)
   14:21  place_order        denied by rule — Blocked by session rule
   13:58  cancel_all_orders  denied by human — wrong venue
────────────────────────────────────────────────────────────────
 APPROVAL VELOCITY (1h)  approved 12 · denied 3 · auto 9
 q close · r refresh
```

Keys: `r` reload all four data sources, `q`/`Esc` → `onClose()`. No mutation keys in v1 — this is a read surface.

**Files:**
- CREATE `src/tui/components/views/SafetyDashboardView.tsx` (+ co-located `SafetyDashboardView.test.ts` for the pure helper).
- EDIT `src/tui/keybindings/keybindings.ts` — action + ctrl+shift+d default.
- EDIT `src/tui/App.tsx` — keybinding case + render branch (same region as item 17's).
- EDIT `src/app/slash/slashCommands.ts` + `src/tui/bridge/menuHandlers.ts` — `/safety` seed, target, handler case.

**Acceptance criteria:**
1. `bun test src/tui` — `summarizeApprovalVelocity` counts only last-hour decisions; `decisionSource !== "human"` approvals counted as auto.
2. In the TUI with no runtime denials: dashboard renders `RECENT DENIALS` section with `none` placeholder (copy verbatim: `   none in the last 50 decisions`).
3. Trip a switch (`/killswitch trip instrument BTC <reason>` or via `tripKillSwitch` in a scratch session) → dashboard shows `TRIPPED — <reason>` on the instrument row after `r`.
4. Esc returns to chat with scrollback intact. Typecheck clean.

**Test plan:** `SafetyDashboardView.test.ts` — `summarizeApprovalVelocity` window math (61-min-old decision excluded; pending excluded; rule/classifier/hook → auto bucket). Kill-switch row derivation: extract `deriveKillSwitchRows(enabled, tripped)` pure helper and test armed/tripped/disabled rendering inputs.

**Gotchas:**
- `getRuntime()` returns `null` before `initializeRuntime` completes — every accessor needs the `?? []` guard; render `runtime not ready` dim line instead of crashing.
- There is no rule-DELETE API on `SessionRuntime` — do not invent one for a `d` key; rules management stays in `/rules`.
- `listTrippedSwitches` reads module state loaded at startup (`reloadKillSwitchState`); the `r` key re-calls the list function — do NOT call `reloadKillSwitchState()` from the view (it clears + re-reads disk and could mask an in-memory trip in a race).
- Depends on item 17 landing first (overlay state, alt-screen helper, render-branch pattern).
- Read modules directly (`killSwitches.ts`, `getRuntime()`); do NOT add an agent tool for this — the surface stays at 22.

---

### Item 19 — Actionable radar cards (M, P3)

**Current state:**
- `src/tui/components/messages/ProactiveSuggestionMessage.tsx` renders radar cards from chat messages; suggestion identity is packed in `message.badge` as `"<category>:<id>:<confidence>"` (parsed at lines 33–35). Footer is read-only copy: `/ack <id> · /pass <id> · /snooze <category>`.
- Acting on suggestions already works via slash commands: `/ack` → tool `accept_proactive_suggestion`, `/pass` → `dismiss_proactive_suggestion`, `/snooze` → `suppress_proactive_category` (seeds at `src/app/slash/slashCommands.ts:689–720`). Engine APIs exist: `ProactiveEngine.accept(id)` / `.dismiss(id)` (`src/infra/proactive/engine/proactiveEngine.ts:184,197`); store: `getSuggestionStore().getRecent(1, { status: "pending" })` is synchronous.
- Keyboard reality: Ink delivers every keystroke to every mounted `useInput` (the backlog's "214 listeners" finding) — a bare `a/p/d` key while the prompt is focused would also type into `PromptInput` (`src/tui/components/layout/PromptInput.tsx`, local `value` state at ~line 105). So bare letters cannot be globally bound while the prompt accepts text; "analyze BTC" must never ack a card.

**Problem:** Radar cards demand a copy-paste of a truncated id into a slash command — friction that trains the trader to ignore the radar entirely.

**Spec — explicit radar focus (no typing collisions by construction):**

1. **State** — EDIT `src/tui/state/types.ts`:

```ts
export interface RadarFocus { id: string; category: string; title: string }
// AppState:
radarFocus: RadarFocus | null;   // INITIAL_STATE: null
// Actions:
| { type: "SET_RADAR_FOCUS"; focus: RadarFocus | null }
```

Selector `selectRadarFocus`. Reducer: plain set.

2. **Focus toggle** — `BindableAction` `"focusRadar"`, default `{ key: "ctrl+g", action: "focusRadar" }` in `keybindings.ts` `DEFAULT_BINDINGS`. In the App global `useInput` switch (~`App.tsx:900`): on `focusRadar`, if `radarFocus` is set → clear it; else resolve newest pending via `getSuggestionStore().getRecent(1, { status: "pending" })[0]` and dispatch `SET_RADAR_FOCUS` with `{ id, category, title }` (no-op + pass-through when none pending).

3. **Quick keys while focused** — CREATE `src/tui/input/radarQuickKeys.ts`:

```ts
/** Returns the slash command to submit for a quick key, or null. Pure. */
export function radarQuickKeyCommand(input: string, focus: RadarFocus | null): string | null;
// "a" → `/ack ${focus.id}` · "p" → `/pass ${focus.id}` · "d" → `/snooze ${focus.category} 60` · else null
```

In the App global `useInput`, BEFORE the `getActionsForKey` resolution: if `radarFocus !== null && !key.ctrl && !key.meta`, run `radarQuickKeyCommand(input, radarFocus)`; on a hit, dispatch `SET_RADAR_FOCUS` null, call `handleSubmit(cmd)`, and `return`. `Esc` while focused clears focus and returns (before the keybinding fallthrough).

4. **Prompt lockout** — EDIT `PromptInput` props (`interface Props`, `PromptInput.tsx` ~line 72): add `locked?: boolean`. When `locked`, its `useInput` handler returns immediately (no echo, no submit) — App passes `locked={radarFocus !== null}` at the render site (`App.tsx` ~2343). This is the single mechanism that makes bare `a/p/d` safe.

5. **Focus bar** — CREATE `src/tui/components/status/RadarFocusBar.tsx`:

```ts
export function RadarFocusBar({ focus }: { focus: RadarFocus }): JSX.Element;
```

Rendered by App directly above `PromptInput` only when focused. One bordered line, `uiFocus` border:

```
┃ RADAR ▸ VOLATILITY — BTC 1h realized vol 2.4× baseline
┃ a ack · p pass · d mute category 60m · Esc cancel
```

6. **Card copy** — EDIT `ProactiveSuggestionMessage.tsx` footer line to (verbatim):
`Ctrl+G to act · /ack {id10} · /pass {id10} · /snooze {category}` where `{id10}` is the existing `id.slice(0, 10)`.

7. **Auto-release:** when a streaming turn starts (`START_STREAMING` reducer case) clear `radarFocus` — the agent answering takes precedence, and stale focus must not eat keys.

**Files:**
- CREATE `src/tui/input/radarQuickKeys.ts` (+ `radarQuickKeys.test.ts`).
- CREATE `src/tui/components/status/RadarFocusBar.tsx`.
- EDIT `src/tui/state/types.ts` / `reducer.ts` / `selectors.ts` — `RadarFocus`, action, selector, `START_STREAMING` clears focus.
- EDIT `src/tui/keybindings/keybindings.ts` — `focusRadar` + ctrl+g.
- EDIT `src/tui/App.tsx` — quick-key branch in the global `useInput`, `focusRadar` case, `RadarFocusBar` mount, `locked` prop pass.
- EDIT `src/tui/components/layout/PromptInput.tsx` — `locked` prop early-return.
- EDIT `src/tui/components/messages/ProactiveSuggestionMessage.tsx` — footer copy.

**Acceptance criteria:**
1. `bun test src/tui`: `radarQuickKeyCommand("a", focus)` → `/ack <id>`; `"d"` → `/snooze <category> 60`; `"x"`/null-focus → null. Reducer: `SET_RADAR_FOCUS`, and `START_STREAMING` clears it.
2. TUI with a pending radar card: Ctrl+G shows the focus bar; typing `a` submits `/ack <id>` (visible as a user message + tool result) and the bar disappears; typing `analyze` BEFORE Ctrl+G types normally into the prompt (no ack fired).
3. Ctrl+G with no pending suggestions does nothing visible.
4. Esc while focused returns keystrokes to the prompt (echo works again). Typecheck clean.

**Test plan:** `radarQuickKeys.test.ts` — the four mappings, null focus, modifier rejection is the caller's job (document via test of pure function only). `reducer.test.ts` — focus set/clear + streaming auto-release.

**Gotchas:**
- Do NOT try bare global `a/p/d` without the focus state — every mounted `useInput` sees every key; the prompt would receive the letter. The `locked` prop + explicit focus is the collision-free design.
- Submit through `handleSubmit` (it queues during streaming and runs injection defense) — never call `ProactiveEngine.accept` directly from the TUI; the slash→tool path owns the feedback ledger + audit.
- `/snooze` takes a category + minutes (`suppress_proactive_category`); `d` is "mute category 60m", not a per-card dismiss — the copy above says so; keep it honest.
- Ctrl+G is free today (verified against both `DEFAULT_BINDINGS` tables); user overrides come from `~/.gordon/keybindings.json` automatically via `getActionsForKey`.
- Item 17's trade-queue radar section uses bare `a/p/d` safely because the chat tree (and `PromptInput`) is unmounted there — same `radarQuickKeyCommand` helper, reuse it.

---

### Item 20 — Position risk columns (S, P3)

**Current state:**
- `src/tui/components/status/LivePositions.tsx` — `Position { id, symbol, side, quantity, entryPrice, lastPrice, pnl, stopPrice?, openedAt }`, a `COLUMNS: Column<Position>[]` table (SYM/SIDE/QTY/ENTRY/LAST/PNL/STOP/DURATION, widths 8/6/8/10/10/10/10/8) rendered via `DataTable` from `../charts/DataTable.tsx` (`fmtNum`, `changeColor` helpers). Subscribes to `position:updated`/`position:closed`.
- **It never mounts:** the App-side seed `livePositions` (`App.tsx:607`) is a `useState` whose setter is never called anywhere (verified — sole reference), and both render sites gate on `livePositions.length > 0` (`App.tsx:1942`, `App.tsx:2318`). The component is dead UI today.
- Position truth: `getPositionStore().getActive(): Promise<PositionRecord[]>` (`src/core/positions/store.ts`); records carry `stopLoss?: number`, `entryPrice`, `quantity`, `side: "long"|"short"`, `symbol`.
- Equity: `GordonContext` resolved by the TUI bridge (`tuiContextResolver: GatewayContextResolver` in `src/tui/bridge/runtime.ts`, `.resolve(threadId)` — usage at `runtime.ts:194`) carries `portfolioValue`; fallback computation exists in `portfolioContextBuilder.buildFromExchange/buildFromBroker` (`src/core/risk-kernel/portfolio-context.ts:62–205`, returns `totalEquity`).

**Problem:** A positions table without "how far is my stop" and "what % of my account burns if it hits" is a price ticker, not a risk surface. Missing stops must be loud.

**Spec:**

1. **Risk math** — CREATE `src/tui/components/status/positionRisk.ts` (pure, shared with item 17):

```ts
import type { Position } from "./LivePositions.tsx";
/** Side-aware % distance from last price to stop. null when stopPrice missing or lastPrice <= 0.
 *  long: (last - stop) / last · short: (stop - last) / last. Negative ⇒ stop already breached. */
export function stopDistancePct(p: Pick<Position, "side" | "lastPrice" | "stopPrice">): number | null;
/** Capital at risk if the stop fills, as a fraction of equity. Loss measured from ENTRY (realized
 *  loss of the trade, conservative): long (entry−stop)·qty, short (stop−entry)·qty, floored at 0.
 *  null when stop missing or equity missing/<= 0. */
export function accountPctAtRisk(
  p: Pick<Position, "side" | "entryPrice" | "quantity" | "stopPrice">,
  accountEquity: number | null | undefined,
): number | null;
```

2. **Columns** — EDIT `COLUMNS` in `LivePositions.tsx`: insert after `stopPrice` (STOP):
- `RISK` (width 8, right-aligned): `stopDistancePct` formatted `"2.3%"` (1 decimal); when null → text `NO STOP`, `color: () => "red"`; when ≤ 0 → `"BREACH"` red.
- `ACCT%` (width 6, right-aligned): `accountPctAtRisk` formatted `"0.8%"`; null → `"—"`. `color`: `"red"` when ≥ 2% (one position risking ≥2% of the account is worth a glance), default otherwise.
(`DataTable.Column` is key-driven; since these are derived, precompute both onto the row objects before passing to `DataTable` — add derived fields `riskPct?: number | null` and `acctPct?: number | null` to the row mapping, keep the `Position` interface itself clean.)

3. **Equity** — CREATE `src/tui/hooks/useAccountEquity.ts`:

```ts
/** Resolves account equity once per mount + every 5 min. null while unknown/offline. Never throws. */
export function useAccountEquity(): number | null;
```

Backed by a new bridge accessor — EDIT `src/tui/bridge/runtime.ts` (beside `invalidateTuiContext`):

```ts
/** 60s-cached equity snapshot from the shared TUI context. null when no venue / on error. */
export async function getTuiAccountEquity(): Promise<number | null>;
```

Implementation: `tuiContextResolver.resolve("tui")` → prefer `ctx.portfolioValue > 0`; else if `ctx.exchange` → `(await portfolioContextBuilder.buildFromExchange(ctx.exchange)).totalEquity`; else if `ctx.broker` → `buildFromBroker`. Cache `{ value, at }` module-level (60s TTL); catch-all returns null.

4. **Make the component actually live** — in the same item (it is the component's item):
- EDIT `LivePositions.tsx`: on mount, seed from `getPositionStore().getActive()` (map `PositionRecord` → `Position`; `stopLoss` → `stopPrice`, `state`-active records only — `getActive` already filters); render `null` when `positions.length === 0` (self-gating); call `useAccountEquity()` internally — no new props needed except keeping `initialPositions` for tests.
- EDIT `App.tsx`: mount `<LivePositions />` unconditionally at the current site (~1942); DELETE the dead `livePositions` `useState` (line 607) and the dead second gate/usage (~2318–2321).

**Files:**
- CREATE `src/tui/components/status/positionRisk.ts` (+ `positionRisk.test.ts`).
- CREATE `src/tui/hooks/useAccountEquity.ts`.
- EDIT `src/tui/components/status/LivePositions.tsx` — columns, seeding, self-gating, equity hook.
- EDIT `src/tui/bridge/runtime.ts` — `getTuiAccountEquity` (anchor: below `invalidateTuiContext`).
- EDIT `src/tui/App.tsx` — unconditional mount; delete dead state + second usage.

**Acceptance criteria:**
1. `bun test src/tui` passes `positionRisk.test.ts`: long BTC entry 67,432 / stop 66,500 / last 68,100 / qty 0.25, equity 30,000 → `stopDistancePct ≈ 0.0235`, `accountPctAtRisk ≈ (932×0.25)/30000 ≈ 0.0078`; short symmetric case; missing stop → both null; equity 0/null → acct null; breached stop → negative distance.
2. With an open tracked position (paper mode), the TUI shows the table with RISK and ACCT% populated; removing the stop on a position shows red `NO STOP` and `—`.
3. No position open → no `OPEN POSITIONS` header rendered at all (self-gating).
4. Typecheck clean; `bun test src/tui` green.

**Test plan:** `positionRisk.test.ts` — the cases above plus rounding/format edges (don't test formatting strings, test numbers; formatting lives in the column `format`). No test for the hook (network-touching); its contract is "null on failure", enforced by the try/catch shape.

**Gotchas:**
- Column color callbacks in this file currently return raw names (`"green"`/`"red"`) — follow that existing `DataTable` pattern; the theme-token migration is item 28 (different writer), do not start it here.
- Loss is measured from ENTRY, not last price — that's the realized loss of the trade if stopped, and it's the number the risk classifier reasons about. Comment the WHY once in `accountPctAtRisk`.
- Total row width grows ~86 chars; acceptable for ≥100-col terminals, and `DataTable` handles its own clipping — do not drop existing columns.
- `getActive()` is async/disk — `useEffect` only.
- Item 17's TradeQueueView imports `stopDistancePct`/`accountPctAtRisk` from `positionRisk.ts` — keep them framework-free (no React imports).

---

### Item 21 — Workspace visual differentiation (M, P3)

**Current state:**
- `state.activeWorkspace: string | null` (`src/tui/state/types.ts:129`), set via `SET_ACTIVE_WORKSPACE` from the bridge: `handleWorkspaceMenuCommand` (`src/tui/bridge/menuHandlers.ts`, `case "workspace-market" | "workspace-plan" | "workspace-lab" | "workspace-monitor"` → values `"market" | "plan" | "lab" | "monitor"`; `case "chat"` → null), forwarded by the App diff block (`App.tsx:756–757`). Selector `selectActiveWorkspace` exists (`selectors.ts`).
- The only effect today is a system message ("Workspace: market. Context adjusted…") — all workspaces render identically.
- `WorkspaceId = "desk" | "market" | "plan" | "lab" | "monitor"` and `getQuickActionItems(context: QuickActionContext)` (per-workspace command shortlists) already exist in `src/app/slash/commandUx.ts:3,313`.
- Header: `GordonHeader` (`src/tui/components/layout/GordonHeader.tsx`) — compact one-line bar once conversation starts (`compact` prop), full card on empty state. No workspace prop.
- Theme: agent color tokens exist per `GordonTheme` (`agentScanner`, `agentPlanner`, `agentBacktester`, `agentMonitor`, …).

**Problem:** Switching workspace today changes nothing visible — the trader can't tell at a glance whether they're in the market-scan or the execution context, which undermines the whole lens concept.

**Spec (minimum viable per backlog: tinted header + workspace-scoped palette section):**

1. **Tint map** — add to `GordonHeader.tsx` (it is presentation-local, not state):

```ts
export const WORKSPACE_TINT: Record<string, keyof GordonTheme> = {
  market: "agentScanner", plan: "agentPlanner", lab: "agentBacktester", monitor: "agentMonitor",
};
```

2. **Header** — EDIT `GordonHeader`: add prop `workspace?: string | null`. Compact mode: after the `Gordon` word, render ` <Text color={tint} bold>[{workspace}]</Text>` when set (e.g. `≫ Gordon [market] · ask · …`); resolve `tint` via `useTheme()[WORKSPACE_TINT[workspace]]`, fall back to `uiBrand` for unknown values. Full card: `borderColor` becomes the tint when a workspace is active (overrides the current `gray`, but paper mode's `yellow` border wins — PAPER visibility is item 4's domain and outranks decoration). EDIT `App.tsx` to pass `workspace={activeWorkspace}` at both `GordonHeader` render sites (grep `<GordonHeader` in `App.tsx`).

3. **Palette scoping** — EDIT `CommandPalette.tsx` (after item 16): new optional prop

```ts
workspaceSection?: { label: string; items: PaletteItem[] };
```

Rendered as the FIRST group (header `label`, tinted with the workspace token passed as part of label rendering — simplest: include a `colorToken?: keyof GordonTheme` on the section), only when `query` is empty (search results replace it). EDIT `App.tsx`: build it with `useMemo` from `activeWorkspace`:

```ts
const workspaceSection = activeWorkspace ? {
  label: `WORKSPACE: ${activeWorkspace.toUpperCase()}`,
  items: getQuickActionItems({
    permissionMode, workspace: activeWorkspace as WorkspaceId,
    setupComplete: !showSetup, hasExchange: connectivityHints.hasExchange, hasBroker: connectivityHints.hasBroker,
  }).map(qa => ({ id: `ws:${qa.command}`, label: qa.command, description: qa.label })),
} : undefined;
```

(`handlePaletteSelect` already submits `item.label`, and quick-action `command`s are full invocations like `/analyze BTC` — works unchanged.)

Mockup (palette opened inside the market workspace, empty query):

```
│ ▶ █                                                          │
│ WORKSPACE: MARKET                                            │
│ ▸ /scan          Scan                                        │
│   /trending      Trending                                    │
│   /analyze BTC   Analyze                                     │
│ ◆ DISCOVER                                                   │
│   ...                                                        │
```

**Files:**
- EDIT `src/tui/components/layout/GordonHeader.tsx` — `WORKSPACE_TINT`, `workspace` prop, compact chip + full-card border tint.
- EDIT `src/tui/components/CommandPalette.tsx` — `workspaceSection` prop, first-group render on empty query.
- EDIT `src/tui/App.tsx` — pass `workspace` to both header sites; build + pass `workspaceSection`.

**Acceptance criteria:**
1. TUI: `/market` → compact header shows a tinted `[market]` chip; `/chat` removes it.
2. Ctrl+P inside `/plan` workspace with empty query → first group is `WORKSPACE: PLAN` with that workspace's 5 quick actions; typing any query hides the section.
3. Selecting `/plan BTC` from the section submits it (user message appears).
4. Typecheck clean; `bun test src/tui` green (no behavior regressions in palette tests from item 16).

**Test plan:** Extend item 16's grouping test file: `groupPaletteItems` untouched by section (section is render-level); add a small test for a new pure helper if extracted (`buildWorkspaceSection(workspace, ctx)` — optional). Header chip is presentation-only; no test.

**Gotchas:**
- `activeWorkspace` is typed `string | null` in state but the real values are the four workspace ids — do not "fix" the state type (the bridge writes via `any`-typed setState; tightening it is item-9-adjacent churn). Cast at the `getQuickActionItems` call as shown.
- `lab` has no dedicated agent token semantics — `agentBacktester` is the deliberate choice (lab = backtesting/strategy work).
- Order: requires item 16's grouped palette. Don't tint message bubbles or borders elsewhere — header + palette only (minimum viable, per the locked backlog scope).
- `useTheme` lives at `src/tui/themes/ThemeProvider.tsx`; `GordonHeader` currently hardcodes `rgb(52,238,176)` — leave existing hardcodes alone (item 28's migration), only the NEW chip/border resolve via tokens.

---

### Item 22 — Pager overlay for dense output (M, P3)

**Current state:**
- No pager exists. Long output handling today: `CollapsibleOutput` (`src/tui/components/display/CollapsibleOutput.tsx`) — inline truncate at `maxLines=10` with a Ctrl+E expand that still floods scrollback when expanded; `ScrollBox`/`ScrollKeybindingHandler` scroll the whole transcript, not a single artifact.
- Dense producers (verified): `case "journal"` in `src/tui/bridge/menuHandlers.ts:889` (trade-journal dump via `addMessage`), `case "action-log"` (same file), `/runtime-transcript` (`handleRuntimeMenuCommand`), `/audit` — all emit one giant chat message.
- `Dialog` design-system wrapper exists (`src/tui/design-system/Dialog.tsx` — title/border/Esc-close) but is width-60 modal chrome, not a paged reader; the pager needs its own layout.

**Problem:** A 400-line journal dump destroys the chat scrollback that the hybrid decision exists to protect. Dense artifacts need a paged reader that leaves no residue in the transcript (Hermes steal).

**Spec:**

1. **State** — EDIT `src/tui/state/types.ts`:

```ts
export interface PagerContent { title: string; content: string }
// AppState:
pager: PagerContent | null;   // INITIAL_STATE: null
// Actions:
| { type: "OPEN_PAGER"; pager: PagerContent }
| { type: "CLOSE_PAGER" }
```

Selector `selectPager`. Reducer: set/clear.

2. **Component** — CREATE `src/tui/components/dialogs/PagerDialog.tsx`:

```ts
export interface PagerDialogProps { title: string; content: string; onClose: () => void }
export function PagerDialog(props: PagerDialogProps): JSX.Element;
/** Pure, exported for tests. pageSize >= 1. */
export function paginate(lines: string[], pageSize: number): { pages: string[][]; pageCount: number };
```

Layout: full terminal width/height (`useStdout` rows/cols), border `uiBorder`, title line `uiBrand` bold, body = current page lines, footer reverse-video. `pageSize = rows - 4` (title + top/bottom border + footer). Keys (own `useInput`): `space`/`pagedown`/`→` next page; `b`/`pageup`/`←` previous; `↓`/`↑` scroll by one line (line offset within the flattened content, page indicator derived from offset); `g`/`G` top/end; `q`/`Esc` → `onClose()`. Footer copy verbatim:

```
 {title} — Page {n}/{m} · space next · b back · g/G top/end · q close
```

Mockup:

```
╭ Trade Journal ────────────────────────────────────────────────╮
│ 2026-06-11 14:02  BTC long 0.25 @ 67,432 — plan pl_88a1       │
│   rationale: regime trend-up, RSI reset, stop 66,500          │
│ 2026-06-11 15:40  observation: funding flipped positive       │
│ …                                                             │
│                                                               │
│ Trade Journal — Page 2/7 · space next · b back · g/G · q close│
╰───────────────────────────────────────────────────────────────╯
```

3. **Mount + suppression** — EDIT `App.tsx`: render `<PagerDialog/>` in the overlay region (beside the `showPalette` block, ~1977) when `state.pager` set; add `!!pager` to the `anyDialogOpen` expression (`App.tsx:649`) so transcript scroll and other bindings suspend.

4. **Routing — which outputs go through it:**
- **Bridge dumps (primary):** define `export const PAGER_LINE_THRESHOLD = 60;` in `PagerDialog.tsx`. In `menuHandlers.ts`, for `case "journal"`, `case "action-log"`, and the `/runtime-transcript` handler: when the formatted output exceeds the threshold (`out.split("\n").length > PAGER_LINE_THRESHOLD`), `setState(prev => ({ ...prev, pager: { title, content: out } }))` INSTEAD of `addMessage`; below threshold, behavior unchanged. Titles verbatim: `Trade Journal`, `Action Log`, `Runtime Transcript`. Forward in the App ~740 diff block: `if (next.pager !== prev.pager) dispatch(next.pager ? { type: "OPEN_PAGER", pager: next.pager } : { type: "CLOSE_PAGER" })` (and clear the bridge field on `CLOSE_PAGER` via the existing `stateUpdater` write-back pattern — mirror how `showPalette` round-trips).
- **Re-open last long output (secondary):** `BindableAction` `"openPager"`, default `{ key: "ctrl+o", action: "openPager" }`. App case: scan `state.messages` backwards for the first message with `content.split("\n").length > PAGER_LINE_THRESHOLD`; if found dispatch `OPEN_PAGER` with `{ title: "Last long output", content }`. Pure helper `findLastLongMessage(messages: Message[], threshold: number): Message | null` exported from `PagerDialog.tsx` for tests.

**Files:**
- CREATE `src/tui/components/dialogs/PagerDialog.tsx` (+ `PagerDialog.test.ts` for `paginate` + `findLastLongMessage`).
- EDIT `src/tui/state/types.ts` / `reducer.ts` / `selectors.ts` — `PagerContent`, actions, selector.
- EDIT `src/tui/App.tsx` — render site, `anyDialogOpen`, `openPager` keybinding case, bridge diff forwarding.
- EDIT `src/tui/keybindings/keybindings.ts` — `openPager` + ctrl+o default.
- EDIT `src/tui/bridge/menuHandlers.ts` — threshold routing in `case "journal"`, `case "action-log"`, runtime-transcript handler.

**Acceptance criteria:**
1. `bun test src/tui`: `paginate(120 lines, 20)` → 6 pages, last page partial; `pageSize 1` works; `findLastLongMessage` skips short messages and returns the newest long one.
2. TUI: `/journal` with >60 lines of entries opens the pager (no giant chat message appended — scrollback unchanged after `q`); with few entries it still prints inline as today.
3. In the pager: `space` advances, footer shows `Page 2/{m}`, `G` jumps to last page, `q` closes and the prompt accepts typing again.
4. Ctrl+O after a long tool result re-opens it in the pager. Typecheck clean.

**Gotchas:**
- The pager is an inline overlay (Dialog-style), NOT an alt-screen view — items 17/18 own alt-screen; a pager must be light enough to pop over chat without buffer switching. Do not reuse `altScreen.ts` here.
- Don't gut `CollapsibleOutput` — it remains correct for mid-sized tool results; the pager handles the >60-line class. No migration of its call sites in this item.
- `menuHandlers` writes the legacy bridge state; the pager field must round-trip through the App ~740 diff block exactly like `showPalette` does, including clearing the bridge-side field on close — otherwise the pager re-opens on the next unrelated bridge write.
- Ctrl+O is free (verified against both binding tables). `ScrollKeybindingHandler` j/k must be suppressed while the pager is open — covered by adding `!!pager` to `anyDialogOpen` (the `scrollEnabled={!showPalette && !anyDialogOpen}` pass at `App.tsx:1851`).
- Keep `paginate` framework-free for tests; the component derives the page from a line offset so ↑/↓ and space/b compose without two sources of truth.
