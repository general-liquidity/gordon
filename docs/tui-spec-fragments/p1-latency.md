# P1 — Latency plan (Items 6–13)

Section owner: p1-latency spec writer. Expanded from `docs/TUI_DESIGN_BACKLOG.md` items 6–13. All file:line anchors verified against the tree on 2026-06-12; line numbers WILL drift — every edit is also anchored to a named function/region.

**Verified facts that correct the backlog** (the implementer must trust these over the backlog prose):

- **Stream batching already half-exists.** `src/tui/bridge/runtime.ts` `streamResponse()` already debounces `text_delta` at 100ms (lines 462–501, comment "matches Claude Code's STREAM_EVENT_FLUSH_INTERVAL_MS") with a trailing flush + a `step_complete` final commit. The remaining gaps are `thinking_delta` (per-token `setState`, lines 519–524) and double-dispatch per flush (see item 7).
- **Two streaming state slices are silently DROPPED today.** The `stateUpdater` diff-adapter in `src/tui/App.tsx` (`AppInner`, the `useCallback` block starting "── StateUpdater adapter ──", lines ~694–761) diffs a fixed list of fields. It has **no branch for `activeThinking` and no branch for `activeToolCalls`**, so every `thinking_delta` / `tool_call_start` / `tool_call_end` `setState` in `runtime.ts` computes a next-state object and then dispatches nothing. Consequences: `ThinkStep` (App.tsx ~1900) always renders its fallback text, and `ToolCallInline` (App.tsx ~1910) **never renders** — its data source, the local `const [activeToolCalls, setActiveToolCalls] = useState<ToolCallState[]>([])` at App.tsx ~685, has zero `setActiveToolCalls` call sites. Item 8 is a wiring fix, not a new feature.
- **`useInput` count is 118, not 214.** `grep useInput\(` over `src/tui` = 118 call sites across 116 files. Each one (when mounted) independently subscribes to the stdin EventEmitter and re-parses every keystroke (`src/tui/ink-custom/hooks/use-input.ts`, owned port).
- **Dialog toggles: 59 `const [show…] = useState` in `AppInner`** (App.tsx lines ~517–606; 80 `useState` total in the file). `anyDialogOpen` is a 14-line boolean OR (App.tsx ~649–661).
- **Streaming text is invisible by design.** `VirtualMessageList` filters `m.streaming` messages out and `LIVE_TAIL = 0` — responses appear all-at-once on completion (src/tui/components/display/VirtualMessageList.tsx:33–57). So the 100ms `SET_MESSAGES` flushes during streaming re-render the tree for **no visible output**. Item 7 exploits this.
- **Framebuffer status:** the import swap to `src/tui/ink-custom` is already DONE everywhere (the `ink-custom/README.md` "NOT ACTIVATED" banner is stale — it refers to the custom *pipeline*, not the import path). The custom cell-diff pipeline is opt-in via `GORDON_CUSTOM_RENDER=1`, default OFF after a rollback for mount-time cell-interleaving bugs (`src/tui/ink-custom/render.ts` `shouldUseCustomRenderer()`, comment lines ~102–114).
- **No component-render test infra exists.** All 29 `src/tui` tests are pure-logic `bun:test` files (no ink-testing-library in package.json). Every acceptance criterion below that needs automation is therefore phrased against pure modules (reducer, flusher, coalescer, budget, focus-stack); visual criteria are manual run-the-app checks.

Shared repo conventions (repeat: they bite): `.ts`/`.tsx` extensions on relative imports; co-located `bun:test` files; typecheck `bun tsc --noEmit -p tsconfig.json`; **never bare `bun test`** — always `bun test src/tui`; state changes go through `src/tui/state/` reducer actions (SCREAMING_SNAKE verb convention per `types.ts`), not new `useState` in App.tsx; theme tokens from `src/tui/design-system/` + `themes/`; the 22-tool agent surface is untouched by all of P1 (pure UI work); no backwards-compat shims; comments only for non-obvious WHY.

---

### Item 6 — Keystroke-echo independence (S, Tier 1)

**Current state:** `PromptInput` (`src/tui/components/layout/PromptInput.tsx`, `export function PromptInput` at line 89) is a plain function component — not `React.memo`. It is mounted at the bottom of `AppInner` (App.tsx ~2343) with 9 props: `onSubmit, placeholder, permissionMode, activeAgentCount, activeAgentName, isStreaming, autonomousActive, autonomousStrategyCount, vimMode`. Its keystroke echo is local `useState` (`value`, `cursorPos`) — already isolated downward — but every **parent** commit (100ms stream flushes, every `INJECT_NOTIFICATION`, every market event, every spinner tick that re-renders `AppInner`) reconciles `PromptInput` and its slash-typeahead subtree too, and Ink paints are serialized, so a queued parent render delays the echo paint. `onSubmit` = `handleSubmit`, already a `useCallback` (App.tsx ~946). `placeholder` is computed from `EXAMPLE_PROMPTS[exampleIdx]` + connectivity (App.tsx ~1820–1841, region comment "Placeholder text for PromptInput") — `exampleIdx` is a mount-stable `useState(() => …)`, so the string only changes when `isStreaming`/connectivity flips. `MessageBubble` is already memoized with custom equality (MessageBubble.tsx:159–168) — do not redo it.

**Problem:** typing must feel like a native terminal even while Gordon is streaming a scan or a burst of position events lands; today every parent commit competes with character echo. This is the single highest-leverage "feels fast" change for a vibe trader who types while the agent works.

**Spec:**

1. Memoize `PromptInput`:

```ts
export const PromptInput = React.memo(function PromptInput({ … }: Props) { … });
```

Default shallow comparison is sufficient once props are primitives + a stable callback (they already are — verify no object/array props get added during item 8).

2. Extract the status line (App.tsx ~2290–2335, region comment "Status bar above input (Codex pattern…)") into a memoized component so its token-count text churn doesn't ride on `AppInner`'s render path decisions:

```ts
// CREATE src/tui/components/layout/StatusLine.tsx
interface StatusLineProps {
  memoryUsageRatio: number;
  liveContextTokens: number;
  lastTurnDurationMs: number;
  lastTurnTokens: number;
  autonomousActive: boolean;
  positionCount: number;
  contextLimit: number;
}
export const StatusLine = React.memo(function StatusLine(props: StatusLineProps): React.ReactElement;
```

Move `formatTokenCount` / `formatElapsedMs` (App.tsx ~167–178) with it; keep `CostDisplay` inside `StatusLine` (it self-subscribes).

3. Hoist `EXAMPLE_PROMPTS` to module scope (it is re-allocated per render today) and compute `placeholder` in a `useMemo` keyed on `[isStreaming, connectivityHints.hasExchange, connectivityHints.hasBroker]`.

4. Add a perceived-latency probe to the diagnostics layer (consumed by item 12): mark keystrokes so the next stdout frame is attributable.

```ts
// EDIT src/tui/diagnostics/performanceMonitor.ts — add:
export type InteractionKind = "keystroke" | "stream" | "other";
export function markInteraction(kind: InteractionKind): void;   // records hr-timestamp
export function takeInteractionMark(): { kind: InteractionKind; atMs: number } | null; // consumed by the stdout tap
```

`installStdoutTap` attributes each frame to the pending mark (then clears it). `PromptInput`'s `useInput` handler calls `markInteraction("keystroke")` as its first statement; the item-7 flusher calls `markInteraction("stream")` before dispatching.

**Files:**
- EDIT `src/tui/components/layout/PromptInput.tsx` — wrap in `React.memo`; add `markInteraction("keystroke")` at top of the `useInput` callback (import from `../../diagnostics/performanceMonitor.ts`).
- CREATE `src/tui/components/layout/StatusLine.tsx` — memoized status row extracted from `AppInner`.
- EDIT `src/tui/App.tsx` — replace the inline status-bar JSX with `<StatusLine …/>`; hoist `EXAMPLE_PROMPTS`; `useMemo` the placeholder.
- EDIT `src/tui/diagnostics/performanceMonitor.ts` — `markInteraction` / `takeInteractionMark` + frame attribution in `installStdoutTap`.

**Acceptance criteria:**
1. `bun tsc --noEmit -p tsconfig.json` clean.
2. `bun test src/tui` green.
3. Manual: run the TUI (`bun run src/index.tsx` or the project's launch command), start a long streaming response (`/scan`), type continuously into the prompt — characters echo without visible stalls while tokens stream.
4. With `GORDON_PERF_LOG=/tmp/perf.jsonl` set, the JSONL snapshots include frames attributed to `keystroke` (verify the field appears — exact budget enforcement is item 12).
5. React DevTools-style verification not available; instead: add a temporary `console.error` in `PromptInput` body, dispatch a notification via another terminal event, observe `PromptInput` does NOT log (memo bailout) while a keystroke DOES. Remove the probe before commit.

**Test plan:**
- `src/tui/diagnostics/performanceMonitor.test.ts` (extend): `markInteraction` → `takeInteractionMark` returns the kind once then null; stdout-tap attribution sets the kind on the recorded frame event.

**Gotchas:**
- `PromptInput` props must STAY primitive/stable. Item 8 must NOT add an `activeToolCalls` array prop to `PromptInput` (the spinner already receives `activeToolName` as a string — keep it that way).
- Do not memoize by converting `AppInner` reads to context-free globals — state reads stay `useAppState(selector)`.
- `useInput` keeps firing on every keystroke regardless of memo; memo only skips reconciliation. That is the point — do not try to "pause" `useInput`.
- Do not touch `MessageBubble` here (already memoized; item 11 covers row memoization elsewhere).
- The cursor is deliberately non-blinking (PromptInput.tsx comment ~490) — do not "improve" it; the static cursor is a scroll-stability decision.

---

### Item 7 — Stream batching: close the remaining per-token paths (S, Tier 1)

**Current state:** `streamResponse()` in `src/tui/bridge/runtime.ts` (function starts ~line 425):
- `text_delta` (case at ~462): already debounced to ≤1 `setState` per 100ms with trailing flush (`lastFlushTime` / `flushPending` locals) + final commit in `step_complete` (~504). Each flush calls `setState` once, but the `stateUpdater` adapter (App.tsx ~694) turns it into **two** dispatches: `SET_MESSAGES` (full array copy) + `SET_STREAM_BUFFER`. Two store notifications per flush; React 18 auto-batching usually merges the commits, but every `useSyncExternalStore` subscriber runs its selector twice.
- `thinking_delta` (~519): `setState` per token, AND the adapter has no `activeThinking` diff branch, so nothing dispatches — wasted work per token plus a real bug (`ThinkStep` at App.tsx ~1900 always shows the fallback `"Evaluating with <agent>…"`).
- `state/types.ts` Action union (lines 175–219) has no thinking action; `reducer.ts` `START_STREAMING`/`STOP_STREAMING`/`RESET_STREAM_STATE` don't reset `activeThinking` (check `RESET_STREAM_STATE` in reducer.ts and fix while there).

**Problem:** thinking tokens arrive faster than text tokens on extended-thinking turns; per-token object churn during a scan turn is pure waste, and the trader never sees the live reasoning the UI was built to show.

**Spec:**

1. Extract a shared flusher so text and thinking use one mechanism:

```ts
// CREATE src/tui/bridge/streamFlusher.ts
export const STREAM_FLUSH_INTERVAL_MS = 100;

export interface StreamFlusher {
  /** Append a chunk; schedules a flush if none pending. */
  push(chunk: string): void;
  /** Flush immediately (end-of-step / done). Idempotent. */
  flushNow(): void;
  /** Cancel pending timer without flushing (error/abort path). */
  dispose(): void;
  /** Current accumulated text (for final-commit reuse). */
  readonly buffer: string;
}

export function createStreamFlusher(
  onFlush: (accumulated: string) => void,
  intervalMs: number = STREAM_FLUSH_INTERVAL_MS,
): StreamFlusher;
```

Semantics: leading-edge flush when ≥`intervalMs` since last flush, else trailing `setTimeout` for the remainder — i.e. exactly the existing inline logic at runtime.ts:474–499, factored out. `onFlush` receives the FULL accumulated buffer (not the delta), matching current behavior.

2. New action + state plumbing for thinking:

```ts
// EDIT src/tui/state/types.ts — Action union:
| { type: "SET_ACTIVE_THINKING"; thinking: string }
```

Reducer: `case "SET_ACTIVE_THINKING": return { ...state, activeThinking: action.thinking };` and add `activeThinking: ""` to the `START_STREAMING`, `STOP_STREAMING`, and `RESET_STREAM_STATE` results so stale reasoning never leaks across turns.

3. Single-dispatch text flush:

```ts
// EDIT src/tui/state/types.ts — Action union:
| { type: "UPDATE_STREAMING_MESSAGE"; id: string; content: string }
```

Reducer: replace the content of the message whose `id` matches (scan from the END of `messages` — the streaming placeholder is last; bail unchanged if not found) AND set `streamBuffer: action.content` in the same returned state. One dispatch, one notification.

4. Rewire `streamResponse`:
- `text_delta`: `textFlusher.push(chunk)` where `textFlusher = createStreamFlusher((content) => setState(prev => /* same updater as today, single message-content+streamBuffer update */))`. Delete the inline `lastFlushTime`/`flushPending` locals. Keep the `lastEventWasToolEnd` paragraph-break logic before `push`.
- `thinking_delta`: `thinkingFlusher.push(event.content ?? "")` with `onFlush` doing `setState(prev => ({ ...prev, activeThinking: thinkingFlusher.buffer }))`.
- `step_complete` / `done`: call `textFlusher.flushNow()` (replaces the duplicated final-commit `setState`); `finally`-block calls `dispose()` on both.
- Call `markInteraction("stream")` (item 6) inside each `onFlush` before `setState`.

5. `stateUpdater` adapter (App.tsx): add the missing branch:

```ts
if (next.activeThinking !== prev.activeThinking) {
  dispatch({ type: "SET_ACTIVE_THINKING", thinking: next.activeThinking });
}
```

and route the messages+streamBuffer pair through `UPDATE_STREAMING_MESSAGE` when ONLY the last message's content and streamBuffer changed (cheap check: `next.streamBuffer !== prev.streamBuffer && next.messages.length === prev.messages.length`); otherwise keep the existing `SET_MESSAGES`/`SET_STREAM_BUFFER` fallback branches (they still serve non-streaming paths).

**Files:**
- CREATE `src/tui/bridge/streamFlusher.ts` (+ co-located test).
- EDIT `src/tui/bridge/runtime.ts` — `streamResponse()`: replace inline debounce in `text_delta`, batch `thinking_delta`, `flushNow()` at `step_complete`/`done`, dispose in `finally`.
- EDIT `src/tui/state/types.ts` — `SET_ACTIVE_THINKING`, `UPDATE_STREAMING_MESSAGE`.
- EDIT `src/tui/state/reducer.ts` — the two new cases + `activeThinking: ""` resets in the three stream-lifecycle cases.
- EDIT `src/tui/App.tsx` — `stateUpdater` adapter branches.

**Acceptance criteria:**
1. `bun test src/tui/bridge/streamFlusher.test.ts`: pushing 50 chunks over a fake 200ms yields ≤ 3 `onFlush` calls; final `flushNow()` delivers the complete concatenation; `dispose()` after `push` never calls `onFlush`.
2. `bun test src/tui/state` reducer cases: `SET_ACTIVE_THINKING` sets; `STOP_STREAMING` clears `activeThinking`; `UPDATE_STREAMING_MESSAGE` updates last-matching message content AND `streamBuffer` in one state transition, returns same reference when id absent.
3. Manual: trigger an extended-thinking turn — `ThinkStep` shows live reasoning text (not the `"Evaluating with …"` fallback) updating ~10×/s max.
4. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Test plan:**
- CREATE `src/tui/bridge/streamFlusher.test.ts` — cases above plus: leading-edge immediate flush on first push after a quiet period; trailing flush fires once per burst (use bun's fake timers or real 30ms intervals with small `intervalMs`).
- EXTEND `src/tui/state/reducer.test.ts` if it exists, else CREATE it with the new cases (keep it pure — `appReducer(state, action)` in/out).

**Gotchas:**
- `onFlush` must read the flusher's OWN buffer; do not capture `responseContent` (runtime.ts keeps a separate `responseContent` for the paragraph-break + done-path — either make the flusher the single owner of the text or keep them in sync; prefer single owner: replace `responseContent` reads with `textFlusher.buffer`).
- The `done` handler (runtime.ts ~606) builds the final message from `responseContent` — update it to `textFlusher.buffer` if you make the flusher the owner.
- DO NOT change `STREAM_FLUSH_INTERVAL_MS` to <50ms "for smoothness": streaming text is invisible during the turn (VirtualMessageList filters streaming messages) — flushes buy nothing visually; they only keep `streamBuffer`-dependent UI (ThinkStep gating, future live tail) fresh.
- `thinking_delta` previously dispatched nothing — adding the adapter branch will introduce NEW renders. The 100ms batching must land in the same commit as the branch, never separately.
- Don't refactor the rest of the giant `streamResponse` switch (orthogonal-damage rule).

---

### Item 8 — Interim tool-progress streaming (M, Tier 1)

**Current state:** `runtime.ts` `tool_call_start` (~560) and `tool_call_end` (~584) already maintain a correct `activeToolCalls` array on the setState-shaped state (id, toolName, args, status, 200-char result, duration). The display component is fully built: `ToolCallInline` (`src/tui/components/status/ToolCallInline.tsx`) — memoized rows, cached label mapping for ~300 tools, ≥4-completed collapse with `Ctrl+O` expand, `d` detail dialog. App.tsx renders it at ~1910 (`isStreaming && activeToolCalls.length > 0`). **The pipe between them is severed**: `AppState` has no `activeToolCalls` field, the `stateUpdater` adapter has no diff branch, and App.tsx's local `activeToolCalls` useState (~685) is never written. The user sees only `TradingSpinner` (whose `activeToolName` prop is also permanently `undefined` for the same reason). On `done`, completed calls ARE persisted as `tool` variant messages via `prev.activeToolCalls` inside the same setState world (runtime.ts ~750–760) — that path works because it never crosses the adapter.

**Problem:** during a 30s scan the trader stares at a mute spinner with no evidence Gordon is working — the Hermes-gap item with the highest trust payoff ("Fetching BTC candles… ✓ 2.1s" beats any spinner).

**Spec:**

1. Promote `activeToolCalls` to real state:

```ts
// EDIT src/tui/state/types.ts
import type { ToolCallState } from "../components/status/ToolCallInline.tsx"; // same convention as Message/ApprovalRequest imports

export interface AppState {
  // … existing …
  activeToolCalls: ToolCallState[];
}
// INITIAL_STATE: activeToolCalls: [],
// Action union:
| { type: "SET_ACTIVE_TOOL_CALLS"; calls: ToolCallState[] }
```

Reducer: `case "SET_ACTIVE_TOOL_CALLS": return { ...state, activeToolCalls: action.calls };` and clear to `[]` in `START_STREAMING`, `STOP_STREAMING`, `RESET_STREAM_STATE`.

2. Adapter branch (App.tsx `stateUpdater`):

```ts
if (next.activeToolCalls !== prev.activeToolCalls) {
  dispatch({ type: "SET_ACTIVE_TOOL_CALLS", calls: next.activeToolCalls });
}
```

3. App.tsx: DELETE the dead `const [activeToolCalls, setActiveToolCalls] = useState<ToolCallState[]>([])` (~685); replace with `const activeToolCalls = useAppState((s) => s.activeToolCalls);`. The two consumers (`<ToolCallInline calls={…}/>` ~1910 and `TradingSpinner activeToolName` ~1922) need no changes.

4. Live elapsed on running rows (the "Fetching… 2.1s" half of the Hermes pattern). In `ToolCallRow` (ToolCallInline.tsx ~291), when `call.status === "running"`, render elapsed time ticking at 1s granularity:

```ts
// inside ToolCallRow, running branch only:
const clockFrame = useAnimationClock(call.status === "running" ? 1000 : 0);
const elapsedS = Math.floor((Date.now() - call.startedAt) / 1000);
// render: <Text dimColor> {elapsedS}s</Text> after the args text
```

`useAnimationClock` already exists (`src/tui/hooks/animation/useAnimationClock.ts` — `BlinkingDot` in the same file shows the active/inactive subscription pattern; copy it).

5. Runtime `tool_call_end` matching bug (fix while wiring): it matches `tc.toolName === event.toolName && tc.status === "running"` via `.map` — parallel calls to the SAME tool all complete at once on the first end-event. Tighten: complete only the FIRST running match (find index, replace one).

**Files:**
- EDIT `src/tui/state/types.ts` — field + `SET_ACTIVE_TOOL_CALLS` + initial state.
- EDIT `src/tui/state/reducer.ts` — new case + clears in the three stream-lifecycle cases.
- EDIT `src/tui/App.tsx` — adapter branch; swap dead useState for selector.
- EDIT `src/tui/components/status/ToolCallInline.tsx` — running-row elapsed ticker (`ToolCallRow`).
- EDIT `src/tui/bridge/runtime.ts` — `tool_call_end` single-match completion.

**Acceptance criteria:**
1. Manual: run `/scan` — each tool call appears as `● <Label>  <symbol>  Ns` while running, flips to green ● with duration on completion; ≥4 completed collapse to the summary row; spinner verb shows the running tool name.
2. Reducer test: `SET_ACTIVE_TOOL_CALLS` sets; `STOP_STREAMING` clears.
3. Pure test for the end-matching: two running entries with same `toolName`, one end-event → exactly one flips to `success`.
4. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Test plan:**
- EXTEND `src/tui/state/reducer.test.ts` — the two cases above.
- The end-matching logic: extract as a pure helper `completeFirstRunningCall(calls: ToolCallState[], toolName: string, patch: Partial<ToolCallState>): ToolCallState[]` in `src/tui/bridge/toolCallTracking.ts` (CREATE, with co-located test) and call it from `tool_call_end` — keeps runtime.ts testable without mounting.

**Gotchas:**
- `state/types.ts` importing a type from a component file is the EXISTING convention (see `Message`, `ApprovalRequest` imports at the top) — don't relocate `ToolCallState` "to be clean"; that's a refactor outside the task.
- Tool-result persistence on `done` (runtime.ts ~750) reads `prev.activeToolCalls` — after this change `prev` (store snapshot) WILL contain the array, so that path keeps working; verify the done-path also clears it (it flows through `STOP_STREAMING`).
- Do not pass the array into `PromptInput` (item 6 memo contract).
- The 1s elapsed ticker subscribes per running row; tool calls run ≤ a handful concurrently so this is fine — do NOT use the 16ms clock rate `BlinkingDot` uses.
- Ordering: independent of items 6/7, but if item 7 lands first the adapter block will have moved — anchor on the `stateUpdater` `useCallback`, not line numbers.

---

### Item 9 — Evict the dialog `useState` toggles into a DialogProvider (L, Tier 2)

**Current state:** `AppInner` (App.tsx) holds 59 `const [show…] = useState(false)` toggles (lines ~517–606) plus 6 data-carrying overlay states (`planDiff`, `postTradeFeedback`, `counterfactual`, `debateView`, `elicitationRequest`, `feedbackTradeData`). Three render styles coexist: (a) early-return full-screen replacements (`showDoctor`, `showHelpBrowser`, `showConfigEditor`, `showApprovalBrowser`, … — App.tsx ~1736–1817), (b) overlay JSX after the main tree (~1985–2269), (c) event-driven auto-overlays wired in a mount effect (~283–399). `anyDialogOpen` is a hand-maintained 14-line OR (~649–661) that gates `VirtualMessageList` scrolling and keybindings. Opening ANY dialog re-renders the entire `AppInner` tree. Two context scaffolds exist but are mounted NOWHERE: `src/tui/context/overlayContext.tsx` (`OverlayProvider`, register/unregister/isTop) and `src/tui/context/modalContext.tsx`. The reducer already owns 7 dialog flags (`showSettings`…`showMemory` in `AppState`) that App.tsx **shadows with local useState of the same names** (~517–523) — the store copies are dead.

**Problem:** this is simultaneously the god-component fix and the biggest real re-render win; every new panel today means +1 useState, +1 OR-term, +1 slash-handler `setShowX(true)` plumbed through `menuHandlers`. New dialogs should be registry entries.

**Spec:**

1. Dialog state lives in the reducer (per repo rule — no new parallel store):

```ts
// EDIT src/tui/state/types.ts
export type DialogId =
  | "settings" | "export" | "emergency" | "context" | "sessions" | "memory"
  | "feedback" | "audit" | "scheduler" | "playbooks" | "strategies" | "genome"
  | "indicators" | "consensus" | "orderbook" | "autonomous" | "skills"
  | "constitution" | "injectionDefense" | "dataHealth" | "riskConfig" | "defi"
  | "marketOverview" | "regime" | "stats" | "globalSearch" | "exitFlow"
  | "backtestWizard" | "brokerManager" | "exchangeManager" | "genomeEvolution"
  | "historySearch" | "indicatorValue" | "insights" | "marketPulse"
  | "messageSelector" | "optimization" | "planEditor" | "plugins" | "quickOpen"
  | "reconciliation" | "taskDeps" | "walkForward" | "hip3"
  | "modelPicker" | "mcpManager" | "marketplace" | "cliBrowser" | "themePicker"
  | "exchangePicker" | "brokerPicker" | "doctor" | "helpBrowser" | "configEditor"
  | "threadBrowser" | "journal" | "shortcuts" | "approvalBrowser" | "labs"
  | "planDiff" | "postTradeFeedback" | "counterfactual" | "debateView" | "elicitation";

export interface OpenDialog {
  id: DialogId;
  /** Data-carrying overlays put their payload here; toggles leave it undefined. */
  payload?: unknown;
}

export interface AppState {
  // … existing …
  openDialogs: OpenDialog[];   // stack — last = topmost
}

// Action union (convention: verbs, SCREAMING_SNAKE):
| { type: "OPEN_DIALOG"; id: DialogId; payload?: unknown }
| { type: "CLOSE_DIALOG"; id: DialogId }
| { type: "CLOSE_TOP_DIALOG" }
```

Reducer semantics: `OPEN_DIALOG` removes any existing entry with the same id then pushes (re-open moves to top, payload replaced); `CLOSE_DIALOG` filters by id; `CLOSE_TOP_DIALOG` pops; all no-op (return same reference) when nothing changes. Delete the now-dead `showSettings…showMemory`/`privacyMode`-adjacent dialog booleans from `AppState` + their `SET_SHOW_SETTINGS`… actions (`SET_SHOW_EXPORT`, `SET_SHOW_EMERGENCY`, `SET_SHOW_CONTEXT`, `SET_SHOW_SESSIONS`, `SET_SHOW_MEMORY`) — no shims; update the few dispatch sites (`menuHandlers.ts` greps for them).

2. Selectors (`src/tui/state/selectors.ts` — file exists, follow its style):

```ts
export const selectAnyDialogOpen = (s: AppState): boolean => s.openDialogs.length > 0;
export const selectTopDialog = (s: AppState): OpenDialog | null =>
  s.openDialogs[s.openDialogs.length - 1] ?? null;
export const selectDialogPayload = <T>(s: AppState, id: DialogId): T | undefined;
```

3. Declarative registry + host:

```ts
// CREATE src/tui/components/dialogs/dialogRegistry.tsx
export interface DialogRenderProps<P = unknown> {
  payload: P;
  close: () => void;                 // dispatches CLOSE_DIALOG for this id
  openDialog: (id: DialogId, payload?: unknown) => void;
}
export type DialogRenderer = (props: DialogRenderProps) => React.ReactElement;
export interface DialogEntry {
  render: DialogRenderer;
  /** "overlay" renders above chat; "replace" takes over the screen (today's early-return style). */
  mode: "overlay" | "replace";
}
export const DIALOG_REGISTRY: Record<DialogId, DialogEntry>;
```

Each registry entry is the existing JSX moved verbatim (props that today read AppInner locals become payload fields or selector reads inside a small wrapper component per dialog — wrapper components live in the registry file or stay in their own files; do NOT rewrite the dialogs themselves).

```ts
// CREATE src/tui/components/dialogs/DialogHost.tsx
export function DialogHost(): React.ReactElement | null;
```

`DialogHost` subscribes to `openDialogs` only. It renders: the topmost `mode:"replace"` dialog INSTEAD of nothing else signaling AppInner to early-return (AppInner keeps one check: `const topReplace = useAppState(selectTopReplaceDialog); if (topReplace) return <DialogHost/>;`), and all `mode:"overlay"` dialogs in stack order after the main tree. Because `DialogHost` is the only subscriber, opening a dialog no longer re-renders the chat tree.

4. Migration (single PR, mechanical): for each of the 59 toggles — move JSX into registry, replace `setShowX(true)` call sites (slash handlers in `handleSubmit`'s command dispatch region, keybinding handlers, event effects) with `dispatch({ type: "OPEN_DIALOG", id: "x" })`, replace `onClose={() => setShowX(false)}` with the host-provided `close`. The 6 data-carrying overlays pass their event payloads through `OPEN_DIALOG.payload` (e.g. the `plan:created` effect at App.tsx ~296 becomes `dispatch({type:"OPEN_DIALOG", id:"planDiff", payload:{previous, current}})`). `anyDialogOpen` becomes `useAppState(selectAnyDialogOpen)`. Delete `context/overlayContext.tsx` and `context/modalContext.tsx` (unmounted scaffolds superseded by this; deleted-features discipline).

5. Esc routing: `DialogHost` owns ONE `useInput` (until item 10 migrates it) that maps Esc → `CLOSE_TOP_DIALOG` when the top dialog's own component doesn't handle Esc itself. Dialogs that already bind Esc internally keep doing so; their `onClose` now dispatches.

**Files:**
- EDIT `src/tui/state/types.ts`, `src/tui/state/reducer.ts`, `src/tui/state/selectors.ts` — stack state + 3 actions + selectors; remove dead dialog flags/actions.
- CREATE `src/tui/components/dialogs/dialogRegistry.tsx`, `src/tui/components/dialogs/DialogHost.tsx`.
- EDIT `src/tui/App.tsx` — delete the 59 toggles + `anyDialogOpen` OR-block + dialog JSX regions (~1736–1817 early-returns, ~1985–2269 overlays); mount `<DialogHost/>`; event effects dispatch `OPEN_DIALOG`.
- EDIT `src/tui/bridge/menuHandlers.ts` — handlers that flipped dialog state via `setState`-shaped fields now dispatch dialog actions (grep `showSettings|showExport|showEmergency|showContext|showSessions|showMemory` there first).
- DELETE `src/tui/context/overlayContext.tsx`, `src/tui/context/modalContext.tsx`.

**Acceptance criteria:**
1. Reducer tests: open/close/top semantics incl. re-open-moves-to-top, payload replace, no-op identity.
2. `grep -c "useState(false)" src/tui/App.tsx` — dialog toggles gone (remaining `useState` in App.tsx ≤ 15, none named `show*`).
3. Manual: `/settings`, `/doctor`, `/journal`, Ctrl+P palette → each opens; Esc closes topmost only when stacked (open settings, then theme picker → Esc closes picker, settings remains).
4. Manual: trade-closed counterfactual + plan-diff auto-overlays still fire (paper trade or replay an event via the event bus dev tooling).
5. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Test plan:**
- EXTEND `src/tui/state/reducer.test.ts` — `OPEN_DIALOG`/`CLOSE_DIALOG`/`CLOSE_TOP_DIALOG` cases (5+ cases incl. identity no-op).
- CREATE `src/tui/components/dialogs/dialogRegistry.test.ts` — pure checks: every `DialogId` has a registry entry; no duplicate ids; `mode` is valid (guards the registry against drift as new dialogs are added).

**Gotchas:**
- **Ordering: land item 9 BEFORE item 10** — the FocusRouter wants dialogs behind one host so focus ownership maps to the dialog stack.
- Several "dialogs" receive live data props from AppInner locals that are themselves dead (`entries={[]}`, `sessions={[]}` — e.g. `AuditBrowser entries={[]}` ~2116). Migrate verbatim with the same placeholder props; do NOT take on wiring their data sources (separate backlog items).
- `setupPreflight` / `SetupWizard` / `PrivacyConsent` / boot gating are NOT dialogs — leave them out of the registry.
- `pendingApprovals` / `ApprovalDialog` stays exactly where it is (safety-path, P0 item 1 owns its semantics) — NOT a registry dialog.
- The reducer-owned-but-shadowed flags (`SET_SHOW_SETTINGS` etc.) being deleted will break `menuHandlers.ts` compile — that's the desired forcing function; fix call sites, don't re-add the actions.
- Keep payloads `unknown` + cast in the wrapper; do not build a typed payload-map generic — three of the payload shapes are private to App.tsx today and a generic map is premature abstraction (ground rule 1).

---

### Item 10 — Single FocusContext-routed input (M, Tier 2)

**Current state:** 118 `useInput` call sites / 116 files (verified by grep; backlog's "214" is stale). The owned `useInput` (`src/tui/ink-custom/hooks/use-input.ts`) attaches one stdin-EventEmitter listener PER mounted hook; each listener runs `parseKeypress` independently per keystroke — N parses + N handler evaluations for N mounted listeners. Collision prevention today is ad-hoc: comments like App.tsx ~1855 ("render only the first [approval] to avoid multiple useInput listeners catching the same Enter"), `anyDialogOpen` guards, and `options.isActive` flags on some hooks. A registry-style precedent exists but is unmounted: `src/tui/keybindings/KeybindingContext.tsx` (`KeybindingProvider` — one `useInput`, action registry, `KeybindingResolver`) — built, never mounted; App.tsx instead runs its own global `useInput` (~885) calling `getActionsForKey`. A name collision to avoid: `src/tui/context/terminalFocusContext.tsx` already exports a `FocusContext` (terminal focus/blur via DECSET 1004) — unrelated to input routing.

**Problem:** every keystroke fans out to every mounted listener; double-fire bugs are prevented by convention, not construction. One router makes "who owns this key?" a provable property — table stakes for a tool where Enter can approve a trade.

**Spec:**

1. Pure focus-stack core (testable without React):

```ts
// CREATE src/tui/input/focusStack.ts
export interface FocusOwner {
  id: string;                       // unique, e.g. "prompt-input", "dialog:settings"
  priority: number;                 // higher wins; see bands below
  handler: (input: string, key: Key) => boolean | void;
  // return true (or void) = consumed; return false = pass to next owner down
}
export class FocusStack {
  register(owner: FocusOwner): () => void;   // returns unregister
  /** Owners sorted by priority desc, then registration recency desc. */
  resolve(): FocusOwner[];
  dispatch(input: string, key: Key): string | null;  // returns consuming owner id
}
```

Priority bands (export as consts): `FOCUS_PRIORITY = { GLOBAL_GUARD: 400 /* ctrl+c, kill-switch keys */, DIALOG: 300, OVERLAY: 200, CHAT: 100 /* PromptInput fallback */ }`. `dispatch` walks owners top-down until one consumes (returns non-false).

2. Provider + hook:

```tsx
// CREATE src/tui/input/InputRouterContext.tsx
export function InputRouterProvider({ children }: { children: ReactNode }): React.ReactElement;
// Mounts the SINGLE useInput; feeds FocusStack.dispatch.

export function useRoutedInput(
  handler: (input: string, key: Key) => boolean | void,
  opts: { id: string; priority: number; isActive?: boolean },
): void;
// Registers on mount / unregisters on unmount; handler kept fresh via ref
// (copy the handlerRef pattern from keybindings/KeybindingContext.tsx:76-84).
```

3. Wire-up + migration order (each step independently shippable):
   1. Mount `InputRouterProvider` inside the provider tree in `App.tsx` `App()` (~2366), inside `AppStateProvider`.
   2. Move App.tsx's global keybinding `useInput` (~885, region "Global keybindings") to `useRoutedInput(..., { id: "global-keys", priority: FOCUS_PRIORITY.GLOBAL_GUARD })` — it must `return false` for keys it doesn't act on so they fall through.
   3. `DialogHost` (item 9) registers `{ id: "dialog-host", priority: FOCUS_PRIORITY.DIALOG, isActive: openDialogs.length > 0 }` for Esc routing; individual dialogs migrate opportunistically (see gotcha).
   4. `ApprovalDialog` → `useRoutedInput` at `FOCUS_PRIORITY.DIALOG + 10` (approvals outrank everything except global guards — verified safety property).
   5. `PromptInput` → `useRoutedInput` at `CHAT`, ALWAYS consuming (it is the floor).
   6. `CommandPalette`, `ScrollKeybindingHandler`, `ToolCallInline` at `OVERLAY`.
   7. Remaining ~110 components migrate file-by-file in follow-up commits — NOT a blocker for this item; un-migrated `useInput`s keep working (the router's single `useInput` is just one more listener until they migrate).

4. Double-fire elimination by construction: once `ApprovalDialog` and `PromptInput` are routed, an Enter keypress reaches exactly one of them (stack order), making the "render only the first approval" workaround a redundancy rather than the only defense (leave the render-one-approval behavior — it is also a UX decision).

**Files:**
- CREATE `src/tui/input/focusStack.ts` (+ test), `src/tui/input/InputRouterContext.tsx`.
- EDIT `src/tui/App.tsx` — mount provider; migrate global-keys `useInput`.
- EDIT `src/tui/components/layout/PromptInput.tsx`, `src/tui/components/dialogs/ApprovalDialog.tsx`, `src/tui/components/CommandPalette.tsx`, `src/tui/components/ScrollKeybindingHandler.tsx`, `src/tui/components/status/ToolCallInline.tsx`, `src/tui/components/dialogs/DialogHost.tsx` (item 9) — swap `useInput` → `useRoutedInput`.

**Acceptance criteria:**
1. `bun test src/tui/input/focusStack.test.ts` — ordering, consumption fall-through, unregister, recency tiebreak, isActive-skip.
2. Manual: with a pending approval on screen, typing into the prompt does nothing until the approval is decided; Enter decides the approval and does NOT submit the prompt buffer.
3. Manual: Ctrl+P opens palette regardless of focus (global band); Esc in palette closes palette, not the prompt buffer.
4. `grep -n "useInput(" src/tui/App.tsx` → only inside `InputRouterProvider`'s implementation path (App.tsx itself: 0 direct calls; `DebateViewerOverlay`'s inline `useInput` at ~213 migrates with it).
5. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Test plan:**
- CREATE `src/tui/input/focusStack.test.ts`: register A(100)/B(300) → B consumes; B returns false → A receives; unregister B → A; two owners same priority → most-recent wins; `dispatch` returns consumer id; inactive owner skipped.

**Gotchas:**
- **Do NOT name it `FocusContext`** — `terminalFocusContext.tsx` already exports that for terminal focus/blur. Use `InputRouter*`.
- Decide explicitly against building on `KeybindingProvider`: it routes named ACTIONS (resolver-mapped), not raw keys, and is unmounted. The router handles raw keys; `KeybindingProvider`'s resolver can later become a `GLOBAL_GUARD` owner. Do not delete it in this item (item 32 owns keybinding hygiene).
- `useRoutedInput` must still call `setRawMode(true)` semantics — the router's single `useInput` does this; migrated components must NOT keep a parallel `useInput` "just for raw mode".
- The vim-mode interception in `PromptInput` stays inside PromptInput's handler — the router routes; it does not interpret modes.
- Migration is incremental BY DESIGN; resist the urge to codemod all 118 sites in one diff (orthogonal damage; many are inside rarely-mounted dialogs that item 9 will reshuffle anyway).
- Ordering: requires item 9's DialogHost for step 3 but steps 1–2 and 4–6 don't; can start in parallel.

---

### Item 11 — Market/position event coalescing + row memoization (S, Tier 2)

**Current state:** `src/tui/bridge/eventSubscriptions.ts` `subscribeToEvents(dispatch)` maps 61 EventBus events 1:1 to dispatches — `position:updated` (lines 130–136) fires `INJECT_NOTIFICATION` per event; `trade:closed` (152–181) fires notification + `UPDATE_COST` per event; `alert:price` (207–213) per event. `LivePositions` (`src/tui/components/status/LivePositions.tsx:133–166`) self-subscribes to `position:updated`/`position:closed` and calls `setPositions` per event — a busy venue feed = one React commit per tick. No coalescing exists anywhere in the TUI event path. `DataTable` (`src/tui/components/charts/DataTable.tsx:29,51–52`) renders rows inline via `data.map` — no row memoization. `MessageBubble` is already memoized (MessageBubble.tsx:159–168) — the backlog's "memo on message renderers" half is DONE; only position rows remain.

**Problem:** market ticks are the highest-frequency input the TUI has; 1:1 event→commit means a volatile market degrades typing latency exactly when the trader most needs the terminal responsive.

**Spec:**

1. Generic coalescer (pure, reusable):

```ts
// CREATE src/tui/utils/coalescer.ts
export const COALESCE_WINDOW_MS = 33;

export interface Coalescer<T> {
  push(item: T): void;
  flushNow(): void;
  dispose(): void;
}
/** Buffers pushes; invokes onFlush with the batch at most once per windowMs
 *  (leading edge immediate when idle, trailing edge for the burst remainder). */
export function createCoalescer<T>(
  onFlush: (items: T[]) => void,
  windowMs: number = COALESCE_WINDOW_MS,
): Coalescer<T>;
```

(Same leading/trailing shape as item 7's `streamFlusher` but batching items instead of concatenating strings. Keep them separate files — one returns a buffer string, one an array; merging them is premature abstraction.)

2. `LivePositions`: buffer position events through a coalescer held in a ref; flush applies ALL buffered upserts/removals in ONE `setPositions` functional update:

```ts
type PositionEvent =
  | { kind: "update"; positionId: string; updates: Partial<Position> }
  | { kind: "close"; positionId: string };
// applyPositionEvents is exported for tests:
export function applyPositionEvents(prev: Position[], events: PositionEvent[]): Position[];
```

The `useEventBusSubscriptions` handler becomes `coalescer.push(mapEventToPositionEvent(event))`. `dispose()` on unmount.

3. `eventSubscriptions.ts`: coalesce ONLY the per-tick noise channel — `position:updated` notifications. Replace the per-event `notify(...)` with a module-level coalescer that flushes one summary notification per window: copy verbatim — `` `◈ ${n} position update${n === 1 ? "" : "s"}: ${symbols.join(", ")}` `` where `symbols` is the deduped symbol list (cap display at 5 symbols, then `+N more`). All OTHER events stay 1:1 (fills, alerts, plan lifecycle are discrete user-meaningful moments — do not coalesce them). The `subscribeToEvents` return-unsubscribe must also `dispose()` the coalescer.

4. `DataTable` row memoization:

```ts
// EDIT src/tui/components/charts/DataTable.tsx
const DataTableRow = React.memo(function DataTableRow<T>({ row, columns }: { row: T; columns: Column<T>[] }) { … });
```

Extract the existing `data.map` row JSX verbatim. With `applyPositionEvents` preserving untouched row object identities (only replace updated entries — the existing upsert already does this), unchanged position rows bail out of re-render.

**Files:**
- CREATE `src/tui/utils/coalescer.ts` (+ test).
- EDIT `src/tui/components/status/LivePositions.tsx` — coalesced handler + exported `applyPositionEvents`.
- EDIT `src/tui/bridge/eventSubscriptions.ts` — coalesced `position:updated` summary notification; dispose in the returned unsubscribe.
- EDIT `src/tui/components/charts/DataTable.tsx` — extract memoized `DataTableRow`.

**Acceptance criteria:**
1. `bun test src/tui/utils/coalescer.test.ts`: 100 pushes inside one 33ms window → ≤ 2 `onFlush` calls (leading + trailing) containing all 100 items in order; `dispose()` drops pending.
2. `bun test src/tui/components/status/LivePositions.test.ts` (`applyPositionEvents` pure tests): batch of updates+close applies correctly; untouched rows keep reference identity (`toBe` check).
3. Manual: with live positions open on a busy feed (or replay `position:updated` in a loop from a dev script), typing in the prompt stays responsive; the notification area shows batched "◈ N position updates: …" lines, not a flood.
4. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Test plan:**
- CREATE `src/tui/utils/coalescer.test.ts` — burst batching, ordering, leading-edge immediacy after idle, dispose.
- CREATE `src/tui/components/status/LivePositions.test.ts` — `applyPositionEvents` cases: update unknown id = no-op; close removes; mixed batch; identity preservation.

**Gotchas:**
- `notificationFolder.push` inside `makeNotification` (eventSubscriptions.ts:30–38) also runs per event today — the coalesced path should push the SUMMARY to the folder, not each tick (the folder has its own dedup but don't lean on it).
- Don't coalesce `UPDATE_COST` on `trade:closed` — realized-PnL events are discrete and low-frequency; coalescing money state is a correctness smell in a trading product.
- `useEventBusSubscriptions` keeps handlers fresh via ref (`src/tui/hooks/useEventBusSubscription.ts`) — hold the coalescer in a `useRef`, never recreate it per render.
- There is no rAF in a terminal — 33ms `setTimeout` IS the frame budget proxy; don't import a browser shim.
- Generic `DataTableRow` + `React.memo` on a generic component: type it `React.memo(DataTableRowInner) as typeof DataTableRowInner` if TS complains — known pattern, don't fight variance.

---

### Item 12 — Render budget + enforcement (S, Tier 2)

**Current state:** Two measurement systems exist, neither enforces anything. (a) `src/tui/diagnostics/fpsTracker.ts` — `FpsTracker` singleton; `useFpsTracker` (`src/tui/hooks/animation/useFpsTracker.ts`) samples on a fixed 100ms interval timer, so it measures event-loop stall, not actual paint cost; App.tsx calls it (~469) and uses `fpsMetrics` nowhere meaningful. (b) `src/tui/diagnostics/performanceMonitor.ts` — `PerformanceMonitor` with a real frame histogram (p50/p95/p99 over stdout writes), `installStdoutTap()`, opt-in via `GORDON_PERF_LOG` (App.tsx effect ~477–503, "Phase 5 reconciler baseline"). Item 6 adds `markInteraction`/frame attribution to it.

**Problem:** without a budget that fails loudly, every latency win from items 6–11 erodes silently as features land. The budget is the regression gate that makes "feels fast" a maintained property, and its numbers are the evidence item 13's gate consumes.

**Spec:**

1. Budget module on top of `PerformanceMonitor`:

```ts
// CREATE src/tui/diagnostics/renderBudget.ts
export interface RenderBudget {
  keystrokeMs: number;   // default 16
  streamMs: number;      // default 33
  /** consecutive over-budget frames of one kind before a breach fires */
  breachThreshold: number; // default 3
}
export const DEFAULT_RENDER_BUDGET: RenderBudget;

export interface BudgetBreach {
  kind: "keystroke" | "stream";
  budgetMs: number;
  observedMs: number;        // worst frame in the breaching run
  consecutive: number;
  at: number;                // epoch ms
}

export type BreachSink = (breach: BudgetBreach) => void;

/** Pure evaluator — feed attributed frame durations, get breaches. */
export class BudgetEvaluator {
  constructor(budget: RenderBudget, sink: BreachSink);
  recordFrame(kind: "keystroke" | "stream" | "other", durationMs: number): void;
}

/** Wire the evaluator into the perf monitor's attributed frames.
 *  Returns uninstall. */
export function installRenderBudget(opts?: {
  budget?: Partial<RenderBudget>;
  sink?: BreachSink;
}): () => void;

export function isRenderBudgetEnabled(): boolean;
// true when GORDON_RENDER_BUDGET=1|true|strict (labs.json-compatible flag name)
export function isRenderBudgetStrict(): boolean; // GORDON_RENDER_BUDGET=strict
```

Frame duration = the attributed frame's delta from `markInteraction` timestamp to the stdout write completion (item 6 plumbing). `recordFrame("other", …)` resets nothing and counts nothing — only attributed frames are budgeted (animation ticks are exempt by design).

2. Default sink — loud, dev-appropriate:
- Always: `console.error` one line, copy verbatim: `` [render-budget] ${kind} frame ${observedMs.toFixed(1)}ms > ${budgetMs}ms budget (${consecutive} consecutive) `` (Ink's patchConsole surfaces it above the live frame).
- Plus an in-app notification via the store: `dispatch({ type: "INJECT_NOTIFICATION", notification: { …, variant: "system", type: "render:budget_breach", message: "⚠ UI over render budget — see /perf" } })`, rate-limited to once per 30s.
- Strict mode (`GORDON_RENDER_BUDGET=strict`, for CI/perf sessions): additionally `throw new Error(...)` from the sink — crashes the run so a perf regression fails a scripted check.

3. Activation: in the App.tsx perf effect (the existing `GORDON_PERF_LOG` effect, ~477), call `installRenderBudget()` when `isRenderBudgetEnabled()` — independent of `GORDON_PERF_LOG` (the stdout tap installs if EITHER is on; refactor that effect's guard accordingly). Both flags are settable via `~/.gordon/labs.json` (`loadLabsFlagsIntoEnv` already merges arbitrary flags — no new plumbing).

4. `/perf` surfacing: `formatPerfSnapshot` (App.tsx ~226) gains one line when the budget is installed: `` Budget:      keystroke<16ms stream<33ms — ${breachCount} breaches `` (evaluator exposes `breachCount` via a getter or the sink wrapper counts).

**Files:**
- CREATE `src/tui/diagnostics/renderBudget.ts` (+ test).
- EDIT `src/tui/diagnostics/performanceMonitor.ts` — expose attributed-frame callback hook: `onAttributedFrame(cb: (kind, durationMs) => void): () => void` consumed by `installRenderBudget` (keeps budget module free of tap internals).
- EDIT `src/tui/App.tsx` — perf effect installs budget; `formatPerfSnapshot` budget line.

**Acceptance criteria:**
1. `bun test src/tui/diagnostics/renderBudget.test.ts` — see test plan.
2. Manual: `GORDON_RENDER_BUDGET=1 bun run <tui entry>`; artificially stall (open a huge `/journal` dump) → stderr shows the `[render-budget]` line and a system notification appears once.
3. `GORDON_RENDER_BUDGET=strict` + the same stall → process exits non-zero.
4. `/perf` shows the budget line when enabled.
5. Zero overhead when disabled: `isRenderBudgetEnabled()` false → `installRenderBudget` early-returns a no-op uninstaller and no tap-callback registers.
6. `bun tsc --noEmit -p tsconfig.json` clean; `bun test src/tui` green.

**Test plan:**
- CREATE `src/tui/diagnostics/renderBudget.test.ts`: under-budget frames never fire; 3 consecutive over-budget `keystroke` frames fire exactly one breach with `consecutive: 3`; an under-budget frame resets the run; `stream` and `keystroke` runs tracked independently; `"other"` frames ignored; strict/enabled env parsing (`1`, `true`, `strict`, unset).
- EXTEND `src/tui/diagnostics/performanceMonitor.test.ts` — `onAttributedFrame` callback receives kind+duration; unsubscribe works.

**Gotchas:**
- Budget thresholds are exempt for animation/spinner frames BY CONSTRUCTION (only attributed frames count) — do not try to budget every frame; the spinner legitimately ticks at its own cadence.
- The breach notification must go through the reducer (`INJECT_NOTIFICATION`), not a new side-channel — `/journal`-substrate rule generalizes: never build parallel stores.
- `console.error` under Ink: patchConsole is on by default (`render.ts` `resolveOptions`) so it's safe; do NOT write to `process.stdout` directly (tears the frame AND re-enters the tap → infinite loop). The tap-reentrancy risk is real: the budget sink must never synchronously cause a stdout write that re-triggers itself — the once-per-30s rate limit plus `console.error`→patched-route covers it; add a reentrancy latch in the sink anyway.
- Ordering: needs item 6's `markInteraction` plumbing. Item 7's flusher must call `markInteraction("stream")` for stream attribution to exist.
- Don't delete `fpsTracker.ts` in this item even though it's the weaker instrument — `useFpsTracker` has consumers; consolidation is cleanup outside this task.

---

### Item 13 — `ink-custom` framebuffer revival: the GATE only (L, Tier 3 — spec is the gate, not a fix)

**Current state:** The custom cell-diff renderer (Claude Code-architecture: `Int32Array` cell buffers, pool interning, patch emission) is ~80% built and ALREADY the import path: every TUI file imports from `./ink-custom`, whose `render.ts` routes to `startCustomRender()` only when `GORDON_CUSTOM_RENDER=1|true` and no hard fallback applies (tmux/screen/`TERM=dumb`/non-TTY/screen-reader → vanilla Ink with a one-line stderr notice). **Default is OFF after a deliberate rollback**: `render.ts` `shouldUseCustomRenderer()` doc comment (~102–114) records "cell interleaving / cursor-positioning bugs (visible as scrambled text on mount) that aren't reproduced by the unit tests." The pipeline lives in `src/tui/ink-custom/customRender.ts` (paint loop: layout → `OutputTarget` → `FrameBuffer.swap()` → `PatchEmitter.diff()` → `AnsiPatcher.write()` → `SyncTerminal.wrapFrame()`) and `renderNodeToOutput.ts`; its header documents staged phases (Static history, selection overlay allocated-not-applied, hook shims still vanilla-backed). The flag persists via `~/.gordon/labs.json`. The README's "Status: NOT ACTIVATED / nothing imports ink-custom" banner is stale (import swap happened); trust `render.ts`.

**Problem:** the framebuffer is the most expensive remaining latency lever and carries known mount-time corruption — reviving it without evidence would burn a week to fix a problem Tiers 1–2 may have already solved. This item defines the evidence bar; an agent picking up item 13 must first verify the gate, and only a SEPARATE, operator-approved task may fix/activate.

**Spec — the gate (all four legs must hold):**

1. **Prerequisite leg:** items 6, 7, 8, 11, 12 are merged (verify: `streamFlusher.ts`, `renderBudget.ts`, `coalescer.ts` exist; `SET_ACTIVE_TOOL_CALLS` in `types.ts`).
2. **Measurement leg:** capture a standardized perf session against the CURRENT (vanilla-Ink) renderer:
   ```
   GORDON_PERF_LOG=~/.gordon/perf-baseline.jsonl GORDON_RENDER_BUDGET=1 <launch TUI>
   ```
   Workload script (manual, ~10 min): one long streaming turn (`/scan` on a broad universe), one dense-output command (`/journal` or compliance dump), continuous typing during streaming, ≥1 open `LivePositions` table on a live feed. The framebuffer is justified ONLY if the resulting JSONL shows, during the workload window, **any** of:
   - `frameHistogram.p95Ms > 33` sustained across ≥ 3 consecutive snapshots (30s flush cadence → ≥ 90s sustained), or
   - ≥ 5 `keystroke` budget breaches (item 12) in the session, or
   - `meanBytes > 20_000` per frame sustained across ≥ 3 consecutive snapshots (full-repaint byte churn is the framebuffer's specific target — Claude Code measured 5–10× byte reduction; `customRender.ts` header / `ink-custom/README.md` Phase 5 note).
   If NONE hold: write the numbers into the backlog (`docs/TUI_DESIGN_BACKLOG.md` item 13 checkbox line — append "measured <date>: p95=…, breaches=…, bytes=…; gate not met") and STOP. Item 13 stays parked.
3. **Bug-isolation leg (only if leg 2 passes):** before any fix work, reproduce the mount-time corruption deterministically: `GORDON_CUSTOM_RENDER=1` in a plain (non-tmux) terminal, cold mount — expect scrambled/interleaved cells on first paint. Known anchor points for the eventual fix task: `src/tui/ink-custom/customRender.ts` (mount path + first `FrameBuffer.swap()`), `src/tui/ink-custom/renderNodeToOutput.ts` (cell write ordering), `src/tui/ink-custom/cellDiff.ts` / `framebuffer.ts` (existing co-located tests pass — the bug is NOT covered by them, so the fix task must start by writing a failing integration repro, likely in `render.integration.test.ts`). Capture the repro (terminal, dimensions, screenshot/asciinema) in the fix-task description.
4. **Operator leg:** present legs 2–3 evidence to the operator and get an explicit go before any fix/activation work begins (parked-by-operator-decision per the backlog; confirm-before-large-refactors ground rule).

**Explicit non-goals of this item:** no code changes to `ink-custom/`, no flag default flips, no fixing the interleaving bug, no README refresh beyond the backlog note. The ONLY allowed diff from executing item 13 is the measurement note appended to the backlog (and optionally correcting the stale "NOT ACTIVATED" line in `ink-custom/README.md` to point at `render.ts` as the source of truth — one-line doc fix).

**Files:**
- EDIT `docs/TUI_DESIGN_BACKLOG.md` — measurement results appended to the item 13 line.
- (Optional, one line) EDIT `src/tui/ink-custom/README.md` — stale status banner points to `render.ts`.

**Acceptance criteria:**
1. A perf-baseline JSONL exists with the workload session and the three gate metrics extracted (paste them in the PR/commit description).
2. The backlog line carries the dated measurement note and a clear met / not-met verdict per metric.
3. If "met": a written repro of the mount bug exists (leg 3) and an operator go/no-go was requested. If "not met": no further work occurred.
4. `git diff --stat` shows ONLY docs changes.

**Test plan:** none (measurement task). The eventual fix task — out of scope here — must begin with a failing repro test in `src/tui/ink-custom/render.integration.test.ts`.

**Gotchas:**
- `GORDON_PERF_LOG`'s stdout tap and item 12's budget share `installStdoutTap` — installing both is supported (item 12 refactors the guard); don't install the tap twice (it's idempotent, returns the existing uninstaller, but verify after item 12's edit).
- tmux silently forces vanilla Ink (`render.ts` fallback) — run measurements AND the bug repro in a plain terminal or the whole exercise is invalid; the stderr fallback notice tells you which renderer you actually got.
- `atomicAppendJsonl` rewrites the whole perf file per 30s flush — fine for a 10-min session; don't leave `GORDON_PERF_LOG` on for days.
- The existing unit tests (`cellBuffer.test.ts`, `cellDiff.test.ts`, `framebuffer.test.ts`, `renderPipeline.test.ts`) all pass — that is precisely why the rollback comment says the bug "isn't reproduced by the unit tests." Do not interpret green tests as the bug being fixed.
- Labs flags: `GORDON_CUSTOM_RENDER` may already be persisted in a stale `~/.gordon/labs.json` on the test machine — check it before measuring, or the "vanilla baseline" might silently be the custom renderer.
