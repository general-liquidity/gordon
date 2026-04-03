# Gordon TUI — Complete 100% Parity Plan

## Context

This plan takes the Gordon TUI from ~14% feature coverage to 100% parity with Claude Code's sophistication, fully adapted for vibe trading. It covers:
1. Full Claude Code UX depth (architecture, hooks, design system, animation, state management)
2. All Gordon backend features surfaced through the TUI
3. Full command nesting, tool organization, and per-tool rendering like Claude Code

14 phases. 48 new files. 12 modified files. 72 total files when complete.

---

## Phase 1: Complete Command Routing (all 119 commands)

**Modify:** `src/tui/bridge/runtime.ts`

- Route all 28 unhandled tool commands via `commandToPrompt()` → `streamResponse()` fallback
- Add 24 missing menu handlers (thread management, runtime inspection, UI preferences, workspace switching)
- Result: 119/119 commands produce output

---

## Phase 2: State Architecture (Providers + Reducer)

**Create 5 files:**
- `src/tui/state/types.ts` — AppState type, 22 Action types
- `src/tui/state/reducer.ts` — Pure reducer for all state transitions
- `src/tui/state/AppStateProvider.tsx` — Context + `useAppState(selector)` with memoized selectors + `useDispatch()`
- `src/tui/state/NotificationsProvider.tsx` — Priority queue with fold/invalidation/timeout
- `src/tui/state/selectors.ts` — 20+ memoized selectors

**Modify:** `App.tsx` (provider tree), `bridge/runtime.ts` (typed dispatch)

---

## Phase 3: Custom Hooks (10 hooks)

**Create 10 files in `src/tui/hooks/`:**
- `useArrowKeyHistory.ts` — ↑↓ input navigation (last 50)
- `useNotifications.ts` — Notification context access + auto-dismiss
- `useElapsedTime.ts` — Timer during streaming (100ms updates)
- `useEventBusSubscription.ts` — Subscribe to Gordon EventBus events
- `useDoublePress.ts` — Detect double-press within timeout
- `useRuntimeState.ts` — Subscribe to RuntimeStore with selector
- `useTerminalSize.ts` — Responsive {columns, rows}
- `useAnimationFrame.ts` — Shared 50ms clock for all animations
- `useShimmerAnimation.ts` — Character sweep glimmer effect
- `useStalledAnimation.ts` — Red intensity ramp after 3s inactivity

---

## Phase 4: Event-Driven Updates (EventBus → TUI)

**Create:** `src/tui/bridge/eventSubscriptions.ts` — Maps 15 EventBus events to dispatch actions

**Events:** trade:opened, trade:closed, position:stateChanged, price:alert, scan:opportunityFound, plan:created/approved/rejected, risk:approved/rejected, autonomous:started/stopped, system:error, agent:handoff/fallback

**Remove:** 5s polling in `startBackgroundMonitoring()` — replaced by events

---

## Phase 5: Risk Kernel Pre-Check

**Modify:** `bridge/runtime.ts` — Call `evaluateToolAccess()` before approval dialogs
**Modify:** `ApprovalDialog.tsx` — Show risk check results (✓ position size OK, ⚠ drawdown 4.2%)

Auto-deny if kernel blocks. Auto-approve if kernel allows. Dialog only for "pending" decisions.

---

## Phase 6: Autonomous Loop Control

**Modify:** `bridge/runtime.ts` — Menu handlers for `/autonomous start|stop|pause|resume|status`
**Modify:** `FooterHints.tsx` — Show `◈ 1 strategy` when loop active

---

## Phase 7: Design System (9 components)

**Create 9 files in `src/tui/design-system/`:**
- `Pane.tsx` — Bordered section with colored top-line, modal-aware
- `ThemedBox.tsx` — Box with theme-aware color tokens
- `ThemedText.tsx` — Text with theme-aware colors
- `StatusIcon.tsx` — ✓ ✗ ⚠ ℹ ○ ● with colors
- `LoadingState.tsx` — Spinner + message + subtitle
- `Tabs.tsx` — Keyboard nav (←→), controlled/uncontrolled
- `ProgressBar.tsx` — 9-level Unicode blocks (▏▎▍▌▋▊▉█)
- `ListItem.tsx` — Pointer (▸), checkmark (✓), scroll hints (↑↓)
- `index.ts` — Barrel export

**Adopt across:** ApprovalDialog, AgentProgress, BootScreen, SetupWizard, CommandPalette, App

---

## Phase 8: Animation System

**Create 2 files:**
- `src/tui/components/ShimmerChar.tsx` — Color shift per character based on glimmer index
- `src/tui/components/GlimmerMessage.tsx` — Full shimmer sweep during streaming

**Modify:** StreamingText (shimmer cursor), AgentProgress (pulse + stall), BootScreen (fade-in), GordonHeader (pulse)

---

## Phase 9: Advanced Input

**Create 3 files:**
- `src/tui/components/PromptInput.tsx` — Mode indicator, inline typeahead, history, multiline, paste detection
- `src/tui/hooks/useSlashCommandTypeahead.ts` — Debounced command filter
- `src/tui/hooks/useInputHistory.ts` — Persistent history (100 entries, disk-backed)

**Modify:** `App.tsx` — Replace `<TextInput>` with `<PromptInput>`

---

## Phase 10: Per-Tool Renderers (9 renderers)

**Create 9 files in `src/tui/renderers/`:**
- `ScanResultRenderer.tsx` — DataTable: SYM/LAST/CHG%/VOL/SIGNAL
- `AnalysisRenderer.tsx` — Regime badge + levels table + sparkline + signal
- `PlanRenderer.tsx` — Trade ticket: entry/stop/targets/size/risk
- `PositionRenderer.tsx` — DataTable: SYM/SIDE/QTY/ENTRY/LAST/PNL
- `BacktestRenderer.tsx` — Metrics table + equity sparkline
- `OrderBookRenderer.tsx` — Bid/ask sides + spread + imbalance
- `DoctorRenderer.tsx` — StatusIcon per subsystem check
- `HelpRenderer.tsx` — Workflow group headers (◆◈▲◇■●)
- `index.ts` — Registry mapping tool names to renderers

**Modify:** `RichContent.tsx` — Check renderer registry before generic rendering

---

## Phase 11: Full State Management

**Extend:** `src/tui/state/selectors.ts` — 20+ memoized selectors with `Object.is` comparison
**Create:** `src/tui/state/changeObservers.ts` — Auto-persist session, log cost changes

---

## Phase 12: Virtual Scroll

**Create 2 files:**
- `src/tui/hooks/useVirtualScroll.ts` — Visible range calculation, height caching, viewport culling
- `src/tui/components/VirtualMessageList.tsx` — Replaces `<Static>` + manual rendering

Handles 5000+ messages. Keyboard scroll (j/k, Page Up/Down). Height cache invalidation on resize.

---

## Phase 13: Cost & Stats Tracking

**Create 2 files:**
- `src/tui/state/StatsProvider.tsx` — Token cost + trading P&L + commissions + trade count + session duration
- `src/tui/components/CostDisplay.tsx` — `$0.42 tok · +$142 P&L · 3 trades · 12m`

---

## Phase 14: Plugin/MCP Tool Surfacing

**Create 2 files:**
- `src/tui/hooks/useMergedTools.ts` — Built-in + MCP + plugin tools combined
- `src/tui/hooks/useMergedCommands.ts` — SLASH_COMMANDS + plugin commands combined

**Modify:** CommandPalette shows MCP tools with server badge. Unknown commands check MCP registry before agent fallback.

---

## Summary

| Metric | Before | After |
|---|---|---|
| TUI files | 24 | 72 |
| Commands routed | 37/119 | 119/119 |
| Event subscriptions | 0 | 15 |
| Context providers | 0 | 3 |
| Custom hooks | 0 | 15 |
| Design system components | 0 | 9 |
| Per-tool renderers | 0 | 9 |
| State selectors | 0 | 20+ |
| Animation hooks | 0 | 3 |

This achieves 100% parity on all three dimensions: Claude Code UX sophistication, Gordon feature coverage, and command/tool organization depth.
