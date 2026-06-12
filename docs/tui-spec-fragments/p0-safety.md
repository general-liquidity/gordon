# P0 — Safety-correctness specs (Items 1–5)

Section of the TUI build spec derived from `docs/TUI_DESIGN_BACKLOG.md`. All file:line anchors verified against the tree on 2026-06-12. Implementable standalone.

**Repo conventions that apply to every item below:**
- `.ts`/`.tsx` extensions on relative imports (Bun convention).
- Tests are co-located `*.test.ts`, run with `bun test src/tui` (NEVER bare `bun test` — it sweeps vendored repos under `agents/`).
- Typecheck gate: `bun tsc --noEmit -p tsconfig.json` must be clean.
- App state changes go through the reducer (`src/tui/state/reducer.ts` + `types.ts`), not new `useState` in `App.tsx`. The reducer already uses `Date.now()` in the `AGENT_SWITCH` case — timestamping inside the reducer is established precedent here.
- The bridge (`src/tui/bridge/runtime.ts`, `menuHandlers.ts`) mutates state via `setState(fn)` (type `StateUpdater`); `App.tsx`'s `stateUpdater` adapter (App.tsx:694–761) diffs the result field-by-field and dispatches granular reducer actions. **Any NEW AppState field written from the bridge must be added to that diff list or the write is silently dropped.** This bites items 2, 4, 5 — called out per item.
- No new tools on the agent surface (stays exactly 22). Nothing in this section touches agent tools.

---

### Item 1 — Permission-mode transition guard (S, P0)

**Current state:** `SET_PERMISSION_MODE` is dispatched bare from three places:
- `src/tui/App.tsx:924` (`case "toggleAutoMode"` in the global `useInput` keybinding switch) and `App.tsx:927` (`toggleStrictMode`).
- `src/tui/App.tsx:729` — the `stateUpdater` diff adapter forwards any bridge-side `permissionMode` change.
- `src/tui/bridge/menuHandlers.ts:570–585` — `handleUIMenuCommand` cases `"auto"`, `"ask"`, `"strict"`/`"readonly"` do `setState((prev) => ({ ...prev, permissionMode: "auto" }))` and unconditionally print a success message.

The reducer case (`src/tui/state/reducer.ts:18–19`) is an unconditional assignment. Nothing checks `pendingApprovals` (AppState, `types.ts:79`) or `isStreaming` (`types.ts:70`). The approval dialog renders the head of `pendingApprovals` at `App.tsx:1859–1865`.

**Problem:** Switching ask→auto while an approval card is on screen means the queued trade auto-executes the moment the mode flips — the user thought they were deciding, the mode switch decided for them. This is the exact "different-but-coherent action amplification" failure for a money agent.

**Spec:**

Permissiveness ranking and verdict live in a new pure module so the FSM is testable without React:

```ts
// CREATE src/tui/state/permissionModeFsm.ts
import type { PermissionMode } from "./types.ts";

/** Higher = more permissive. Escalations are gated; de-escalations never are. */
export const MODE_PERMISSIVENESS: Record<PermissionMode, number> = {
  observe: 0, strict: 1, plan: 2, paper: 3, ask: 4, auto: 5,
};

export function isEscalation(from: PermissionMode, to: PermissionMode): boolean;

export interface ModeTransitionContext {
  pendingApprovalCount: number;
  isStreaming: boolean;
}

export type ModeTransitionVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

export function evaluateModeTransition(
  current: PermissionMode,
  requested: PermissionMode,
  ctx: ModeTransitionContext,
): ModeTransitionVerdict;

/** True for modes that can reach a real venue (used by Item 4 too). */
export function isLiveCapable(mode: PermissionMode): boolean; // auto | ask
```

FSM rules (in order):
1. `requested === current` → allowed (no-op).
2. De-escalation (`rank(requested) < rank(current)`) → **always allowed**, even mid-stream with approvals pending. The safety hatch must never be blocked.
3. Escalation with `pendingApprovalCount > 0` → denied. `reason` (verbatim, with live counts/modes interpolated):
   `Mode change blocked: switching ask → auto with 2 pending approval(s) would let them auto-execute. Resolve them first — approve <id> / deny <id> — then retry.`
4. Escalation with `isStreaming` → denied. `reason`:
   `Mode change blocked: Gordon is mid-turn. Wait for the current turn to finish, then retry.`
5. Otherwise → allowed.

**Enforcement point is the reducer** (covers all three dispatch paths including the diff adapter). Rewrite `SET_PERMISSION_MODE` in `reducer.ts`:

```ts
case "SET_PERMISSION_MODE": {
  const verdict = evaluateModeTransition(state.permissionMode, action.mode, {
    pendingApprovalCount: state.pendingApprovals.length,
    isStreaming: state.isStreaming,
  });
  if (!verdict.allowed) {
    return {
      ...state, // permissionMode UNCHANGED
      messages: [...state.messages, {
        id: `mode-blocked-${Date.now()}`,
        role: "system" as const,
        variant: "error" as const,
        content: `⛔ ${verdict.reason}`,
        timestamp: new Date().toISOString(),
      }],
    };
  }
  return { ...state, permissionMode: action.mode };
}
```

(The `Message` type comes from `../components/messages/MessageBubble.tsx` — already imported by `types.ts`.)

**Call-site UX fixes** (so success copy never lies):
- `menuHandlers.ts` cases `"auto"` / `"ask"` / `"strict"`: compute the verdict inside the `setState` updater from `prev` (`prev.pendingApprovals?.length ?? 0`, `!!prev.isStreaming`). When denied, append the rejection message to `prev.messages` and do NOT change `permissionMode`; when allowed, keep the existing success messages verbatim (e.g. `"Permission mode: auto — trades execute without per-action approval. Use /ask to return to default."`). Drop the separate `addMessage` call — fold the message into the same updater so it is one atomic state transition.
- `App.tsx:923–927` keybinding cases: replace the bare dispatch with verdict-checked logic using `getState()` (already in scope from `useAppStore()` at App.tsx:255). When denied, `dispatch({ type: "ADD_MESSAGE", message: <rejection> })`; when allowed, dispatch `SET_PERMISSION_MODE` as today. (The reducer would also catch it — this just avoids relying on the backstop for the message.)

**Files:**
- CREATE `src/tui/state/permissionModeFsm.ts` (pure FSM: ranking, `isEscalation`, `evaluateModeTransition`, `isLiveCapable`).
- CREATE `src/tui/state/permissionModeFsm.test.ts`.
- EDIT `src/tui/state/reducer.ts` (`SET_PERMISSION_MODE` case — guard + rejection message).
- EDIT `src/tui/bridge/menuHandlers.ts` (`handleUIMenuCommand` cases `"auto"`, `"ask"`, `"strict"`/`"readonly"` — verdict-checked atomic updaters).
- EDIT `src/tui/App.tsx` (keybinding switch cases `"toggleAutoMode"` / `"toggleStrictMode"` inside the global `useInput` handler).
- CREATE `src/tui/state/reducer.test.ts` (shared with items 2/4/5 — see test plans).

**Acceptance criteria:**
1. `bun test src/tui/state` passes; FSM tests cover every rule above.
2. Reducer test: dispatching `SET_PERMISSION_MODE {mode:"auto"}` on a state with `permissionMode:"ask"` and 1 pending approval leaves `permissionMode === "ask"` and appends exactly one system message containing `"Mode change blocked"`.
3. Reducer test: same dispatch with `isStreaming:true`, no approvals → blocked with the mid-turn copy.
4. Reducer test: `auto → strict` with pending approvals → **allowed** (de-escalation).
5. Manual: in the TUI with a pending approval on screen, `/auto` prints the rejection and the approval dialog still requires a decision; after deciding, `/auto` succeeds.
6. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:**
- `src/tui/state/permissionModeFsm.test.ts`: ranking is total over all 6 modes; no-op allowed; every escalating pair blocked when `pendingApprovalCount>0`; every escalating pair blocked when `isStreaming`; every de-escalating pair allowed under both conditions; reason strings contain the mode names and the count; `isLiveCapable` true only for `auto`/`ask`.
- `src/tui/state/reducer.test.ts`: criteria 2–4 above, driven through `appReducer(INITIAL_STATE-derived states, action)`.

**Gotchas:**
- The diff adapter path (App.tsx:729) fires for ANY bridge `setState` that touches `permissionMode` — that is why enforcement must live in the reducer, not only at call sites. Do not "fix" by guarding only menuHandlers.
- `RESET_STREAM_STATE` and `STOP_STREAMING` clear `isStreaming` — no FSM interaction needed; the guard reads current state at dispatch time.
- Item 4 adds banner logic to the same `SET_PERMISSION_MODE` reducer case. **Order: guard first, banner only on allowed transitions.** If you implement both, write the case once with guard → banner → assignment.
- Session resume never restores permission rules (repo invariant) — `initializeSession` does not write `permissionMode`, and the diff adapter at runtime.ts:227 deliberately passes `prev.permissionMode` through. Don't add resume-time mode restoration while in here.

---

### Item 2 — `/clear` session-reset contract (M, P0)

**Current state:** `/clear` is defined at `src/app/slash/slashCommands.ts:1353–1361` (name `clear`, alias `reset`, action `menu`, target `clear`) and handled in `handleSystemMenuCommand` at `src/tui/bridge/menuHandlers.ts:755–765`: it resets only `messages`, `streamBuffer`, `completedMessageCount` via `setState`, then prints `"Conversation cleared. Session preserved — use /new-session for a fresh start."`. It does NOT touch `pendingApprovals`, `isStreaming`, `activeAgents`, `handoffHistory`, `notifications`, dialog flags, the runtime transcript (`SessionRuntime.getTranscriptStore()`), the queued-message buffer (`defaultMessageQueue`), or turn summaries. There is no confirmation when approvals are pending. Relevant runtime API (verified in `src/runtime/session/SessionRuntime.ts`): `denyAllPending(options)` (line 193), `getTranscriptStore()` (line 124); `TranscriptStore.replace(entries)` (`src/runtime/transcript/TranscriptStore.ts:44`) can clear with `replace([])`. `defaultMessageQueue.clear()` exists (`src/infra/runtime/messageQueue.ts:113`). `resetTurnSummaries` is exported from `src/tui/bridge/turnSummaries.ts` and already imported by `runtime.ts:45`.

**Problem:** A trader who wants a clean slate today gets a half-reset: a stale approval can still fire, ghost streaming state lingers, and the runtime transcript silently resumes the "cleared" conversation. The only real reset is killing the process.

**Spec:**

New reducer action (follows the existing `RESET_STREAM_STATE` naming):

```ts
// types.ts — add to Action union
| { type: "RESET_SESSION" }
// and a dialog flag on AppState + its action:
showResetConfirm: boolean;            // INITIAL_STATE: false
| { type: "SET_SHOW_RESET_CONFIRM"; show: boolean }
```

`RESET_SESSION` reducer contract — exactly these slices reset:

| Reset to | Fields |
|---|---|
| `[]` | `messages`, `activeAgents`, `handoffHistory`, `pendingApprovals`, `notifications`, `backgroundTasks` |
| `""` | `streamBuffer`, `activeThinking` |
| `false` | `isStreaming`, `ctrlCPressed`, `showPalette`, `showHelp`, `showSettings`, `showExport`, `showEmergency`, `showContext`, `showSessions`, `showMemory`, `showResetConfirm` |
| `0` | `completedMessageCount`, `contextTokens`, `lastTurnDurationMs`, `lastTurnTokens` |

**Preserved (explicitly NOT reset):** `permissionMode`, `sessionId`, `threadId`, `isResumedSession`, `tokenCount` + `cost` (cumulative spend accounting survives a conversation wipe), `runtimeReady`, `bootPhase`, `swarmMode`, `autonomousActive`/`autonomousStrategyCount` (the loop is runtime behavior, not conversation), `privacyMode`, `activeWorkspace`, `showSetup`.

Runtime-side reset, exported from the bridge so both the slash path and the confirm dialog share it:

```ts
// EDIT src/tui/bridge/runtime.ts — add export
export function performSessionReset(setState: StateUpdater): { deniedApprovals: number } {
  const runtime = getRuntime();
  let denied = 0;
  if (runtime) {
    denied = runtime.denyAllPending({ reason: "Session reset via /clear" });
    runtime.getTranscriptStore().replace([]);   // wipe runtime transcript (resume source)
  }
  defaultMessageQueue.clear();                  // drop messages queued behind a stream
  resetTurnSummaries();
  setState((prev: any) => ({ ...prev, __resetSession: true })); // see diff-adapter note below
  return { deniedApprovals: denied };
}
```

Bridge→reducer plumbing: the diff adapter in `App.tsx` (`stateUpdater`, App.tsx:694–761) cannot express an atomic multi-slice reset via field diffs. Add a sentinel: when the updater result carries `__resetSession: true`, dispatch `{ type: "RESET_SESSION" }` (and nothing else for that update) and strip the sentinel. Also add a diff branch for `showResetConfirm` → `SET_SHOW_RESET_CONFIRM` (menuHandlers sets it via `setState`).

`/clear` flow (replace the body of `case "clear"` in `menuHandlers.ts` `handleSystemMenuCommand`):
1. Read pending/streaming from the runtime + a `setState` probe of `prev`: if `prev.pendingApprovals.length === 0 && !prev.isStreaming` → call `performSessionReset(setState)`, then `addMessage(setState, "system", "Conversation cleared. Session preserved — use /new-session for a fresh thread.")`.
2. Otherwise → `setState((prev) => ({ ...prev, showResetConfirm: true }))` and return; the dialog completes or cancels the reset.

Confirmation dialog:

```ts
// CREATE src/tui/components/dialogs/ResetSessionDialog.tsx
interface ResetSessionDialogProps {
  pendingApprovalCount: number;
  isStreaming: boolean;
  onConfirm: () => void;   // App.tsx: performSessionReset(stateUpdater) + confirmation message
  onCancel: () => void;    // dispatch SET_SHOW_RESET_CONFIRM false
}
export function ResetSessionDialog(props: ResetSessionDialogProps): JSX.Element;
```

```
╭──────────────────────────────────────────────────╮
│  Clear session?                                  │
│                                                  │
│  ⚠ 2 pending approval(s) will be DENIED.         │
│  ⚠ A response is still streaming — it will be    │
│    discarded.                                    │
│                                                  │
│  The conversation and runtime transcript are     │
│  wiped. Thread and spend accounting are kept.    │
│                                                  │
│  [y] Clear and deny pending   [Esc] Cancel       │
╰──────────────────────────────────────────────────╯
```

Border `yellow`; the ⚠ lines render only when their condition holds. Keys (via `useInput`, active only while mounted): `y` → `onConfirm`, `escape` or `n` → `onCancel`. Render it in `App.tsx` near the other dialog overlays (after the `showPalette` block, App.tsx:1977–1983), gated on the reducer flag: `state.showResetConfirm && <ResetSessionDialog …/>`. While `showResetConfirm` is true, add it to the existing `anyDialogOpen` computation so message-list scrolling and the approval dialog don't double-handle keys.

Post-confirm message (verbatim, count interpolated): `Conversation cleared — 2 pending approval(s) denied. Session preserved — use /new-session for a fresh thread.`

**Known limitation to encode in the confirmation copy and the docstring:** agent-side Mastra thread memory persists in storage; `/clear` resets the TUI + runtime transcript only. A truly fresh agent thread is `/new-session` (`SessionRuntime.startNewSession`, SessionRuntime.ts:403). Do not try to wipe Mastra storage from here.

**Files:**
- EDIT `src/tui/state/types.ts` (`RESET_SESSION` + `SET_SHOW_RESET_CONFIRM` actions, `showResetConfirm` field + INITIAL_STATE).
- EDIT `src/tui/state/reducer.ts` (both cases; `RESET_SESSION` per the table).
- EDIT `src/tui/bridge/runtime.ts` (export `performSessionReset`; `defaultMessageQueue` import from `../../infra/runtime/messageQueue.ts`).
- EDIT `src/tui/bridge/menuHandlers.ts` (`case "clear"` in `handleSystemMenuCommand` — new flow).
- EDIT `src/tui/App.tsx` (`stateUpdater`: `__resetSession` sentinel + `showResetConfirm` diff branch; render `ResetSessionDialog`; include flag in `anyDialogOpen`).
- CREATE `src/tui/components/dialogs/ResetSessionDialog.tsx`.
- EDIT `src/tui/state/reducer.test.ts` (extend).

**Acceptance criteria:**
1. Reducer test: `RESET_SESSION` on a fully-populated state resets exactly the table's fields and preserves every listed survivor (assert both directions).
2. `bun test src/tui` passes.
3. Manual: `/clear` with no approvals wipes the conversation instantly, no dialog.
4. Manual: `/clear` with a pending approval shows the dialog; `Esc` keeps everything; `y` denies the approval (visible "Denied" trace in the engine path), wipes messages, and prints the post-confirm copy.
5. Manual: after `/clear`, sending a new message works (runtime alive, same threadId in the status area) and the old conversation does not resurface on the next resume (transcript store emptied).
6. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:**
- `src/tui/state/reducer.test.ts`: criterion 1 (build a state where every resettable field is non-default, assert post-action shape); `SET_SHOW_RESET_CONFIRM` toggling.
- `src/tui/bridge/runtime.ts` logic: extend an existing bridge test pattern (see `src/tui/bridge/runtime.approvalQuickCheck.test.ts` for how bridge functions are tested without React) with a `performSessionReset` test using a stub runtime exposing `denyAllPending`/`getTranscriptStore` — assert `replace([])` called, denial reason string, queue cleared. If stubbing `getRuntime()` is awkward, refactor `performSessionReset(runtime, setState)` to take the runtime as a parameter and have the thin exported wrapper pass `activeRuntime`.

**Gotchas:**
- `denyAllPending` returns a count — use it in the post-confirm copy; don't recount from UI state (the engine may have auto-resolved some in the meantime).
- The dialog-flag pairs are duplicated today: reducer fields `showSettings`… AND local `useState` mirrors in App.tsx:517–606. `RESET_SESSION` resets the reducer-owned ones only; that is acceptable because `/clear` is typed from the prompt (no overlay open). Do NOT try to reset the ~80 local `useState` toggles — that's Item 9's job (dialog eviction). Leave them.
- `handleApprovalDecision` (runtime.ts:907) filters `pendingApprovals` after a decision — no interaction; `RESET_SESSION` empties the list and the engine queue is already drained by `denyAllPending`.
- The streaming generator in `streamResponse` (runtime.ts:425) may still be iterating when reset fires; there is no public cancel on `SessionRuntime` (verified — no `cancel`/`abort` member). The reducer's `isStreaming:false` plus the stream's own `done`/`error` handler converging on `isStreaming:false` is safe (idempotent sets). Don't invent a stream-kill API for this item; note it in a `WHY` comment only if you touch that code.
- Don't rename `/clear`'s alias `/reset` or change `slashCommands.ts` — the command definition is fine; only the handler changes.

---

### Item 3 — Multi-instance collision guard (S, P0)

**Current state:** No instance lock exists. `startGordonTUI()` (`src/tui/index.tsx:9–33`) clears the screen, prints the boot card, and renders. Session state is shared via `~/.gordon/session.json` (read at index.tsx:74–81) and the runtime auto-resumes the same thread (`initializeSession({ autoResume: true })`, `src/tui/bridge/runtime.ts:237`) — two TUIs silently interleave writes to the same thread. The canonical dir helper is `getGordonDir()` at `src/infra/storage/paths.ts:19–23` (honors `GORDON_HOME`, `XDG_CONFIG_HOME`, defaults `~/.gordon`). Prior art for a crude lock (no PID liveness): `src/tui/services/workflow/autoDream.ts:9,28`. Kill-switch persistence (`src/infra/safety/killSwitches.ts:72–98`) is the house pattern for "state file under getGordonDir() with test-mode bypass".

**Problem:** A trader with two terminals open gets two agents writing one thread and one approval queue — duplicated orders and corrupted session state with zero warning.

**Spec:**

```ts
// CREATE src/infra/storage/instanceLock.ts
export interface InstanceLockInfo {
  pid: number;
  startedAt: string; // ISO
  cwd: string;
}

export type InstanceLockResult =
  | { acquired: true; release: () => void }
  | { acquired: false; holder: InstanceLockInfo };

/** PID-liveness probe — true if a process with this pid exists. */
export function isPidAlive(pid: number): boolean; // process.kill(pid, 0) try/catch; EPERM counts as alive

export function acquireInstanceLock(name?: string): InstanceLockResult; // default name "tui"
```

Behavior of `acquireInstanceLock`:
1. Skip entirely (return `{ acquired: true, release: noop }`) when `process.env.NODE_ENV === "test"` or `process.env.GORDON_ALLOW_MULTI_INSTANCE === "1"` (mirror the killSwitches test-bypass pattern).
2. Lock path: `join(getGordonDir(), \`${name}.lock\`)`. `mkdirSync(dirname, { recursive: true })` first.
3. Attempt `writeFileSync(path, JSON.stringify(info), { flag: "wx" })` (atomic create-exclusive). Success → register cleanup on `process.on("exit")` and return `acquired: true`.
4. On `EEXIST`: read + parse the holder. If unparseable OR `!isPidAlive(holder.pid)` OR `holder.pid === process.pid` → stale: `unlinkSync` and retry step 3 **once**. Otherwise return `{ acquired: false, holder }`.
5. `release()`: re-read the file; unlink only if it still records our own pid (never delete a successor's lock). Swallow fs errors (lock is advisory; never crash shutdown).

Wire-up in `startGordonTUI` (`src/tui/index.tsx`), BEFORE the screen-clear/`printBootCard()` block and only on the TTY path (`process.stdout.isTTY`) so ACP (`src/app/acp-entry.ts`), gateway, and CI are untouched:

```ts
if (process.stdout.isTTY) {
  const lock = acquireInstanceLock();
  if (!lock.acquired) {
    printInstanceCollisionWarning(lock.holder); // local helper in index.tsx
    process.exit(1);
  }
}
```

Warn-and-bail copy (raw ANSI like the boot card; yellow `\x1b[33m` for the ⚠ line, dim for the explainer):

```
⚠ Another Gordon TUI is already running (pid 48112, started 14:03:21, in C:\Users\adria\Downloads\gordon-cli-alpha).
  Two instances share one session thread under ~/.gordon and will overwrite each other's state.
  Close the other instance, or set GORDON_ALLOW_MULTI_INSTANCE=1 to run both anyway (unsafe).
```

(`startedAt` rendered as local `HH:MM:SS`; show the holder's `cwd` verbatim; render the actual resolved dir — `~/.gordon` or `GORDON_HOME` — in the second line.)

**Files:**
- CREATE `src/infra/storage/instanceLock.ts` (lock acquire/release + PID liveness).
- CREATE `src/infra/storage/instanceLock.test.ts`.
- EDIT `src/tui/index.tsx` (`startGordonTUI` — acquire before boot card; add `printInstanceCollisionWarning` helper next to `printBootCard`).

**Acceptance criteria:**
1. `bun test src/infra/storage/instanceLock.test.ts` passes (note: tests must set `GORDON_HOME` to a temp dir AND unset `NODE_ENV` bypass via an explicit option — see test plan).
2. Manual: launch the TUI twice; the second prints the warning verbatim (with real pid/cwd) and exits with code 1; the first is unaffected.
3. Manual: kill the first instance with task-kill (no clean exit), relaunch → stale lock detected, boots normally.
4. Manual: `GORDON_ALLOW_MULTI_INSTANCE=1` lets a second instance boot.
5. `bun acp` and non-TTY invocations (`bun run src/index.tsx | cat` equivalent) never touch the lock file.
6. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:** `src/infra/storage/instanceLock.test.ts` — because `NODE_ENV === "test"` under bun test, give `acquireInstanceLock` an internal options bag for tests: `acquireInstanceLock(name, { force?: boolean })` where `force: true` skips the env bypasses (keep it out of the public signature docs; one-line WHY comment). Cases:
- acquire on empty dir → file exists, contents parse to `{pid: process.pid, …}`.
- second acquire same process → treated as stale-self (rule 4, `holder.pid === process.pid`) → re-acquired.
- lock held by live foreign pid: write a lock with `pid: process.pid` then assert against a fabricated holder via a seam — simplest: write `{ pid: <pid of a known-alive process, use process.ppid> }` and assert `acquired:false` with that holder echoed.
- stale: write `{ pid: 999999999 }` (guaranteed-dead) → acquired, file overwritten.
- corrupt JSON in lock file → treated as stale, acquired.
- `release()` removes the file; `release()` after a foreign overwrite does NOT remove it.
- `isPidAlive(process.pid)` true; `isPidAlive(999999999)` false.

**Gotchas:**
- Windows is the dev platform here: `process.kill(pid, 0)` works for liveness on Windows in Bun/Node but throws `EPERM` for protected processes — **EPERM means alive**; only `ESRCH` (or generic throw with dead pid) means dead. Encode that in `isPidAlive`.
- Use `getGordonDir()` from `src/infra/storage/paths.ts` — do NOT re-derive `~/.gordon` (index.tsx's `readBootConfig` re-derives it locally for pre-Ink speed; the lock module is infra and must use the canonical helper).
- The keep-alive `await new Promise(() => {})` at index.tsx:32 means the process never resolves `startGordonTUI` — cleanup must hang off `process.on("exit")`, not `finally`.
- Don't lock in `App.tsx` or the bridge — by then Ink owns the terminal and a clean bail is ugly. Pre-Ink, pre-clear-screen.
- Do not add file-watcher "takeover" flows (lazygit-style) — operator decision is warn-and-bail only.

---

### Item 4 — Loud PAPER/LIVE visibility (S, P0)

**Current state:** Mode is a subtle color in three places: (a) the pre-Ink boot card, `printBootCard` at `src/tui/index.tsx:165–250`, with `MODE_ANSI` at index.tsx:182–189 where **paper is intentionally plain/no color**; (b) `GordonHeader` (`src/tui/components/layout/GordonHeader.tsx`, `MODE_COLOR` at :25–32, yellow `[PAPER]` tag at :67) — **imported at App.tsx:17 but never rendered** (verified: no `<GordonHeader` usage anywhere in src/tui); (c) `PromptInputFooter` (`src/tui/components/layout/PromptInputFooter.tsx`, `MODE_COLOR` at :20–27) — **also unrendered**. The live status line is actually the unnamed Box at `App.tsx:2290–2335` ("Status bar above input"); it shows context %, tokens, autonomous dot, positions — **no mode at all**. Mode reaches the UI only via `PromptInput`'s `permissionMode` prop (App.tsx:2346) and the Ctrl+C warning (App.tsx:1934).

**Problem:** Whether the next approved order is simulated or real money is the single highest-stakes bit of state in the product, and today it is encoded as a color the vibe trader was never taught.

**Spec:**

Uses `isLiveCapable(mode)` from Item 1's `permissionModeFsm.ts` (`auto`/`ask` → live-capable; `paper`/`plan`/`strict`/`observe` → not).

**(a) Persistent badge** — new component, rendered in the status bar's left group (`App.tsx` Box at :2291, append after the positions segment):

```ts
// CREATE src/tui/components/status/TradingModeBadge.tsx
import type { PermissionMode } from "../../state/types.ts";
interface TradingModeBadgeProps { permissionMode: PermissionMode; }
export function TradingModeBadge({ permissionMode }: TradingModeBadgeProps): JSX.Element;
```

Rendering (exact):
- `paper` → `<Text color="yellow" bold>▮ PAPER</Text>`
- `auto` → `<Text backgroundColor="red" color="white" bold> LIVE·auto </Text>`
- `ask` → `<Text backgroundColor="red" color="white" bold> LIVE·ask </Text>`
- `strict` / `observe` / `plan` → `<Text dimColor>[strict]</Text>` (mode name in brackets, dim)

Status line mockups:

```
 84% left · 12.4K ctx · 8.2s · 1.1K tok · ▮ PAPER                    $0.42 · Ctrl+P · ? help
 62% left · 9.8K ctx · 2 positions ·  LIVE·auto                      $1.07 · Ctrl+P · ? help
```

**(b) Boundary-crossing banner** — reducer-driven so no mode path can skip it.

State + actions (`types.ts`):

```ts
export interface ModeBannerState {
  mode: PermissionMode;
  kind: "entered_live" | "entered_paper" | "startup";
  shownAt: number;
}
// AppState: modeBanner: ModeBannerState | null;   INITIAL_STATE: null
// Actions:
| { type: "SHOW_MODE_BANNER"; banner: ModeBannerState }
| { type: "DISMISS_MODE_BANNER" }
```

Reducer: in the (Item-1-guarded) `SET_PERMISSION_MODE` case, after the verdict allows the change, compute the crossing: `isLiveCapable(prev) !== isLiveCapable(next)` → set `modeBanner: { mode: next, kind: isLiveCapable(next) ? "entered_live" : "entered_paper", shownAt: Date.now() }`; otherwise leave `modeBanner` untouched. `DISMISS_MODE_BANNER` → `null`.

Startup: in `App.tsx`, in the existing `useEffect([runtimeReady, …])` hint block (App.tsx:848–875) or a sibling effect on `runtimeReady`, dispatch `SHOW_MODE_BANNER` once with `kind: "startup"` when `isLiveCapable(permissionMode) || permissionMode === "paper"` (strict/observe/plan get no startup banner — nothing can execute).

```ts
// CREATE src/tui/components/notices/TradingModeBanner.tsx
interface TradingModeBannerProps {
  banner: ModeBannerState;
  onDismiss: () => void;  // dispatch DISMISS_MODE_BANNER
}
export function TradingModeBanner(props: TradingModeBannerProps): JSX.Element;
```

The component owns an 8-second auto-dismiss timer (`useEffect` + `setTimeout(onDismiss, 8000)`, cleared on unmount — ephemeral display timing is component-local; the *visibility* is reducer state). Render in `App.tsx` directly above the conversation area (first child inside the outer column at App.tsx:1843, before `<PrivacyScreen>`): `state.modeBanner && <TradingModeBanner …/>`.

Visuals (exact copy):

LIVE (border `red`, ⚠ line `red` bold):
```
╭──────────────────────────────────────────────────╮
│  ⚠ LIVE TRADING — real money at risk             │
│  mode: auto — approved orders reach the venue.   │
│  /paper to switch to simulated fills.            │
╰──────────────────────────────────────────────────╯
```
(`mode: ask` variant second line: `mode: ask — each order still needs your approval.`)

PAPER (border `yellow`, first line `yellow` bold):
```
╭──────────────────────────────────────────────────╮
│  ▮ PAPER TRADING — simulated fills only          │
│  No order will reach a real venue.               │
│  /ask or /auto to trade for real.                │
╰──────────────────────────────────────────────────╯
```

**(c) Boot card loudness** — EDIT `printBootCard` (`src/tui/index.tsx`): after the mode row (index.tsx:240), the mode value gains a loud tag: paper → `paper  [PAPER — simulated fills]` with the tag in yellow+bold ANSI (`\x1b[33m\x1b[1m`); auto/ask → `auto  [LIVE]` with `[LIVE]` in red background ANSI (`\x1b[41m\x1b[97m\x1b[1m [LIVE] \x1b[0m`). Also fix `MODE_ANSI.paper` from `""` to yellow (`\x1b[33m`) — "paper intentionally plain" is the bug this item exists to fix; update that comment.

**Files:**
- CREATE `src/tui/components/status/TradingModeBadge.tsx`.
- CREATE `src/tui/components/notices/TradingModeBanner.tsx`.
- EDIT `src/tui/state/types.ts` (`ModeBannerState`, `modeBanner` field, two actions).
- EDIT `src/tui/state/reducer.ts` (`SET_PERMISSION_MODE` crossing logic + `SHOW_MODE_BANNER`/`DISMISS_MODE_BANNER` cases).
- EDIT `src/tui/App.tsx` (badge in status bar left group ~:2318; banner above `PrivacyScreen` ~:1844; startup dispatch effect).
- EDIT `src/tui/index.tsx` (`printBootCard` mode row + `MODE_ANSI.paper`).
- EDIT `src/tui/state/reducer.test.ts` (extend).

**Acceptance criteria:**
1. Reducer test: allowed `paper → ask` sets `modeBanner.kind === "entered_live"`; `ask → paper` sets `"entered_paper"`; `ask → auto` (both live-capable) leaves `modeBanner` unchanged; a BLOCKED transition (Item 1 guard) never sets a banner.
2. Reducer test: `DISMISS_MODE_BANNER` nulls it.
3. Manual: boot in paper mode → boot card shows `[PAPER — simulated fills]`, yellow banner appears and self-dismisses ~8s, status line shows `▮ PAPER` permanently.
4. Manual: `/ask` from paper → red LIVE banner; `/auto` from ask → no new banner (no boundary crossed); status badge updates to `LIVE·auto`.
5. `bun test src/tui` passes; `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:** extend `src/tui/state/reducer.test.ts` with the crossing matrix (criteria 1–2). Component render tests are not house style for src/tui (no ink-testing-library harness present) — keep logic in the reducer/FSM where it's testable; the components stay dumb.

**Gotchas:**
- Item 1 and Item 4 edit the same reducer case — implement together or rebase carefully: **guard verdict first; banner only on allowed transitions**.
- `GordonHeader` and `PromptInputFooter` look like the natural homes but are dead (unrendered) — do not resurrect them for this item; the live anchor is the App.tsx:2290 status bar. (Their deletion/wiring is Item 24-adjacent cleanup, out of scope here.)
- The startup-banner effect must fire once: guard with a `useRef` or fold into the existing run-once hint effect (App.tsx:848) — do not add a new `useState`.
- Banner is `marginBottom`-light and sits ABOVE the scrollback-bound conversation; with inline (non-alt-screen) rendering it will scroll away naturally after dismissal repaints — that is fine, the persistent badge is the durable signal.
- `permissionMode === "paper"` is the TUI's paper concept. Venue-level sandbox (exchange `(sandbox)` suffix, GordonHeader:118) is a different axis — do not conflate; this item keys off `PermissionMode` only.
- Theme tokens: the repo's color discipline migration is Item 28; match the existing literal-color convention of the status bar for now (`"red"`, `"yellow"`, `dimColor`).

---

### Item 5 — Kill-switch/halt status badge (S, P0)

**Current state:** `listTrippedSwitches()` at `src/infra/safety/killSwitches.ts:206–213` returns `Array<{ key: KillSwitchKey; reason: string; trippedAt: number }>`; `isKillSwitchesEnabled()` at :30–33; `KillSwitchKey = { scope: KillSwitchScope; id?: string }` at :45–49. **No event fires on trip/reset** (verified — module has no emitter; `tripKillSwitch`/`resetKillSwitch` just mutate + persist), so event-driven is not available without modifying the safety module — polling it is. Prior art: the radar's `killSwitchAlertProducer` (`src/infra/proactive/producers/risk/killSwitchAlertProducer.ts`) polls `listTrippedSwitches()` on `tick_kill_switch` observations and dedupes by signature (:29–38) — reuse the signature idea, not the producer (radar cards are transient; this badge is persistent chrome). The TUI status bar is `App.tsx:2290–2335`. The bridge already runs a 5s poll (`startBackgroundMonitoring`, `src/tui/bridge/runtime.ts:957–983`) but writing new state fields through it requires touching the App.tsx diff adapter — a TUI-side hook with `useDispatch` is cleaner.

**Problem:** A tripped firm-wide kill switch blocks every execution, but the operator only finds out when an order bounces or they remember `/killswitch list`. Armed-vs-halted must be ambient.

**Spec:**

Pure status module (testable, shared by hook + badge):

```ts
// CREATE src/tui/state/killSwitchStatus.ts
import type { KillSwitchScope } from "../../infra/safety/killSwitches.ts";

export interface TrippedSwitchView {
  scope: KillSwitchScope;
  id?: string;
  reason: string;
  trippedAt: number;
}
export interface KillSwitchStatus {
  enabled: boolean;            // isKillSwitchesEnabled()
  tripped: TrippedSwitchView[]; // sorted oldest-first (listTrippedSwitches order)
}

export function snapshotKillSwitchStatus(): KillSwitchStatus;
/** Stable change-detection key — scope:id:trippedAt joined; avoids re-dispatch every poll. */
export function killSwitchSignature(s: KillSwitchStatus): string;
/** Badge text, pure: see rendering table. */
export function formatKillSwitchBadge(s: KillSwitchStatus): { text: string; severity: "off" | "armed" | "halted" };
```

`formatKillSwitchBadge` table:
| Condition | text | severity |
|---|---|---|
| `!enabled` | `⛉ halt off` | `off` |
| enabled, 0 tripped | `⛉ halt armed` | `armed` |
| 1 tripped | `⛔ HALTED: firm` (label = `scope` or `scope:id`) | `halted` |
| n>1 tripped | `⛔ HALTED: firm +2` (first label + `+(n−1)`) | `halted` |

State + action (`types.ts`):

```ts
// AppState
killSwitches: KillSwitchStatus;   // INITIAL_STATE: { enabled: true, tripped: [] }
// Action union
| { type: "SET_KILL_SWITCH_STATUS"; status: KillSwitchStatus }
```

Reducer: plain assignment.

Polling hook (TUI-side, dispatch-direct — deliberately NOT routed through the bridge `setState`, so the App.tsx diff adapter needs no new branch):

```ts
// CREATE src/tui/hooks/useKillSwitchStatus.ts
import type { Dispatch } from "../state/types.ts";
export function useKillSwitchStatus(dispatch: Dispatch, intervalMs?: number): void; // default 5000
```

`useEffect`: snapshot immediately on mount, then every `intervalMs`; dispatch `SET_KILL_SWITCH_STATUS` only when `killSwitchSignature` (or `enabled`) changed vs. the last dispatched snapshot (keep last signature in a `useRef`). Clear interval on unmount. Call it once in `AppInner` next to the other subscription hooks (`useAlertSubscription` et al., imported around App.tsx:53–55).

Badge component:

```ts
// CREATE src/tui/components/status/KillSwitchBadge.tsx
import type { KillSwitchStatus } from "../../state/killSwitchStatus.ts";
interface KillSwitchBadgeProps { status: KillSwitchStatus; }
export function KillSwitchBadge({ status }: KillSwitchBadgeProps): JSX.Element | null;
```

Rendering: `severity "off"` → render `null` when `GORDON_KILL_SWITCHES` is explicitly disabled… **no** — off must be visible too (a disabled halt system on a live account is itself a finding): `<Text color="yellow">⛉ halt off</Text>`. `armed` → `<Text dimColor>⛉ halt armed</Text>`. `halted` → `<Text backgroundColor="red" color="white" bold> ⛔ HALTED: firm </Text>` (text from `formatKillSwitchBadge`). Place in the status bar left group (`App.tsx` Box at :2291), immediately after Item 4's `TradingModeBadge`:

```
 62% left · 9.8K ctx ·  LIVE·ask  · ⛉ halt armed                     $1.07 · Ctrl+P · ? help
 62% left · 9.8K ctx ·  LIVE·ask  ·  ⛔ HALTED: firm +1              $1.07 · Ctrl+P · ? help
```

Halted detail: the badge is compact; the full reasons remain `/killswitch list` (the radar card from `killSwitchAlertProducer` already points there). Append a one-line hint message ONCE per trip-signature change when transitioning armed→halted — do this in the hook (it already detects signature changes): `dispatch({ type: "ADD_MESSAGE", … content: "⛔ Kill switch tripped — execution blocked. /killswitch list to inspect and reset." })`. No message on boot if already tripped at first snapshot? Yes — DO emit it on the first snapshot too when tripped (a restart with a persisted trip is exactly when the operator most needs the line; trips persist across restarts per killSwitches.ts:11–13).

**Files:**
- CREATE `src/tui/state/killSwitchStatus.ts` (+ CREATE `src/tui/state/killSwitchStatus.test.ts`).
- CREATE `src/tui/hooks/useKillSwitchStatus.ts`.
- CREATE `src/tui/components/status/KillSwitchBadge.tsx`.
- EDIT `src/tui/state/types.ts` (`killSwitches` field + `SET_KILL_SWITCH_STATUS` action + INITIAL_STATE).
- EDIT `src/tui/state/reducer.ts` (assignment case).
- EDIT `src/tui/App.tsx` (call hook in `AppInner`; render badge in status bar left group after `TradingModeBadge`).

**Acceptance criteria:**
1. `bun test src/tui/state` passes — `formatKillSwitchBadge` covers all four table rows; `killSwitchSignature` stable across identical snapshots and distinct when a trip is added/reset.
2. Manual: boot with no trips → dim `⛉ halt armed` in the status line.
3. Manual: trip a switch (e.g. via the emergency panel or a scratch script calling `tripKillSwitch({scope:"firm"}, "manual test trip")` with `GORDON_KILL_SWITCH_STATE_PATH` pointed at the real file), wait ≤5s → red `⛔ HALTED: firm` badge + the one-line chat hint; reset via `/killswitch` flow → badge returns to `⛉ halt armed` within 5s, no repeated hint.
4. Manual: `GORDON_KILL_SWITCHES=0` boot → yellow `⛉ halt off`.
5. Reducer test: `SET_KILL_SWITCH_STATUS` replaces the slice.
6. `bun tsc --noEmit -p tsconfig.json` clean.

**Test plan:**
- `src/tui/state/killSwitchStatus.test.ts`: under `bun test`, `killSwitches.ts` runs in-memory-only (NODE_ENV=test, killSwitches.ts:78) — so `tripKillSwitch`/`resetAllKillSwitches` are safe scaffolding (`resetAllKillSwitches()` clears unconditionally in-memory, killSwitches.ts:155–171). Cases: snapshot reflects a trip; signature changes on trip and on reset; `formatKillSwitchBadge` all severities incl. `+n` overflow; `enabled:false` path via `GORDON_KILL_SWITCHES=0` env juggling (save/restore env in the test).
- `src/tui/state/reducer.test.ts`: criterion 5.

**Gotchas:**
- Do NOT add an EventEmitter to `killSwitches.ts` — it's a safety module with tests across the repo depending on its exact surface; polling at 5s matches the product need (≤5s staleness on a badge whose enforcement is already synchronous inside `isExecutionAllowed` at the tool layer — the badge is observability, not the gate).
- Do NOT route the poll through `startBackgroundMonitoring` in the bridge: that would require a new field branch in the App.tsx `stateUpdater` diff adapter (App.tsx:694–761) for zero benefit. Dispatch-direct from the hook.
- `listTrippedSwitches()` splits persisted keys on `":"` (killSwitches.ts:209) — ids can contain no colon today; don't "fix" that here.
- The radar `killSwitchAlertProducer` stays as-is — badge (persistent chrome) and radar card (event ping) are complementary; don't dedupe one against the other.
- `EmergencyHalt` (App.tsx:1994–1999, `handleEmergencyConfirm`) is the trip-side UI — the badge must visibly flip after using it; if it doesn't, the panel isn't actually calling `tripKillSwitch` (out of scope to fix, but report it).
- Hook is the ONLY new `useInput`-free listener; no keybindings in this item.

---

## Cross-item ordering

1. Item 1 first (FSM module is a dependency of Item 4's `isLiveCapable` + both touch the `SET_PERMISSION_MODE` reducer case — write that case once: guard → banner → assign).
2. Items 2, 3, 5 are independent of each other and of 1/4.
3. All five touch `src/tui/state/types.ts`'s `Action` union — the reducer has an exhaustiveness check (`reducer.ts:200–204` `const _exhaustive: never`), so every added action MUST gain a reducer case in the same change or tsc fails (that's the safety net working — don't suppress it).
4. Shared new test file `src/tui/state/reducer.test.ts` accumulates cases from items 1, 2, 4, 5 — create it in whichever item lands first.
