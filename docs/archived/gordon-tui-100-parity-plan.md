# Gordon TUI — Complete 100% Parity Plan (Final)

## Context

This plan takes the Gordon TUI to full parity with Claude Code's sophistication, adapted for vibe trading. Based on exhaustive scans of all 19 repos in claude-code-meta + full Gordon backend audit.

**Current state:** 71 files under `src/tui/`, architecture wired, basic conversation works.
**Target:** Full Claude Code depth + all Gordon backend features surfaced + trading-specific additions discovered across all repos.

**18 phases. 62 new files. 15 modified files. ~133 total TUI files when complete.**

---

## Phase 1: Complete Command Routing (119 commands)

**Modify:** `src/tui/bridge/runtime.ts`
- Route all unhandled tool commands via `commandToPrompt()` fallback
- Add all missing menu handlers (threads, runtime, workspace, UI preferences)
- Result: 119/119 commands produce output

---

## Phase 2: State Architecture (Providers + Reducer)

**Create 7 files:**
- `src/tui/state/types.ts` — AppState + 22 Action types
- `src/tui/state/reducer.ts` — Pure reducer
- `src/tui/state/AppStateProvider.tsx` — Context + useAppState(selector) + useDispatch()
- `src/tui/state/NotificationsProvider.tsx` — Priority queue with fold/invalidation
- `src/tui/state/selectors.ts` — 20+ memoized selectors
- `src/tui/state/StatsProvider.tsx` — Token cost + trading P&L + commissions
- `src/tui/state/changeObservers.ts` — Auto-persist, cost emission

---

## Phase 3: Custom Hooks (15 hooks)

**Create 15 files in `src/tui/hooks/`:**
- `useArrowKeyHistory.ts` — ↑↓ input history
- `useNotifications.ts` — Notification context
- `useElapsedTime.ts` — Streaming timer
- `useEventBusSubscription.ts` — EventBus → React
- `useDoublePress.ts` — Ctrl+C detection
- `useRuntimeState.ts` — RuntimeStore subscriber
- `useTerminalSize.ts` — Responsive layout
- `useAnimationFrame.ts` — Shared 50ms clock
- `useShimmerAnimation.ts` — Character sweep
- `useStalledAnimation.ts` — Red intensity ramp
- `useSlashCommandTypeahead.ts` — Command filter
- `useInputHistory.ts` — Persistent history
- `useVirtualScroll.ts` — Viewport culling
- `useMergedTools.ts` — Built-in + MCP + plugin tools
- `useMergedCommands.ts` — SLASH_COMMANDS + plugin commands

---

## Phase 4: Event-Driven Updates (50+ events)

**Create:** `src/tui/bridge/eventSubscriptions.ts`

Subscribe to ALL 50+ Gordon EventBus events (not just 15):

**Position lifecycle:** position:created, position:opened, position:closed, position:cancelled, position:rejected, position:reviewed, position:updated
**Trade lifecycle:** trade:opened, trade:closed, trade:updated, trade:partial_close
**Alerts:** alert:price, alert:stop_approaching, alert:tp_hit, alert:stop_triggered
**Scan lifecycle:** scan:started, scan:completed, scan:opportunity
**Plan lifecycle:** plan:created, plan:approved, plan:rejected, plan:cancelled
**Risk:** risk:approved, risk:rejected
**Autonomous:** autonomous:started, autonomous:stopped, autonomous:paused, autonomous:resumed, autonomous:cycle_completed, autonomous:cycle_failed, autonomous:mandate_breached
**Agent:** agent:started, agent:completed, agent:handoff, agent:handoff_ack, agent:fallback, agent:retry, agent:reflection, agent:stream_completed
**System:** system:started, system:armed, system:error
**Exchange:** binance:connected, binance:disconnected, binance:rate_limit
**Guardrails:** guardrail:blocked, guardrail:input_blocked, guardrail:output_sanitized
**Access:** access_control:denied, access_control:warning
**Scheduler:** scheduler:started, scheduler:stopped, scheduler:scan_completed, scheduler:scan_failed
**Memory:** memory:summarized
**Tools:** tool:started, tool:completed

Remove 5s polling — fully event-driven.

---

## Phase 5: Risk Kernel Pre-Check

**Modify:** `src/tui/bridge/runtime.ts` — evaluateToolAccess before approval dialogs
**Modify:** `src/tui/components/ApprovalDialog.tsx` — Show risk check results (✓/✗/⚠ per check)

---

## Phase 6: Autonomous Loop Control

**Modify:** `src/tui/bridge/runtime.ts` — /autonomous start|stop|pause|resume|status
**Modify:** `src/tui/components/FooterHints.tsx` — Strategy count indicator

---

## Phase 7: Design System (9 components)

**Create 9 files in `src/tui/design-system/`:**
- Pane, ThemedBox, ThemedText, StatusIcon, LoadingState, Tabs, ProgressBar, ListItem, index.ts

---

## Phase 8: Animation System

**Create 2 files:**
- `src/tui/components/ShimmerChar.tsx`
- `src/tui/components/GlimmerMessage.tsx`

---

## Phase 9: Advanced Input

**Create 3 files:**
- `src/tui/components/PromptInput.tsx` — Mode indicator, typeahead, history
- `src/tui/hooks/useSlashCommandTypeahead.ts`
- `src/tui/hooks/useInputHistory.ts`

---

## Phase 10: Per-Tool Renderers (13 renderers)

**Create 13 files in `src/tui/renderers/`:**

Original 8:
- ScanResultRenderer, AnalysisRenderer, PlanRenderer, PositionRenderer
- BacktestRenderer, OrderBookRenderer, DoctorRenderer, HelpRenderer

NEW 5 (from all-repo scan):
- `StrategyRenderer.tsx` — `/strategies-live`, `/deploy`, `/strategies` output as table with status/P&L
- `RiskRenderer.tsx` — Risk kernel evaluation results, portfolio risk metrics
- `MarketAnalysisRenderer.tsx` — `/deep`, `/ensemble`, `/parallel`, `/mtf` structured output
- `IndicatorRenderer.tsx` — Technical indicator visualizations (RSI gauge, MACD histogram, BB bands)
- `LiquidationRenderer.tsx` — `/liquidation` data with cascading levels

Plus: `index.ts` — Registry mapping tool names to renderers

---

## Phase 11: Full State Management

**Create/extend:**
- `src/tui/state/selectors.ts` — 20+ memoized selectors
- `src/tui/state/changeObservers.ts` — Auto-persist, cost emission

---

## Phase 12: Virtual Scroll

**Create 3 files:**
- `src/tui/hooks/useVirtualScroll.ts`
- `src/tui/components/VirtualMessageList.tsx`
- `src/tui/components/UnseenDivider.tsx`

---

## Phase 13: Cost & Stats Tracking

**Create 2 files:**
- `src/tui/state/StatsProvider.tsx`
- `src/tui/components/CostDisplay.tsx`

---

## Phase 14: Plugin/MCP Tool Surfacing

**Create 2 files:**
- `src/tui/hooks/useMergedTools.ts`
- `src/tui/hooks/useMergedCommands.ts`

---

## Phase 15: Rich Message Formatting (NEW — from all-repo scan)

**Goal:** Render markdown, tables, code blocks, and links in conversation messages.

**Create 3 files:**
- `src/tui/components/MarkdownRenderer.tsx` — Parse markdown (headers, bold, italic, lists, code blocks, links, blockquotes). Render with Ink Text styling.
- `src/tui/components/CodeBlock.tsx` — Syntax-highlighted code blocks with language detection. Dimmed background.
- `src/tui/components/InlineTable.tsx` — Pipe-separated markdown tables rendered as aligned columns.

**Modify:** `src/tui/components/RichContent.tsx` — Use MarkdownRenderer instead of basic line-by-line rendering.

---

## Phase 16: Settings & Persistence System (NEW)

**Goal:** Persistent user config, trading preferences, risk parameters.

**Create 3 files:**
- `src/tui/state/SettingsProvider.tsx` — Context for user settings. Loads from `~/.gordon/settings.json`. Saves on change. Exposes `useSettings()` hook.
- `src/tui/components/SettingsDialog.tsx` — Full-screen settings UI with Tabs (General, Trading, Risk, Exchange, Broker, LLM). Uses design-system Tabs + ListItem.
- `src/tui/hooks/useSettingsChange.ts` — Detects settings file changes, hot-reloads.

**Settings shape:**
```typescript
{
  permissionMode: "auto" | "ask" | "strict",
  riskLevel: "conservative" | "moderate" | "aggressive",
  cashReservePercent: number,
  maxPositionSizePct: number,
  maxConcurrentTrades: number,
  defaultExchange: string,
  defaultBroker: string,
  theme: "dark" | "light",
  keybindings: Record<string, string>,
}
```

---

## Phase 17: Trading-Specific Features (NEW — from all-repo scan)

**Goal:** Features discovered across all 19 repos that are unique to trading.

**Create 7 files:**

1. `src/tui/components/PrivacyScreen.tsx` — Toggle blur/hide P&L when sharing screen (from claurst Rust TUI `privacy_screen.rs`). Ctrl+Shift+P toggles. Replaces dollar amounts with `$***`.

2. `src/tui/components/ExportDialog.tsx` — Export trade history, session transcript, strategy results to CSV/JSON. Uses design-system Dialog + Select. (from claurst `export_dialog.rs`)

3. `src/tui/components/EmergencyHalt.tsx` — Panic button: `/emergency` or Ctrl+Shift+X. Immediately closes all positions, cancels all orders, disarms system, shows confirmation. (from learn-coding-agent killswitch pattern)

4. `src/tui/components/ContextVisualization.tsx` — Show what the agent knows: active positions, recent analysis, loaded strategies, conversation context window usage. `/context` command. (from claurst `context_viz.rs`)

5. `src/tui/components/FeedbackSurvey.tsx` — After trade closes, optionally rate outcome (1-5 stars + notes). Feeds into learning system. (from claurst `feedback_survey.rs`)

6. `src/tui/components/SessionBrowser.tsx` — Browse past trading sessions with preview (P&L, trade count, duration). Resume any session. (from claurst `session_browser.rs`)

7. `src/tui/components/ThinkStep.tsx` — Explicit "thinking through this trade" step before presenting plan. Shows agent reasoning inline. (from claude-code-main (2) ThinkTool pattern)

---

## Phase 18: Memory & Trade Journal System (NEW — from memdir pattern)

**Goal:** Persistent file-based memory across sessions, adapted for trading.

**Create 4 files:**

1. `src/tui/state/MemoryProvider.tsx` — Context for memory system. Loads markdown files from `~/.gordon/memory/`. Four types: `user` (preferences), `feedback` (trade learnings), `project` (active strategies), `reference` (market knowledge). Exposes `useMemory()` hook.

2. `src/tui/components/MemorySelector.tsx` — Browse and edit memory files. View trade journal entries, strategy notes, market observations.

3. `src/tui/components/TradeJournal.tsx` — Auto-generates journal entry after each trade closes: entry/exit reasoning, P&L, what worked/didn't. Stores in memory system.

4. `src/tui/hooks/useMemoryRelevance.ts` — When user asks about a symbol/strategy, scan memory files for relevant past observations and inject into agent context.

---

## Complete File Manifest (all 18 phases)

### CREATE (62 files total):

**State (7):** types.ts, reducer.ts, AppStateProvider.tsx, NotificationsProvider.tsx, selectors.ts, StatsProvider.tsx, changeObservers.ts

**Hooks (15):** useArrowKeyHistory, useNotifications, useElapsedTime, useEventBusSubscription, useDoublePress, useRuntimeState, useTerminalSize, useAnimationFrame, useShimmerAnimation, useStalledAnimation, useSlashCommandTypeahead, useInputHistory, useVirtualScroll, useMergedTools, useMergedCommands

**Design System (9):** Pane, ThemedBox, ThemedText, StatusIcon, LoadingState, Tabs, ProgressBar, ListItem, index.ts

**Renderers (14):** ScanResult, Analysis, Plan, Position, Backtest, OrderBook, Doctor, Help, Strategy, Risk, MarketAnalysis, Indicator, Liquidation, index.ts

**Animation (2):** ShimmerChar, GlimmerMessage

**Input (1):** PromptInput (rewritten)

**Scroll (3):** VirtualMessageList, UnseenDivider, useVirtualScroll

**Cost (1):** CostDisplay

**Bridge (1):** eventSubscriptions

**Rich Formatting (3):** MarkdownRenderer, CodeBlock, InlineTable

**Settings (3):** SettingsProvider, SettingsDialog, useSettingsChange

**Trading-Specific (7):** PrivacyScreen, ExportDialog, EmergencyHalt, ContextVisualization, FeedbackSurvey, SessionBrowser, ThinkStep

**Memory (4):** MemoryProvider, MemorySelector, TradeJournal, useMemoryRelevance

### MODIFY (15 files):
- App.tsx — provider tree, all new components wired
- bridge/runtime.ts — full command routing, events, risk pre-check, autonomous, settings
- MessageBubble.tsx — markdown rendering, new variants
- ApprovalDialog.tsx — risk check display
- AgentProgress.tsx — animation hooks
- StreamingText.tsx — shimmer animation
- BootScreen.tsx — settings-aware
- SetupWizard.tsx — settings persistence
- CommandPalette.tsx — merged commands
- FooterHints.tsx — strategy count, privacy indicator
- RichContent.tsx — markdown + renderer registry
- GordonHeader.tsx — settings-aware, context display
- PromptInput.tsx — history, typeahead, vim (future)
- index.tsx — settings load on startup
- src/index.tsx — settings + memory init

---

## Summary

| Metric | Current | After All 18 Phases |
|---|---|---|
| TUI files | 71 | ~133 |
| Event subscriptions | 15 | 50+ |
| Slash commands handled | 72 | 119 |
| TUI renderers | 8 | 14 |
| Custom hooks | 15 | 15 (+ 1 settings + 1 memory) |
| Design system components | 9 | 9 |
| State providers | 3 | 5 (+ Settings + Memory) |
| Trading-specific components | 0 | 7 |
| Memory system | None | 4 files, persistent |
| Rich formatting | Basic | Markdown + code + tables |
| Settings persistence | None | Full system |
| Privacy features | None | Privacy screen + export |
| Emergency controls | None | Halt button |

---

## Verification (per phase)

| Phase | Test |
|---|---|
| 1 | Type 20 random commands → each works |
| 2 | State updates propagate correctly |
| 3 | ↑↓ history, elapsed time, terminal resize |
| 4 | Fill/stop/alert events appear without asking |
| 5 | Overleveraged trade auto-denied |
| 6 | /autonomous start → strategy runs |
| 7 | Boot uses LoadingState, approvals use Pane |
| 8 | Streaming shimmers, stalled turns red |
| 9 | Type /sc → typeahead shows scan |
| 10 | /scan → DataTable, /deep → structured analysis |
| 11 | Unrelated state changes don't re-render messages |
| 12 | 5000 messages → no lag |
| 13 | Footer: $0.42 tok · +$142 P&L · 3 trades |
| 14 | Ctrl+P shows MCP tools with badges |
| 15 | Agent markdown renders with headers, bold, code blocks |
| 16 | /settings opens settings dialog, changes persist |
| 17 | Ctrl+Shift+P hides P&L, /emergency halts trading |
| 18 | Past trade observations appear in agent context |
