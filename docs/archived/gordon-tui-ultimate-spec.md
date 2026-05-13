# Gordon TUI — Ultimate Spec & Dev Plan

## Vision

Transform Gordon from a conversation-first trading terminal into the definitive CLI trading desk — matching Claude Code's full sophistication across all 19 repos, adapted for vibe trading. Every feature wires directly into Gordon's backend modules (runtime, events, core, infra, strategies, backtest, gateway, indicators).

**Current state:** 99 TUI files, 107 backend modules, 57 event subscriptions, 14 renderers, 16 hooks, 8 design-system primitives.

**Target:** 99 + 73 new features = ~200 TUI files. Full-stack integration across all `src/` modules.

---

## Architecture Principles

1. **Every feature wires into real backend** — no orphaned UI. Each component calls SessionRuntime, EventBus, or core modules directly.
2. **Provider tree is the spine** — new providers slot into the existing chain: Settings > Memory > Stats > Notifications > AppState.
3. **Events drive everything** — 57+ EventBus events are the source of truth. New features subscribe, never poll.
4. **Reducer is the single state mutation point** — new Actions added to the union, reducer handles them, selectors expose them.
5. **Design system first** — build primitives, then compose features from them.

---

## Integration Map: Feature → Backend Module

| Backend Module | Key APIs | Features That Wire Into It |
|---|---|---|
| `runtime/SessionRuntime` | `.stream()`, `.getState()`, `.subscribe()`, `.getPendingApprovals()` | Fullscreen layout, backgrounding, compaction, effort control, rewind |
| `runtime/PermissionEngine` | `.evaluateToolAccess()` | Keybinding system (permission-context bindings), overlay coordination |
| `runtime/TranscriptStore` | `.getTranscript()`, `.compact()` | Auto-compaction, transcript search, rewind, away summary |
| `runtime/CompactionManager` | `.compactTranscript()`, `.getTokenUsage()` | Token warning, auto-compact, context suggestions |
| `runtime/WorkerRegistry` | `.getWorkers()`, `.getWorkerState()` | Coordinator/swarm mode, background tasks |
| `runtime/ToolRegistry` | `.getTools()`, `.invokeTool()` | FuzzyPicker (tool search), command queue |
| `runtime/RuntimePluginManager` | `.listPlugins()`, `.install()`, `.enable()` | Plugin/marketplace system |
| `events/EventBus` | `.on()`, `.emit()`, `.off()` | Away summary, notifications, all real-time features |
| `events/MarketEventEmitter` | `.watchSymbol()`, `.onPriceTick()` | Prevent sleep, speculation, live data |
| `core/scanner` | `scanMarket()`, `getTopSymbols()` | Global search, speculation, skills /loop |
| `core/analyzer` | `analyzeSymbol()` | Effort control (analysis depth), advisor model |
| `core/planner` | Plan generation | Conversation branching, rewind, diff dialog |
| `core/executor` | Order placement | Double-press safety, command queue, overlay coordination |
| `core/monitor` | Position tracking, trailing stops | Away summary, prevent sleep, desktop notifications |
| `core/autonomous-loop` | `start()`, `stop()`, `pause()` | Background tasks, prevent sleep |
| `core/risk-kernel` | `evaluate()` | Cost threshold, effort control, command queue priority |
| `core/positions/manager` | Position state machine | Rewind (position snapshots), diff dialog |
| `core/memory` | Memory CRUD, embeddings | Auto-dream, memory consolidation, session memory |
| `core/learning/feedback-loop` | Trade outcome collection | Companion mood, stats heatmap |
| `core/backtesting/engine` | `runBacktest()` | Background tasks, prevent sleep, stats |
| `core/genome/evolution-loop` | Strategy evolution | Diff dialog (genome diffs) |
| `core/regime/detector` | Market regime classification | Away summary context, theme auto-switch |
| `infra/agents/orchestrator` | Multi-agent streaming | Coordinator mode, swarm, speculation |
| `infra/exchange/*` | Exchange adapters | Preconnect, retry/backoff, prevent sleep |
| `infra/broker/*` | Broker adapters | Preconnect, retry/backoff |
| `infra/storage/config` | Config load/save | Migration system, settings sync |
| `infra/storage/keyring` | API key management | Setup wizard, keybinding context |
| `infra/llm/client` | LLM API calls | Effort control, advisor model, away summary |
| `infra/mcp/*` | MCP servers | Plugin system, skills |
| `infra/observability/metrics` | Performance metrics | FPS tracking |
| `gateway/daemon/process` | Daemon lifecycle | Prevent sleep, background tasks |
| `gateway/scheduler/local-cron` | Cron scheduling | Skills /loop |
| `strategies/registry` | Strategy listing | FuzzyPicker, tree select |
| `strategies/ensemble` | Multi-strategy runner | Coordinator mode |
| `backtest/engine` | Backtest execution | Stats heatmap, background tasks |
| `backtest/metrics` | Performance metrics | Stats dashboard |
| `backtest/monte-carlo` | Monte Carlo simulation | Background tasks |

---

## Phase 0: Design System Expansion (Foundation)

**Rationale:** Phases 1-10 all depend on these primitives. Build them first.

### 0A: FuzzyPicker
**File:** `src/tui/design-system/FuzzyPicker.tsx`
**What:** Searchable list with preview pane (bottom or right based on terminal width), keyboard nav, Tab/Shift+Tab secondary actions, direction modes (up=atuin-style, down=standard).
**Wires into:** `runtime/ToolRegistry.getTools()` for tool search, `strategies/registry.listStrategies()` for strategy picker, `app/slashCommands` for command palette upgrade.
**Used by:** Global search, quick open, history search, command palette, symbol picker, strategy browser.

### 0B: Dialog
**File:** `src/tui/design-system/Dialog.tsx`
**What:** Modal wrapper with title, Esc to close, Enter to confirm. Registers with overlay context.
**Used by:** All dialogs (idle return, cost threshold, emergency halt, settings, export, etc.)

### 0C: Byline (exists, enhance)
**Modify:** `src/tui/design-system/Byline.tsx` — add keyboard shortcut hint formatting.
**File:** `src/tui/design-system/KeyboardShortcutHint.tsx` — renders platform-aware shortcut (Ctrl vs Cmd).

### 0D: Divider (exists, enhance)
**Modify:** `src/tui/design-system/Divider.tsx` — add color prop, dashed/solid/double styles.

### 0E: Button
**File:** `src/tui/design-system/Button.tsx`
**What:** Focusable button with Enter/Space activation, hover state, tab order.

### 0F: SearchBox
**File:** `src/tui/design-system/SearchBox.tsx`
**What:** Rounded-border text input with search icon, clear button, debounced onChange.

**Phase 0 total: 4 new files, 2 modified files.**

---

## Phase 1: Fullscreen Layout & Scroll Infrastructure (Critical)

**Rationale:** Everything else renders inside this. Must be first.

### 1A: ScrollBox with Imperative API
**File:** `src/tui/components/ScrollBox.tsx`
**What:** Scroll container with `scrollTo`, `scrollBy`, `scrollToElement`, `scrollToBottom`, `stickyScroll` (auto-pin to bottom on new content), viewport culling, clamp bounds.
**Wires into:** `useVirtualScroll.ts` (replace current basic implementation), all scrollable panels.

### 1B: FullscreenLayout
**File:** `src/tui/components/FullscreenLayout.tsx`
**What:** Three-zone layout: scrollable transcript (top), fixed prompt (bottom), overlay pane (float). Manages "N new messages" pill, sticky prompt header (shows current user prompt when scrolled up), modal pane with overlay context.
**Wires into:** Replaces current `App.tsx` layout. All components render inside zones.
**Modify:** `src/tui/App.tsx` — wrap `AppInner` content in `FullscreenLayout`.

### 1C: Overlay Context
**File:** `src/tui/context/overlayContext.tsx`
**What:** Tracks active overlays (dialogs, pickers, menus). Routes Escape key correctly — dismiss topmost overlay, not cancel underlying operation. Non-modal overlays don't steal focus.
**Wires into:** `runtime/PermissionEngine` — approval dialogs register as overlays.

### 1D: Modal Context
**File:** `src/tui/context/modalContext.tsx`
**What:** Nested modal management for scroll-owning dialogs.

### 1E: OffscreenFreeze
**File:** `src/tui/components/OffscreenFreeze.tsx`
**What:** Caches React element when scrolled above viewport. Returns frozen ref so React skips entire subtree. Prevents offscreen spinners, timers from re-rendering.
**Wires into:** `VirtualMessageList.tsx` — wraps each offscreen message.

### 1F: Enhanced VirtualMessageList
**Modify:** `src/tui/components/VirtualMessageList.tsx`
- Add height cache per message (keyed by `message.id + terminal.columns`)
- Slide-step mounting (max 25 new items per commit)
- Scroll quantization (40-row bins to reduce React commits)
- Search indexing via JumpHandle (`nextMatch`, `prevMatch`, `jumpToIndex`)
- Sticky prompt header tracking
- Wrap offscreen items in OffscreenFreeze

### 1G: Scroll Keybinding Handler
**File:** `src/tui/components/ScrollKeybindingHandler.tsx`
**What:** j/k/PgUp/PgDn/G/gg vim-style scroll + `/` to enter search mode + n/N for next/prev match.
**Wires into:** Keybinding system (Phase 2).

**Phase 1 total: 6 new files, 2 modified files.**

---

## Phase 2: Keybinding System (Critical)

**Rationale:** All subsequent features need customizable shortcuts.

### 2A: Keybinding Types & Schema
**File:** `src/tui/keybindings/types.ts`
**What:** `KeyContext` enum (Global, Chat, Approval, Scroll, Dialog, CommandPalette, OrderEntry, Monitoring, HistorySearch, Settings, Tabs), `ParsedKeystroke`, `KeyBinding`, `KeybindingAction`.

### 2B: Default Bindings
**File:** `src/tui/keybindings/defaultBindings.ts`
**What:** Default key map per context. Trading-specific defaults:
- Global: `ctrl+p` command palette, `ctrl+shift+f` global search, `ctrl+r` history search, `ctrl+b` background task, `ctrl+shift+x` emergency halt, `ctrl+shift+p` privacy toggle
- Chat: `ctrl+enter` submit, `escape` cancel, `/` slash command
- Approval: `y` approve, `n` deny, `a` always allow
- OrderEntry: `ctrl+shift+b` buy market, `ctrl+shift+s` sell market
- Scroll: `j/k` line, `ctrl+d/u` half-page, `G/gg` top/bottom

### 2C: Parser
**File:** `src/tui/keybindings/parser.ts`
**What:** Parses `"ctrl+shift+f"` into `ParsedKeystroke`. Supports chord sequences (`"ctrl+x ctrl+k"`).

### 2D: Resolver
**File:** `src/tui/keybindings/resolver.ts`
**What:** Priority resolution: user overrides (`~/.gordon/keybindings.json`) > defaults. Context-scoped: same key does different things in different contexts.
**Wires into:** `infra/storage/config` for loading user keybinding config.

### 2E: User Bindings Loader
**File:** `src/tui/keybindings/loadUserBindings.ts`
**What:** Loads `~/.gordon/keybindings.json`, validates against schema, merges with defaults.
**Wires into:** `SettingsProvider` — reloads on settings change.

### 2F: Reserved Shortcuts
**File:** `src/tui/keybindings/reservedShortcuts.ts`
**What:** Ctrl+C, Ctrl+D, Ctrl+M cannot be rebound.

### 2G: Keybinding Context Provider
**File:** `src/tui/keybindings/KeybindingContext.tsx`
**What:** React context providing `useKeybinding(action, handler)` and `useKeybindings(bindings[])` hooks.
**Wires into:** Provider tree — wraps inside AppStateProvider.

### 2H: Configurable Shortcut Hint
**File:** `src/tui/components/ConfigurableShortcutHint.tsx`
**What:** Renders the actual bound key for an action. Auto-updates when user rebinds. Platform-aware (Cmd vs Ctrl).
**Modify:** `src/tui/components/FooterHints.tsx` — use ConfigurableShortcutHint instead of hardcoded strings.

**Phase 2 total: 8 new files, 1 modified file.**

---

## Phase 3: Search & Navigation (High)

### 3A: Global Search Dialog
**File:** `src/tui/components/GlobalSearchDialog.tsx`
**What:** Ctrl+Shift+F — searches across trade journal (`~/.gordon/memory/`), strategy configs (`strategies/`), audit logs, and session transcripts. Uses FuzzyPicker with file preview. Debounced 100ms, max 500 matches.
**Wires into:** `core/memory/store` for memory search, `infra/storage/chat-history` for transcript search, `strategies/registry` for strategy file search.

### 3B: History Search Dialog
**File:** `src/tui/components/HistorySearchDialog.tsx`
**What:** Ctrl+R — reverse-i-search through past commands. FuzzyPicker with timestamps, age display ("2h ago"), multi-line preview.
**Wires into:** `useInputHistory` hook (existing), `infra/storage/chat-history` for deeper search.

### 3C: Transcript Search
**File:** `src/tui/utils/transcriptSearch.ts`
**What:** Vim-style `/` incremental search within conversation. WeakMap-cached lowercased text per message. Match counter ("3/47").
**Wires into:** `VirtualMessageList` JumpHandle, `ScrollKeybindingHandler`.

### 3D: Quick Open Dialog
**File:** `src/tui/components/QuickOpenDialog.tsx`
**What:** Ctrl+Shift+P — fuzzy finder for strategies, playbooks, indicator configs, memory files. Preview pane shows file content.
**Wires into:** `strategies/registry.listStrategies()`, `core/playbooks/loader`, `core/memory/store`.

### 3E: Search Highlight Hook
**File:** `src/tui/hooks/useSearchHighlight.ts`
**What:** Screen-space text search overlay. All matches get inverse styling, current match yellow.
**Wires into:** FullscreenLayout overlay system.

**Phase 3 total: 5 new files.**

---

## Phase 4: Session Intelligence (Critical for Trading)

### 4A: Away Summary
**File:** `src/tui/hooks/useAwaySummary.ts`
**File:** `src/tui/services/awaySummary.ts`
**What:** Detects terminal blur (DECSET 1004 focus events). After 5 min idle, calls `infra/llm/client` with last 30 messages + current positions to generate recap. Shows "While you were away: BTC rose 2.3%, your trailing stop triggered..."
**Wires into:** `infra/llm/client.query()` for summary generation, `core/positions/manager` for position state, `core/monitor` for alert history, `events/EventBus` for events that occurred during absence.

### 4B: Terminal Focus Context
**File:** `src/tui/context/terminalFocusContext.tsx`
**What:** Tracks terminal focus state (focused/blurred/unknown). Uses DECSET 1004 escape sequences. Pauses animations when blurred.
**Wires into:** Away summary, prevent sleep, blink hook, shimmer animation.

### 4C: Idle Return Dialog
**File:** `src/tui/components/IdleReturnDialog.tsx`
**What:** On return after extended idle: shows token usage, idle duration, market change. Options: continue, clear context + start fresh, dismiss, never ask again.
**Wires into:** `runtime/TranscriptStore` for token count, `core/positions/manager` for P&L delta, `SettingsProvider` for "never ask" persistence.

### 4D: Desktop Notifications
**File:** `src/tui/services/notifier.ts`
**What:** Multi-channel: iTerm2 (`\x1b]9;text\x07`), Kitty, Ghostty, terminal bell. Auto-detect terminal. Only fires when user idle 6+ seconds.
**Wires into:** `events/EventBus` — subscribes to `trade:opened`, `trade:closed`, `alert:*`, `position:closed`, `autonomous:cycle_completed`.

### 4E: Notify After Timeout Hook
**File:** `src/tui/hooks/useNotifyAfterTimeout.ts`
**What:** Fires desktop notification only after N seconds of user inactivity.
**Wires into:** Terminal focus context, activity tracking.

### 4F: Prevent Sleep
**File:** `src/tui/services/preventSleep.ts`
**What:** macOS `caffeinate -i`, ref-counted start/stop, auto-restart every 4min. Activated when: autonomous loop running, pending orders exist, backtest in progress.
**Wires into:** `core/autonomous-loop` state, `core/positions/manager` (pending orders), `backtest/engine` (running backtests), `gateway/daemon/process`.

### 4G: Session Backgrounding
**File:** `src/tui/hooks/useSessionBackgrounding.ts`
**What:** Ctrl+B backgrounds current agent task. Syncs messages between background and foreground. Re-background supported.
**Wires into:** `runtime/WorkerRegistry` for worker state, `runtime/SessionRuntime.stream()` for continuing backgrounded streams.
**Modify:** `src/tui/state/types.ts` — add `BackgroundSession` to AppState, add `BACKGROUND_SESSION` / `FOREGROUND_SESSION` actions.
**Modify:** `src/tui/state/reducer.ts` — handle new actions.

**Phase 4 total: 7 new files, 2 modified files.**

---

## Phase 5: Context Window Management (High)

### 5A: Token Warning
**File:** `src/tui/components/TokenWarning.tsx`
**What:** Shows context usage at 60% (yellow), 80% (red). Suggests `/compact`. Live collapse progress display.
**Wires into:** `runtime/CompactionManager.getTokenUsage()`, `runtime/TranscriptStore`.

### 5B: Auto-Compact System
**File:** `src/tui/services/autoCompact.ts`
**What:** Monitors token usage, triggers compaction at 90%. Multiple strategies: micro (trim tool results), session memory (extract key facts), full (summarize old turns). Circuit breaker after 3 failures.
**Wires into:** `runtime/CompactionManager.compactTranscript()`, `runtime/TranscriptStore`, `core/memory/manager`.

### 5C: Compact Command Handler
**Modify:** `src/tui/bridge/runtime.ts` — add `/compact` menu command handler.
**Wires into:** Auto-compact system.

### 5D: Context Suggestions
**File:** `src/tui/components/ContextSuggestions.tsx`
**What:** Proactive suggestions: "Remove stale watchlist (save ~12k tokens)", "Summarize completed trades (save ~8k tokens)". Shows savings estimates.
**Wires into:** `runtime/CompactionManager` for token analysis, `core/memory/store` for memory size.

### 5E: Context Analysis Utility
**File:** `src/tui/utils/analyzeContext.ts`
**What:** Token budget breakdown by category: system prompt, tool definitions, conversation, memory, positions, market data. Compressibility estimate per category.
**Wires into:** `runtime/TranscriptStore`, `infra/agents/contextBudget`.

**Phase 5 total: 4 new files, 1 modified file.**

---

## Phase 6: Vim Mode & Advanced Input (High)

### 6A: Vim State Machine
**Files:**
- `src/tui/vim/types.ts` — VimMode (INSERT/NORMAL/VISUAL), VimState, VimAction
- `src/tui/vim/motions.ts` — h/l/w/b/e/0/^/$/f/F/t/T, count prefixes
- `src/tui/vim/operators.ts` — d/c/y with motion combos, dd/cc/yy line ops
- `src/tui/vim/textObjects.ts` — iw/aw/i"/a"/i(/a( inner/around
- `src/tui/vim/transitions.ts` — State machine transitions
**Wires into:** Keybinding system (Phase 2) — vim bindings registered in NORMAL context.

### 6B: Vim Text Input
**Modify:** `src/tui/components/PromptInput.tsx` — integrate vim state machine. Show mode indicator (-- INSERT -- / -- NORMAL --). Settings toggle for vim mode.
**Wires into:** `SettingsProvider` for vim mode toggle.

### 6C: Input Buffer with Undo
**File:** `src/tui/hooks/useInputBuffer.ts`
**What:** Ring buffer for input text, debounced push, Ctrl+Z undo, cursor position tracking.

### 6D: History Search Hook (Ctrl+R)
**File:** `src/tui/hooks/useHistorySearch.ts`
**What:** Async generator reads history file backwards, deduplicates, supports accept/cancel/next-match.

### 6E: Paste Handler
**File:** `src/tui/hooks/usePasteHandler.ts`
**What:** Bracketed paste detection, image paste (macOS clipboard), CSV detection for data import.
**Wires into:** `infra/llm/client` for image analysis (chart screenshots).

**Phase 6 total: 7 new files, 1 modified file.**

---

## Phase 7: Diff & Visualization (High)

### 7A: Structured Diff Renderer
**File:** `src/tui/components/StructuredDiff.tsx`
**What:** Syntax-highlighted unified diffs with word-level diff highlighting, line numbers, add/remove/context colors.
**Wires into:** `core/genome/evolution-loop` for strategy diffs, `infra/storage/config` for config change diffs.

### 7B: Diff Dialog
**File:** `src/tui/components/DiffDialog.tsx`
**What:** Browse diffs per trading session. File list with +/- stats. Shows what changed: positions opened/closed, stops adjusted, config modified.
**Wires into:** `core/positions/store` for position snapshots, `runtime/TranscriptStore` for turn-by-turn changes.

### 7C: Stats Dashboard with Heatmap
**File:** `src/tui/components/StatsDialog.tsx`
**What:** Four tabs: Overview (total P&L, win rate, streaks), Daily Returns (ASCII chart via sparklines), Activity Heatmap (GitHub-style 52-week grid), Per-Strategy Breakdown (table).
**Wires into:** `backtest/metrics` for performance calculations, `core/learning/feedback-loop` for trade outcomes, `infra/storage/trades` for historical data, `core/positions/store`.

### 7D: Heatmap Utility
**File:** `src/tui/utils/heatmap.ts`
**What:** GitHub-style activity heatmap using Unicode block characters. Percentile-based intensity coloring.

### 7E: ASCII Chart Utility
**File:** `src/tui/utils/asciiChart.ts`
**What:** Multi-series ASCII line charts for equity curves, daily P&L, drawdown visualization.

**Phase 7 total: 5 new files.**

---

## Phase 8: Safety & Reliability (Critical for Trading)

### 8A: Double-Press Safety (enhance existing)
**Modify:** `src/tui/hooks/useDoublePress.ts` — add configurable timeout, first-press callback, pending state display.
**Wires into:** Emergency halt (double Ctrl+Shift+X), order confirmation (double Enter for large orders).

### 8B: Retry with Backoff
**File:** `src/tui/services/retryWithBackoff.ts`
**What:** Exponential backoff with jitter, exchange-specific retry-after headers, circuit breaker, model fallback. Different strategies: aggressive (order placement), conservative (market data).
**Wires into:** `infra/exchange/*` adapters, `infra/broker/*` adapters, `infra/llm/client`.

### 8C: Command Queue with Priority
**File:** `src/tui/services/commandQueue.ts`
**What:** Thread-safe priority queue: Interrupt (emergency halt) > High (user orders) > Normal (analysis) > Low (scheduled tasks). Visual indicator in prompt.
**Wires into:** `runtime/SessionRuntime.stream()`, `core/executor`, `core/autonomous-loop`.
**File:** `src/tui/hooks/useCommandQueue.ts` — React hook for queue state.

### 8D: Graceful Shutdown
**File:** `src/tui/services/gracefulShutdown.ts`
**What:** On exit: persist session state, close exchange connections, cancel pending non-critical orders, save memory, log final audit entry.
**Wires into:** `runtime/RuntimePersistence`, `infra/exchange/*` (close connections), `core/positions/manager` (pending orders audit), `core/audit/builder`.

### 8E: API Preconnect
**File:** `src/tui/services/apiPreconnect.ts`
**What:** Fire-and-forget HEAD request during boot for TCP+TLS warmup. Preconnect to exchange REST + WebSocket endpoints.
**Wires into:** `infra/exchange/factory` for endpoint URLs, `infra/llm/client` for API endpoint.

### 8F: Ratchet (enhance existing)
**Modify:** `src/tui/components/Ratchet.tsx` — add `lock: 'offscreen'` mode that releases height constraint when scrolled out of view.

**Phase 8 total: 5 new files, 2 modified files.**

---

## Phase 9: Coordinator & Multi-Agent (High)

### 9A: Coordinator Mode
**File:** `src/tui/services/coordinatorMode.ts`
**What:** Spawn parallel analysis workers (technical, sentiment, risk, orderbook). Workers report back via structured notifications. Coordinator synthesizes findings.
**Wires into:** `infra/agents/orchestrator` for multi-agent streaming, `runtime/WorkerRegistry` for worker management, `runtime/workers/ScratchpadStore` for inter-worker data.

### 9B: Coordinator Agent Status Panel
**File:** `src/tui/components/CoordinatorAgentStatus.tsx`
**What:** Live panel below prompt showing all background agents: status icon, elapsed time, token count, cost. Enter to view, x to dismiss, auto-evict completed after 30s.
**Wires into:** `runtime/WorkerRegistry`, `infra/agents/sessionCostLedger`.

### 9C: Background Task System
**File:** `src/tui/services/taskManager.ts`
**What:** Task types: analysis (agent task), backtest (shell task), strategy (daemon task), dream (consolidation). States: pending/running/completed/failed/killed. Ctrl+B to background.
**Wires into:** `core/autonomous-loop`, `backtest/engine`, `core/memory/manager` (dream tasks), `gateway/daemon/process`.

### 9D: Background Tasks Dialog
**File:** `src/tui/components/BackgroundTasksDialog.tsx`
**What:** List all background tasks with status, progress, elapsed time. Enter to foreground, x to kill. Tabs for task types.
**Wires into:** Task manager.

**Phase 9 total: 4 new files.**

---

## Phase 10: Theme System (Medium)

### 10A: Theme Definitions
**File:** `src/tui/themes/themes.ts`
**What:** 6 themes: dark (default), light, dark-daltonized (blue/orange instead of green/red), light-daltonized, dark-high-contrast, light-high-contrast. 90+ color keys covering: UI chrome, diff, agents, alerts, risk levels, P&L, charts.

### 10B: Theme Provider (enhance existing)
**Modify:** `src/tui/design-system/ThemedBox.tsx` — resolve colors from theme context.
**Modify:** `src/tui/design-system/ThemedText.tsx` — resolve colors from theme context.
**File:** `src/tui/themes/ThemeProvider.tsx` — context with live preview, save/cancel.

### 10C: Auto-Theme Detection
**File:** `src/tui/themes/systemThemeWatcher.ts`
**What:** OSC 11 terminal query to detect dark/light mode. Auto-switch theme on change.

### 10D: Theme Picker
**File:** `src/tui/components/ThemePicker.tsx`
**What:** Interactive theme selector with live preview. Uses FuzzyPicker.
**Modify:** `src/tui/bridge/runtime.ts` — add `/theme` menu command.

**Phase 10 total: 4 new files, 3 modified files.**

---

## Phase 11: Trading-Specific Intelligence (Medium)

### 11A: Effort/Analysis Depth Control
**File:** `src/tui/components/EffortIndicator.tsx`
**What:** `/effort low|medium|high|max` — controls analysis depth. Low = quick price check. Max = full multi-indicator confluence + backtest.
**Wires into:** `infra/llm/client` (model thinking budget), `core/analyzer` (indicator depth), `core/backtesting/engine` (include backtest or not).
**Modify:** `src/tui/bridge/runtime.ts` — add `/effort` menu command.
**Modify:** `src/tui/state/types.ts` — add `effortLevel` to AppState.

### 11B: Advisor Model
**File:** `src/tui/services/advisorModel.ts`
**What:** Secondary AI reviews trade proposals. `/advisor on|off|model-name`. Advisor output shown inline as "ADVISOR" variant message.
**Wires into:** `infra/llm/client` (second model call), `core/planner` (intercept plan output).
**Modify:** `src/tui/components/MessageBubble.tsx` — add "advisor" variant.

### 11C: Conversation Branching
**File:** `src/tui/services/conversationBranch.ts`
**What:** Fork conversation at any message. "What if I entered at $50k?" creates new session with inherited context up to fork point.
**Wires into:** `runtime/SessionRuntime.startNewSession()`, `runtime/TranscriptStore` (copy messages up to fork point).
**Modify:** `src/tui/bridge/runtime.ts` — add `/branch` menu command.

### 11D: Rewind/Undo
**File:** `src/tui/components/MessageSelector.tsx`
**What:** Visual message picker to rewind to any past turn. Shows file/position change stats per turn.
**Wires into:** `runtime/TranscriptStore` for message history, `core/positions/store` for position snapshots.
**Modify:** `src/tui/bridge/runtime.ts` — add `/rewind` menu command.

### 11E: Message Actions
**File:** `src/tui/components/MessageActions.tsx`
**What:** Shift+Up activates message navigation. j/k between messages, c to copy, p to pin, r to retry.
**Wires into:** Keybinding system, clipboard (OSC 52).

### 11F: Prompt Suggestions
**File:** `src/tui/services/promptSuggestion.ts`
**What:** AI-generated next-action suggestions based on context + positions. Shows ghost text in prompt.
**Wires into:** `infra/llm/client`, `core/positions/manager`, `core/monitor` (recent alerts).

### 11G: Speculation/Pipelining
**File:** `src/tui/services/speculation.ts`
**What:** Pre-fetch likely next data while showing current result. If user viewed AAPL, pre-fetch orderbook. Track time saved.
**Wires into:** `core/scanner`, `core/analyzer`, `infra/exchange/*` for market data.

**Phase 11 total: 7 new files, 4 modified files.**

---

## Phase 12: Cost & Performance (Medium)

### 12A: Cost Threshold Dialog
**File:** `src/tui/components/CostThresholdDialog.tsx`
**What:** Pops when session API cost exceeds $5 (configurable). One-time per session.
**Wires into:** `StatsProvider` for cost tracking, `SettingsProvider` for threshold config.

### 12B: FPS Metrics
**File:** `src/tui/context/fpsMetrics.tsx`
**What:** Tracks render FPS. Warns when below 10fps (market data overwhelming UI).
**Wires into:** `infra/observability/metrics` for reporting.

### 12C: useMinDisplayTime
**File:** `src/tui/hooks/useMinDisplayTime.ts`
**What:** Each value stays visible minimum N ms. Prevents status flicker during rapid market moves.

### 12D: useBlink (Synchronized)
**File:** `src/tui/hooks/useBlink.ts`
**What:** Synchronized blinking for critical alerts. Pauses when terminal blurred or component offscreen.
**Wires into:** Terminal focus context.

### 12E: Circular Buffer Utility
**File:** `src/tui/utils/circularBuffer.ts`
**What:** Fixed-size rolling window. Used for price ticks, trade history, indicator values.
**Wires into:** `events/MarketEventEmitter` for price tick buffering.

**Phase 12 total: 5 new files.**

---

## Phase 13: Export, Recording & Clipboard (Medium)

### 13A: Copy Command
**Modify:** `src/tui/bridge/runtime.ts` — add `/copy` menu command.
**File:** `src/tui/commands/copy.ts`
**What:** Copy last response, or pick specific code block. OSC 52 clipboard + native fallback.

### 13B: Copy on Select Hook
**File:** `src/tui/hooks/useCopyOnSelect.ts`
**What:** Auto-copy on mouse text selection (iTerm2-style).

### 13C: ASCIICast Recording
**File:** `src/tui/services/asciicast.ts`
**What:** Records trading sessions to .cast format. Buffered writes. Toggle with `/record`.
**Wires into:** `infra/storage/paths` for output directory.

### 13D: ANSI to Image Export
**File:** `src/tui/utils/ansiToSvg.ts`
**What:** Render terminal output as SVG for sharing.

### 13E: Image Paste
**File:** `src/tui/hooks/useImagePaste.ts`
**What:** Detect pasted chart screenshots, save as temp PNG, include in next agent query for analysis.
**Wires into:** `infra/llm/client` (vision model), `infra/storage/paths`.

**Phase 13 total: 5 new files, 1 modified file.**

---

## Phase 14: Memory Consolidation & Learning (Medium)

### 14A: Auto-Dream
**File:** `src/tui/services/autoDream.ts`
**What:** After 5+ sessions or 24 hours, background subagent consolidates trading memories: extracts patterns, updates strategy notes, identifies recurring mistakes. File-lock prevents concurrent runs.
**Wires into:** `core/memory/manager` for memory CRUD, `core/learning/feedback-loop` for trade outcomes, `infra/llm/client` for summarization, `core/learning/insight-store`.

### 14B: Session Memory Extraction
**File:** `src/tui/services/extractMemories.ts`
**What:** Auto-extract learnings from conversations: risk preferences, instrument observations, strategy adjustments. Categories: user, feedback, project, reference.
**Wires into:** `core/memory/manager`, `MemoryProvider`.

### 14C: Memory Update Notification
**File:** `src/tui/components/MemoryUpdateNotification.tsx`
**What:** Banner shown after memory file updated. Auto-dismiss after 5s.

**Phase 14 total: 3 new files.**

---

## Phase 15: Fun & Engagement (Nice-to-Have)

### 15A: Companion/Buddy System
**Files:**
- `src/tui/buddy/types.ts` — Species, Rarity, Stats, Companion
- `src/tui/buddy/companion.ts` — Deterministic generation from user ID hash. 18 species, stats (DISCIPLINE, PATIENCE, TIMING, CONVICTION, CONTRARIAN), rarity system
- `src/tui/buddy/sprites.ts` — 5x12 ASCII sprites with 3-frame idle animation
- `src/tui/buddy/CompanionSprite.tsx` — Animated sprite component, speech bubbles, mood based on P&L
**Wires into:** `core/learning/feedback-loop` for P&L mood, `StatsProvider` for session stats.

### 15B: Tips/Contextual Hints
**File:** `src/tui/services/tips.ts`
**What:** Tip registry with cooldowns. Shows during idle: "Did you know trailing stops auto-adjust?", "Try /ensemble for multi-strategy analysis".
**Wires into:** `SettingsProvider` for tip history persistence.

### 15C: Sticker/Badge System
**File:** `src/tui/services/stickers.ts`
**What:** Tag trades with badges: "revenge trade", "textbook setup", "big win", "lesson learned". Persists with trade journal.
**Wires into:** `core/memory/trade-journal`, `core/learning/feedback-loop`.

**Phase 15 total: 6 new files.**

---

## Phase 16: Plugin & Skills System (Nice-to-Have)

### 16A: Plugin Manager UI
**File:** `src/tui/components/PluginBrowser.tsx`
**What:** Browse, install, enable/disable plugins. Shows trust warnings. Settings per plugin.
**Wires into:** `runtime/RuntimePluginManager`, `infra/mcp/marketplace`.

### 16B: Skills System
**File:** `src/tui/services/skills.ts`
**What:** `/loop` for recurring cron-based market scans. `/batch` for parallel multi-instrument analysis.
**Wires into:** `gateway/scheduler/local-cron` for /loop scheduling, `infra/agents/parallel` for /batch orchestration.

### 16C: Output Styles
**File:** `src/tui/services/outputStyles.ts`
**What:** Custom response formatting: "Brief" (just fills/P&L), "Detailed" (with reasoning), "Risk-focused".
**Wires into:** `infra/agents/promptSections` for system prompt injection.

**Phase 16 total: 3 new files.**

---

## Phase 17: Remaining Polish (Nice-to-Have)

### 17A: Wizard System
**File:** `src/tui/components/Wizard.tsx`
**What:** Multi-step flow: step nav, data persistence, back-tracking. Used for trade setup, strategy creation.
**Wires into:** SetupWizard (refactor to use), strategy creation, exchange setup.

### 17B: Tree Select
**File:** `src/tui/design-system/TreeSelect.tsx`
**What:** Hierarchical expand/collapse selection. Exchange > Market > Pair.

### 17C: Elicitation Dialog
**File:** `src/tui/components/ElicitationDialog.tsx`
**What:** Dynamic form from JSON Schema. Field types: text, enum, boolean, URL.

### 17D: Shell Completions
**File:** `src/tui/services/shellCompletions.ts`
**What:** Auto-generate bash/zsh/fish completions for `gordon` CLI.
**Wires into:** `strategies/registry` for strategy names, `infra/exchange/factory` for exchange names.

### 17E: Auto-Updater
**File:** `src/tui/services/autoUpdater.ts`
**What:** Background version polling every 30min. Channel support (stable/beta). Notification banner.
**Wires into:** `utils/update-notifier`.

### 17F: Migration System
**File:** `src/tui/services/migrations.ts`
**What:** Ordered config migrations for version upgrades.
**Wires into:** `infra/storage/config-migration`.

### 17G: Mailbox (Pub/Sub)
**File:** `src/tui/context/mailbox.tsx`
**What:** Decoupled inter-component communication. Price updates publish, panels subscribe independently.
**Wires into:** `events/MarketEventEmitter`.

### 17H: Voice Input
**File:** `src/tui/services/voiceInput.ts`
**What:** Hold-to-talk via SoX audio recording + STT. "Buy 0.5 ETH at market".
**Wires into:** `infra/llm/client` for STT.

### 17I: Teleport
**File:** `src/tui/services/teleport.ts`
**What:** Resume trading sessions from different devices via session transfer.
**Wires into:** `runtime/RuntimePersistence`, `infra/storage/session`.

### 17J: Bridge/Remote Sessions
**File:** `src/tui/services/bridge.ts`
**What:** WebSocket session bridge for remote monitoring.
**Wires into:** `gateway/daemon/process`, `gateway/protocol/events`.

**Phase 17 total: 10 new files.**

---

## Complete File Manifest

### CREATE (89 new files):

| Phase | Files | Count |
|---|---|---|
| 0: Design System | FuzzyPicker, Dialog, KeyboardShortcutHint, Button, SearchBox | 4 |
| 1: Fullscreen Layout | ScrollBox, FullscreenLayout, overlayContext, modalContext, OffscreenFreeze, ScrollKeybindingHandler | 6 |
| 2: Keybindings | types, defaultBindings, parser, resolver, loadUserBindings, reservedShortcuts, KeybindingContext, ConfigurableShortcutHint | 8 |
| 3: Search | GlobalSearchDialog, HistorySearchDialog, transcriptSearch, QuickOpenDialog, useSearchHighlight | 5 |
| 4: Session Intel | useAwaySummary, awaySummary, terminalFocusContext, IdleReturnDialog, notifier, useNotifyAfterTimeout, preventSleep, useSessionBackgrounding | 7* |
| 5: Context Mgmt | TokenWarning, autoCompact, ContextSuggestions, analyzeContext | 4 |
| 6: Vim & Input | vim/types, motions, operators, textObjects, transitions, useInputBuffer, useHistorySearch, usePasteHandler | 7* |
| 7: Diff & Viz | StructuredDiff, DiffDialog, StatsDialog, heatmap, asciiChart | 5 |
| 8: Safety | retryWithBackoff, commandQueue, useCommandQueue, gracefulShutdown, apiPreconnect | 5 |
| 9: Coordinator | coordinatorMode, CoordinatorAgentStatus, taskManager, BackgroundTasksDialog | 4 |
| 10: Themes | themes, ThemeProvider, systemThemeWatcher, ThemePicker | 4 |
| 11: Trading Intel | EffortIndicator, advisorModel, conversationBranch, MessageSelector, MessageActions, promptSuggestion, speculation | 7 |
| 12: Cost & Perf | CostThresholdDialog, fpsMetrics, useMinDisplayTime, useBlink, circularBuffer | 5 |
| 13: Export & Clip | copy, useCopyOnSelect, asciicast, ansiToSvg, useImagePaste | 5 |
| 14: Memory | autoDream, extractMemories, MemoryUpdateNotification | 3 |
| 15: Fun | buddy/types, companion, sprites, CompanionSprite, tips, stickers | 6 |
| 16: Plugins | PluginBrowser, skills, outputStyles | 3 |
| 17: Polish | Wizard, TreeSelect, ElicitationDialog, shellCompletions, autoUpdater, migrations, mailbox, voiceInput, teleport, bridge | 10 |

*Some phases have service + hook pairs counted together.

### MODIFY (15 existing files):

| File | Phases | Changes |
|---|---|---|
| `App.tsx` | 1,2 | FullscreenLayout wrap, keybinding provider |
| `bridge/runtime.ts` | 5,10,11 | /compact, /theme, /effort, /branch, /rewind, /copy, /record commands |
| `state/types.ts` | 4,11 | BackgroundSession, effortLevel, advisorModel actions |
| `state/reducer.ts` | 4,11 | Handle new actions |
| `components/VirtualMessageList.tsx` | 1 | Height cache, slide-step, scroll quantization, OffscreenFreeze |
| `components/PromptInput.tsx` | 6 | Vim mode integration |
| `components/MessageBubble.tsx` | 11 | Advisor variant |
| `components/FooterHints.tsx` | 2 | ConfigurableShortcutHint |
| `components/Ratchet.tsx` | 8 | Offscreen release mode |
| `hooks/useDoublePress.ts` | 8 | Configurable timeout, first-press callback |
| `design-system/ThemedBox.tsx` | 10 | Theme context resolution |
| `design-system/ThemedText.tsx` | 10 | Theme context resolution |
| `design-system/Byline.tsx` | 0 | Shortcut hint formatting |
| `design-system/Divider.tsx` | 0 | Color, style props |

---

## Verification Matrix

| Phase | Verification Test |
|---|---|
| 0 | FuzzyPicker renders with search, preview, keyboard nav |
| 1 | 5000 messages → no lag. "N new" pill appears when scrolled up. Escape dismisses topmost overlay only |
| 2 | Custom keybinding in `~/.gordon/keybindings.json` overrides default. Chord sequence works. Reserved keys refuse rebind |
| 3 | Ctrl+Shift+F finds trade in journal. Ctrl+R finds past command. `/` search highlights in transcript |
| 4 | Tab away 5min → return shows "While you were away: BTC +2.3%". Desktop notification on order fill. Mac stays awake during autonomous loop |
| 5 | At 80% context → red warning appears. `/compact` reduces to 40%. Suggestions show token savings |
| 6 | Vim `cw` changes word in prompt. Ctrl+Z undoes input change. Ctrl+R searches history |
| 7 | `/diff` shows strategy parameter changes. Stats heatmap renders 52 weeks. ASCII chart shows equity curve |
| 8 | Double-press Enter confirms large order. Exchange API retries on 429. Emergency halt is Interrupt priority in queue |
| 9 | Coordinator spawns 3 parallel analysts. Background task shows in panel. Ctrl+B backgrounds backtest |
| 10 | `/theme dark-daltonized` switches immediately. Green/red replaced with blue/orange. Auto-detect follows terminal |
| 11 | `/effort max` adds backtest to analysis. Advisor reviews trade plan. `/branch` forks at message. `/rewind` restores state |
| 12 | Cost dialog at $5. FPS warning below 10fps. Status messages stay readable during rapid updates |
| 13 | `/copy` copies response. Mouse select → auto-copy. Session recorded to .cast file |
| 14 | After 5 sessions → auto-dream consolidates journal. Memory update banner appears |
| 15 | Companion reacts to P&L (happy duck on profit). Tips show during idle |
| 16 | Plugin browser shows available strategies. `/loop scan:30m` schedules recurring scan |
| 17 | Wizard guides strategy creation. Tree select picks Exchange > Market > Pair |

---

## Summary

| Metric | Current | After All 17 Phases |
|---|---|---|
| TUI files | 99 | ~188 |
| Design system primitives | 8 | 13 |
| Custom hooks | 16 | 28 |
| Providers/contexts | 6 | 12 |
| Renderers | 14 | 16 |
| Components | 46 | 78 |
| Services | 0 | 18 |
| Keybinding contexts | 0 | 11 |
| Themes | 1 | 6 |
| Vim state files | 0 | 5 |
| Backend modules wired | ~8 | All 18 |
| Event subscriptions | 57 | 57+ (new subscriptions for away/notifications) |
| Slash commands | 119 | 130+ |

**Every feature wires into real Gordon backend modules. No orphaned UI. The trading desk is fully integrated.**

---

## AUDIT ADDENDUM — Closing All Backend Gaps

Post-audit of all 20 backend module groups revealed 8 with zero TUI coverage and 12 with partial coverage. The following phases close every gap.

---

## Phase 18: Execution Algorithm Integration

**Gap:** TWAP, VWAP, Iceberg algos exist in `core/execution/algorithms/` but have zero TUI wiring.

### 18A: Execution Algorithm Picker (enhance existing)
**Modify:** `src/tui/components/ExecutionAlgoSelector.tsx` — wire to actual `core/execution/algorithms/` modules instead of static data. Show real slippage estimates from `core/execution/intent-parser`.
**Wires into:** `core/execution/algorithms/twap.ts`, `vwap.ts`, `iceberg.ts` for algo descriptions and parameter schemas.

### 18B: Algo Execution Progress
**File:** `src/tui/components/AlgoExecutionProgress.tsx`
**What:** Live progress for active TWAP/VWAP/Iceberg orders. Shows: filled/total quantity, elapsed/total time, average fill price vs target, child order count.
**Wires into:** `core/execution/session-manager.ts` for session state, `events/EventBus` for `trade:partial_close` events.

### 18C: Intent Parser Integration
**Modify:** `src/tui/bridge/runtime.ts` — route natural language order intents through `core/execution/intent-parser.ts` before execution. "Buy $5k of BTC slowly over 2 hours" → TWAP.

**Phase 18 total: 1 new file, 2 modified files.**

---

## Phase 19: Indicator System

**Gap:** 32 indicators in `core/indicators/` with zero TUI browser or viewer.

### 19A: Indicator Browser
**File:** `src/tui/components/IndicatorBrowser.tsx`
**What:** Browse all 32 indicators grouped by category. Categories: Trend (EMA, SMA, SuperTrend, Parabolic SAR, Ichimoku), Momentum (RSI, MACD, Stochastic RSI, MFI, Squeeze Momentum, Wavetrend, Awesome Oscillator), Volatility (ATR, Bollinger, Camarilla), Volume (Volume Profile, VPT, VWAP, Delta Ladder, FlowScope), Structure (Order Blocks, FVG, Supply-Demand Zones, Fibonacci, Elliott Wave, Three Mountains Rivers), Advanced (Kalman, Nadaraya-Watson, Markov Regime, Divergence, False Breakout, Angled Market Structure). Each shows description, parameters, timeframe suitability.
**Wires into:** `core/indicators/index.ts` for indicator listing, `core/indicators/types.ts` for parameter schemas.
**Modify:** `src/tui/bridge/runtime.ts` — add `/indicators` menu command.

### 19B: Indicator Value Viewer
**File:** `src/tui/components/IndicatorValueViewer.tsx`
**What:** Real-time indicator values for a symbol. Select indicators, see current values + sparkline history. Color-coded zones (RSI overbought=red, oversold=green, neutral=gray).
**Wires into:** `core/indicators/*.ts` for calculations, `infra/exchange/*` for candle data.
**Modify:** `src/tui/bridge/runtime.ts` — add `/indicator <name> <symbol>` command.

### 19C: Indicator Overlay for Charts
**Modify:** `src/tui/components/InlineChart.tsx` — support multiple overlay series (e.g., price + Bollinger bands, price + EMA crossover). Different colors per overlay.
**Wires into:** `core/indicators/bollinger.ts`, `core/indicators/ema.ts`, etc.

**Phase 19 total: 2 new files, 2 modified files.**

---

## Phase 20: Consensus Protocol Visualization

**Gap:** 5-evaluator weighted voting system in `core/consensus/` is invisible to users.

### 20A: Consensus Detail Panel
**File:** `src/tui/components/ConsensusDetailPanel.tsx`
**What:** Shows the full consensus evaluation for a trade proposal: each evaluator (Risk, Regime, Portfolio, Technical, Historical), their individual vote (BUY/SELL/NEUTRAL/HOLD), weight, confidence score, and reasoning. Final aggregate with quorum status.
**Wires into:** `core/consensus/protocol.ts` for evaluation, `core/consensus/store.ts` for history.

### 20B: Enhance existing ConsensusView
**Modify:** `src/tui/components/ConsensusView.tsx` — wire to actual `core/consensus/protocol.ts` instead of mock data. Show real weights (Risk 0.3, Regime 0.2, etc.), quorum rules, and threshold configuration.
**Modify:** `src/tui/bridge/runtime.ts` — add `/consensus <symbol>` command.

**Phase 20 total: 1 new file, 2 modified files.**

---

## Phase 21: Market Analysis Modules

**Gap:** Whale detection, breakout detection, consolidation detection, market scorer in `core/market-analysis/` have zero TUI presence.

### 21A: Market Overview Panel
**File:** `src/tui/components/MarketOverviewPanel.tsx`
**What:** Composite view showing: market score (0-100 with progress bar), current regime, detected breakout/consolidation setups, whale activity alerts. Auto-refreshes via EventBus.
**Wires into:** `core/market-analysis/market-scorer.ts`, `core/market-analysis/breakout-detector.ts`, `core/market-analysis/consolidation-detector.ts`, `core/market-analysis/whale-detector.ts`, `core/regime/detector.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/market` menu command.

### 21B: Whale Alert Notifications
**Modify:** `src/tui/bridge/eventSubscriptions.ts` — subscribe to whale detection events (large buys/sells, accumulation patterns). Dispatch as `alert` variant notifications.
**Wires into:** `core/market-analysis/whale-detector.ts`, `events/EventBus`.

**Phase 21 total: 1 new file, 2 modified files.**

---

## Phase 22: DeFi Dashboard

**Gap:** 7 DeFi integrations (29 files) across Chainlink, Uniswap, DeFiLlama, Base, Solana, Polkadot, AgentKit with zero TUI features.

### 22A: DeFi Overview Panel
**File:** `src/tui/components/DeFiOverviewPanel.tsx`
**What:** Tabbed panel for DeFi integrations. Tabs: Chainlink (price feeds, CCIP status, data streams), Uniswap (pool browser, token search, swap estimates), Yields (DeFiLlama yield comparison, top pools), On-Chain (Base chain explorer, DEX screener signals), Solana (lending, perps, pools, bridges), Polkadot (staking, assets). Each tab shows relevant data from its integration module.
**Wires into:** `infra/chainlink/feeds.ts`, `infra/chainlink/ccip.ts`, `infra/chainlink/streams.ts`, `infra/uniswap/client.ts`, `infra/uniswap/subgraph.ts`, `infra/defillama/client.ts`, `infra/base/dexscreener.ts`, `infra/base/signals.ts`, `infra/solanakit/provider.ts`, `infra/polkadotkit/provider.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/defi` menu command.

### 22B: Yield Comparison Renderer
**File:** `src/tui/renderers/YieldRenderer.tsx`
**What:** Renders DeFiLlama yield data as sorted table: Protocol, Pool, TVL, APY (with sparkline history), Chain. Color-coded APY (high=green, medium=yellow, low=gray).
**Wires into:** `infra/defillama/client.ts`.
**Modify:** `src/tui/renderers/index.ts` — register yield renderer.

### 22C: On-Chain Wallet Status
**File:** `src/tui/components/WalletStatus.tsx`
**What:** Show connected wallet balances, recent transactions, pending approvals. Supports EVM (Base), Solana, Polkadot chains.
**Wires into:** `infra/agentkit/provider.ts`, `infra/solanakit/provider.ts`, `infra/polkadotkit/provider.ts`.

**Phase 22 total: 3 new files, 2 modified files.**

---

## Phase 23: Risk Kernel Control Panel

**Gap:** 8 risk checks and 3 modes exist but users can't view or configure them.

### 23A: Risk Configuration Panel
**File:** `src/tui/components/RiskConfigPanel.tsx`
**What:** Full risk kernel control panel. Shows all 8 checks with current thresholds and real-time values: (1) Position size limits, (2) Daily loss limits, (3) Portfolio drawdown limits, (4) Single-asset concentration, (5) Correlated-asset exposure, (6) Max open positions, (7) Leverage limits, (8) Liquidity adequacy. Each shows: current value, limit, progress bar, pass/fail. Mode selector: enforce/warn/paper. Editable thresholds.
**Wires into:** `core/risk-kernel/kernel.ts`, `core/risk-kernel/config.ts`, `core/risk-kernel/correlation.ts`, `core/risk-kernel/portfolio-context.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/risk-config` menu command.

### 23B: Risk Audit Log
**File:** `src/tui/components/RiskAuditLog.tsx`
**What:** Scrollable history of risk kernel evaluations. Shows: timestamp, order details, each check result (pass/fail/warn), final decision, mode at time of evaluation.
**Wires into:** `core/risk-kernel/audit.ts`.

**Phase 23 total: 2 new files, 1 modified file.**

---

## Phase 24: Backtesting Suite

**Gap:** Walk-forward, optimization (grid/random search), alpha-decay, and reporting have no TUI features.

### 24A: Backtest Configuration Wizard
**File:** `src/tui/components/BacktestWizard.tsx`
**What:** Multi-step backtest setup using Wizard component: Step 1 — select strategy (from 27), Step 2 — select symbol + timeframe, Step 3 — date range + initial capital, Step 4 — optimization mode (none/grid/random), Step 5 — review + launch. Launches as background task.
**Wires into:** `backtest/engine.ts`, `backtest/optimization/grid-search.ts`, `backtest/optimization/random-search.ts`, `strategies/registry.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/backtest` menu command.

### 24B: Optimization Results Viewer
**File:** `src/tui/components/OptimizationResults.tsx`
**What:** Grid/heatmap showing parameter sweep results. Rows = param1 values, cols = param2 values, cells = Sharpe ratio (color-coded). Highlights best + flags overfitting risk.
**Wires into:** `backtest/optimization/grid-search.ts`, `backtest/optimization/overfitting.ts`.

### 24C: Walk-Forward Results
**File:** `src/tui/components/WalkForwardResults.tsx`
**What:** Walk-forward analysis display. Shows in-sample vs out-of-sample performance per window. Equity curves side-by-side. Overall robustness score.
**Wires into:** `backtest/walk-forward.ts`.

### 24D: Alpha Decay Chart
**File:** `src/tui/components/AlphaDecayChart.tsx`
**What:** ASCII chart showing strategy alpha over time. Detects decay point. Warns when strategy may be losing edge.
**Wires into:** `backtest/alpha-decay.ts`.

### 24E: Backtest Report Export
**Modify:** `src/tui/components/ExportDialog.tsx` — add backtest export option (JSON/CSV/HTML).
**Wires into:** `backtest/reporting/export.ts`, `backtest/reporting/formatter.ts`.

**Phase 24 total: 4 new files, 2 modified files.**

---

## Phase 25: Strategy DSL & Genome Evolution

**Gap:** Strategy DSL (declarative strategy builder) and genome evolution (genetic optimization) have no TUI entry points.

### 25A: Strategy DSL Editor
**File:** `src/tui/components/StrategyDSLEditor.tsx`
**What:** Form-based strategy builder following the DSL schema. Fields: name, entry conditions (indicator + operator + value), exit conditions, position sizing, risk parameters. Live validation against `strategies/dsl/schema.ts`. Preview as JSON. Save/load.
**Wires into:** `strategies/dsl/schema.ts` for validation, `strategies/dsl/interpreter.ts` for preview, `strategies/dsl/storage.ts` for save/load, `strategies/dsl/adapter.ts` for backtest integration.
**Modify:** `src/tui/bridge/runtime.ts` — add `/strategy-builder` menu command.

### 25B: Genome Evolution Panel
**File:** `src/tui/components/GenomeEvolutionPanel.tsx`
**What:** Launch and monitor strategy evolution runs. Shows: generation count, best fitness score, population diversity, mutation rate. Live progress as background task. Browse evolved variants with fitness scores.
**Wires into:** `core/genome/evolution-loop.ts`, `core/genome/fitness.ts`, `core/genome/manager.ts`, `core/genome/mutator.ts`, `core/genome/store.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/evolve` menu command.

### 25C: Enhance existing GenomeDiffViewer
**Modify:** `src/tui/components/GenomeDiffViewer.tsx` — wire to actual `core/genome/store.ts` to browse real evolved strategies, not just show diffs.

**Phase 25 total: 2 new files, 2 modified files.**

---

## Phase 26: Exchange & Broker Management

**Gap:** Individual exchanges (8) and brokers (9) are not enumerable or configurable from TUI.

### 26A: Exchange Manager Panel
**File:** `src/tui/components/ExchangeManagerPanel.tsx`
**What:** List all 8 exchanges (Binance, Binance-US, Coinbase, Kraken, Hyperliquid, Bitfinex, Robinhood, Uniswap) with: connection status, API key status, rate limit usage, last ping latency, supported features (spot/futures/margin). Connect/disconnect controls. Per-exchange health dashboard.
**Wires into:** `infra/exchange/factory.ts`, `infra/exchange/adapters/*.ts`, `infra/binance/permissions.ts`, `infra/cache/price-cache.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — enhance `/exchange` command to open panel.

### 26B: Broker Manager Panel
**File:** `src/tui/components/BrokerManagerPanel.tsx`
**What:** List all 9 brokers (Alpaca, E*Trade, IBKR, Schwab, Tastytrade, TradeStation, Tradier, Trading212, Webull) with: connection status, account type, buying power, supported order types. Connect/disconnect controls.
**Wires into:** `infra/broker/factory.ts`, `infra/broker/adapters/*.ts`, `infra/broker/inclusion-gate.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — enhance `/broker` command to open panel.

**Phase 26 total: 2 new files, 2 modified files.**

---

## Phase 27: Remaining Module Coverage

**Gap:** Playbook protocol, learning/counterfactual, audit chain, gateway advanced, data sources, SDK.

### 27A: Playbook Execution Panel
**Modify:** `src/tui/components/PlaybookBrowser.tsx` — wire to actual `core/playbooks/registry.ts`, show 3 built-in playbooks (mean-reversion, momentum-breakout, trend-following), display protocol execution steps, validation feedback.
**Wires into:** `core/playbooks/loader.ts`, `core/playbooks/parser.ts`, `core/playbooks/protocol.ts`, `core/playbooks/validator.ts`.

### 27B: Counterfactual Analysis Panel
**File:** `src/tui/components/CounterfactualPanel.tsx`
**What:** "What if" analysis on closed trades. Shows: actual outcome, alternative scenarios (different entry, different stop, different size), P&L comparison. Also surfaces gateway pre-flight order simulation.
**Wires into:** `core/learning/counterfactual-analyzer.ts`, `gateway/advanced/counterfactual.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/whatif` menu command.

### 27C: Insight Browser
**File:** `src/tui/components/InsightBrowser.tsx`
**What:** Browse accumulated trading insights extracted by the learning system. Filterable by symbol, strategy, timeframe. Shows insight text, confidence, source trades.
**Wires into:** `core/learning/insight-store.ts`.

### 27D: Audit Chain Viewer
**Modify:** `src/tui/components/AuditBrowser.tsx` — wire to actual `core/audit/chain.ts` for hash-linked audit entries. Show chain integrity status. Add export capability.
**Wires into:** `core/audit/chain.ts`, `core/audit/store.ts`.

### 27E: Reconciliation Status
**File:** `src/tui/components/ReconciliationStatus.tsx`
**What:** Shows position/balance reconciliation results between Gordon and exchange/broker. Highlights discrepancies. Last run time, next scheduled.
**Wires into:** `gateway/reconciliation/loop.ts`, `services/reconciliation.service.ts`.

### 27F: Data Source Health
**File:** `src/tui/components/DataSourceHealth.tsx`
**What:** Shows data pipeline health: exchange sources, broker sources, cache hit rates, data freshness per symbol.
**Wires into:** `infra/data/sources/manager.ts`, `infra/data/sources/cache.ts`.

### 27G: SDK Scaffold Wizard
**File:** `src/tui/components/SDKScaffoldWizard.tsx`
**What:** Interactive `gordon init` — select template (agent-ts, strategy-ts), name project, configure, scaffold files. Uses Wizard component.
**Wires into:** `sdk/scaffold.ts`, `sdk/templates/*`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/sdk-init` menu command.

### 27H: Regime Status Panel
**File:** `src/tui/components/RegimeStatusPanel.tsx`
**What:** Current market regime per watched symbol. Shows: regime type (trending/ranging/volatile), confidence, regime duration, regime history sparkline. Auto-updates via EventBus.
**Wires into:** `core/regime/detector.ts`, `core/regime/classifier.ts`, `core/regime/watcher.ts`.
**Modify:** `src/tui/bridge/runtime.ts` — add `/regime` menu command.

**Phase 27 total: 6 new files, 4 modified files.**

---

## Updated Complete Manifest

### AUDIT ADDENDUM FILES:

| Phase | New Files | Modified Files |
|---|---|---|
| 18: Execution Algos | 1 (AlgoExecutionProgress) | 2 (ExecutionAlgoSelector, runtime.ts) |
| 19: Indicators | 2 (IndicatorBrowser, IndicatorValueViewer) | 2 (InlineChart, runtime.ts) |
| 20: Consensus | 1 (ConsensusDetailPanel) | 2 (ConsensusView, runtime.ts) |
| 21: Market Analysis | 1 (MarketOverviewPanel) | 2 (eventSubscriptions, runtime.ts) |
| 22: DeFi | 3 (DeFiOverviewPanel, YieldRenderer, WalletStatus) | 2 (renderers/index, runtime.ts) |
| 23: Risk Kernel | 2 (RiskConfigPanel, RiskAuditLog) | 1 (runtime.ts) |
| 24: Backtesting | 4 (BacktestWizard, OptimizationResults, WalkForwardResults, AlphaDecayChart) | 2 (ExportDialog, runtime.ts) |
| 25: Strategy DSL + Genome | 2 (StrategyDSLEditor, GenomeEvolutionPanel) | 2 (GenomeDiffViewer, runtime.ts) |
| 26: Exchange + Broker | 2 (ExchangeManagerPanel, BrokerManagerPanel) | 2 (runtime.ts x2) |
| 27: Remaining | 6 (CounterfactualPanel, InsightBrowser, ReconciliationStatus, DataSourceHealth, SDKScaffoldWizard, RegimeStatusPanel) | 4 (PlaybookBrowser, AuditBrowser, runtime.ts x2) |
| **Addendum Total** | **24 new files** | **21 modifications** |

---

## FINAL Summary (All 27 Phases)

| Metric | Current | After All 27 Phases |
|---|---|---|
| TUI files | 99 | **~212** |
| Design system primitives | 8 | 13 |
| Custom hooks | 16 | 28 |
| Providers/contexts | 6 | 12 |
| Renderers | 14 | 17 |
| Components | 46 | **102** |
| Services | 0 | 18 |
| Keybinding contexts | 0 | 11 |
| Themes | 1 | 6 |
| Vim state files | 0 | 5 |
| Backend modules wired | ~8 | **All 20 (100%)** |
| Event subscriptions | 57 | 60+ |
| Slash commands | 119 | **145+** |
| Exchanges surfaced | 0 direct | **8 (all)** |
| Brokers surfaced | 0 direct | **9 (all)** |
| Strategies browsable | 0 | **27 (all)** |
| Indicators browsable | 0 | **32 (all)** |
| DeFi integrations surfaced | 0 | **7 (all)** |
| Risk checks configurable | 0 | **8 (all)** |
| Backtest modes accessible | 1 | **5 (engine, monte carlo, walk-forward, grid, random)** |

## Updated Verification Matrix (Addendum)

| Phase | Verification Test |
|---|---|
| 18 | "Buy $5k BTC slowly over 2h" → TWAP selected. Progress shows filled/total. |
| 19 | `/indicators` shows all 32 grouped by category. `/indicator rsi BTC` shows live value with sparkline. |
| 20 | `/consensus BTC` shows 5 evaluators with votes, weights, confidence. Quorum status visible. |
| 21 | `/market` shows score + regime + whale alerts + breakout setups. Whale notification fires on large buy. |
| 22 | `/defi` opens 6-tab panel. Yields tab shows DeFiLlama data. Chainlink tab shows price feeds. |
| 23 | `/risk-config` shows 8 checks with progress bars. Mode switches between enforce/warn/paper. |
| 24 | `/backtest` wizard walks through 5 steps. Grid optimization shows parameter heatmap. Walk-forward shows in/out sample. |
| 25 | `/strategy-builder` opens DSL form with validation. `/evolve` launches background evolution with live fitness tracking. |
| 26 | `/exchange` shows 8 exchanges with health. `/broker` shows 9 brokers with buying power. |
| 27 | `/whatif` shows counterfactual scenarios. `/regime` shows per-symbol regime. Reconciliation shows discrepancies. |

**All 20 backend module groups now have 100% TUI coverage. Zero orphaned modules. The trading desk is fully integrated.**
