# Gordon TUI v3 — Design from First Principles

## Technology Decision

**Stack: Ink + ink-ui + custom trading components.**

- **Ink** (`ink@^6.6.0`) — React renderer for terminals. Same foundation as Claude Code, Gemini CLI, GitHub Copilot CLI. Already in Gordon's package.json.
- **ink-ui** (`@inkjs/ui`) — 13 pre-built components (TextInput, Select, Spinner, Badge, ProgressBar, Alert, etc.)
- **Custom components** — built on `<Box>` + `<Text>` using Claude Code patterns as reference:
  - `<DataTable>` — ticker-grade sortable table with right-aligned numbers, color-coded cells
  - `<InlineChart>` — sparkline using Unicode block characters (▁▂▃▅▇)
  - `<ApprovalDialog>` — radio select approval with rule explanation
  - `<AgentProgress>` — task tree with box-drawing chars and worker badges
  - `<CommandPalette>` — fuzzy search overlay (based on Claude Code's FuzzyPicker)

**Why not Rezi:** Pre-alpha, undocumented API mismatches, Windows inline mode issues, broken badge/border rendering. The 56 widgets are impressive on paper but unreliable in practice. Rezi can be revisited when it reaches v1.

**Why Ink:** Proven at scale (Claude Code's 4,537-file codebase), React component model, every Claude Code pattern directly portable, works on Windows, already a Gordon dependency.

## Classification

**Purpose:** AI trading agent you talk to in your terminal.

**Primary role:** Runtime — long-running conversational session with an AI agent that executes trading operations on your behalf.

**Primary user type:** Human trader — conversational, not dashboard-native. They talk, Gordon acts.

**Primary interaction form:** Conversational REPL with inline rich output (tables, charts, approvals). NOT a dashboard. NOT a multi-panel IDE.

**Statefulness:** Sessionful — persistent threads, resumable conversations, runtime state.

**Risk profile:** High — real money. Multi-layer approval gates (SAFE/ARMED + per-action).

**Secondary surfaces:**
- CLI contract (`--help`, `--json`, `--plain`) for automation
- NDJSON streaming for temporal operations

## Design Stance

Gordon is **Claude Code for trading**. Not Bloomberg Terminal. Not a Python TUI dashboard.

The conversation IS the product. Everything else — tables, charts, positions, approvals — appears INSIDE the conversation as inline rich output. The user talks to Gordon. Gordon talks back with words, tables, charts, and actions.

**Gordon is NOT:**
- A dashboard with panels you stare at
- A multi-tab workspace you navigate between
- An IDE with sidebars and toolbars
- A monitoring console with live-updating grids

**Gordon IS:**
- An agent you talk to that happens to know how to trade
- A conversation where market data, analysis, and execution flow naturally
- An interface where the input is always front and center
- A tool where you scroll UP to see history, not SWITCH TABS

## The Layout

```
┌─────────────────────────────────────────────────────────┐
│ GORDON  SAFE  thread-abc  Scanner  3 tools  $0.42       │ ← Status line (1 line, minimal)
├─────────────────────────────────────────────────────────┤
│                                                          │
│  GORDON                                                  │
│    Welcome. Your trading agent is ready.                 │
│                                                          │
│  YOU                                                     │
│    scan top movers                                       │
│                                                          │
│  GORDON · Scanner                                        │
│    Found 8 setups across 50 symbols.                     │
│                                                          │
│    ┌─────────────────────────────────────────────────┐   │
│    │ SYM    LAST      CHG%    VOL      SIGNAL       │   │ ← Inline table
│    │ BTC    67,432    +2.1%   1.2B     BREAKOUT     │   │
│    │ ETH    3,821     +1.8%   890M     SUPPORT      │   │
│    │ SOL    142.50    +4.2%   340M     MOMENTUM     │   │
│    └─────────────────────────────────────────────────┘   │
│                                                          │
│    Try: /analyze BTC  or  "build me a swing long on ETH" │
│                                                          │
│  YOU                                                     │
│    analyze BTC                                           │
│                                                          │
│  GORDON · Analyst                                        │
│    ● Analyzing BTC/USDT...                               │ ← Streaming indicator
│      ├─ Market data ✓                                    │ ← Task tree inline
│      ├─ Indicators ✓                                     │
│      └─ Pattern recognition...                           │
│                                                          │
│    BTC/USDT Technical Analysis                           │
│    Regime: TRENDING (bullish, 78% confidence)            │
│                                                          │
│    ┌──────────────────────────────────────┐              │
│    │ ▁▂▃▃▄▅▆▆▇█████▇▇▆▇▇████            │              │ ← Sparkline chart
│    │ Support: 65,200  Resistance: 69,400  │              │
│    └──────────────────────────────────────┘              │
│                                                          │
│    Key Levels:                                           │
│      S1: 65,200  S2: 63,800  S3: 61,500                │
│      R1: 69,400  R2: 71,200  R3: 73,000                │
│                                                          │
│    Signal: BUY — RSI 58, MACD bullish cross,            │
│    volume above 20-day average.                          │
│                                                          │
│  ──────────────────────────────────────────────────────  │ ← Approval divider
│  APPROVAL [a3f2]                                         │
│    Gordon wants to use `create_trade_plan` (BTC)         │
│    Scope: livetrade.execute · Risk: medium               │
│    → approve a3f2  |  deny a3f2  |  approve a3f2 persist│
│  ──────────────────────────────────────────────────────  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ · Type a message or / for commands                       │ ← Input (always here)
└─────────────────────────────────────────────────────────┘
```

## Key Principles

### 1. Conversation dominates

The scrolling conversation area takes 95%+ of the screen. Everything appears inline:
- Agent text responses
- Tables (scan results, positions, strategies)
- Charts (sparklines, price history)
- Approval requests (inline, not modal)
- Tool progress (task tree)
- Errors (with fix suggestions)

There are NO side panels. NO tabs. NO lens switching. NO dashboards.

### 2. Input always at the bottom

The input field is PINNED to the bottom of the screen. It never moves, never hides, never gets covered by modals. The user can always type.

Supports:
- Natural language: "show me ETH setups"
- Slash commands: /scan, /analyze BTC, /positions
- Approval shorthand: approve a3f2, deny a3f2
- History: arrow up/down to recall previous inputs

### 3. Status line is one line

Top of screen, one line, contextual metadata only:
- GORDON (brand)
- SAFE/ARMED (mode — green/red)
- Thread ID (truncated)
- Active agent (when streaming)
- Tool count / token usage
- Cost (session total)

NOT a toolbar. NOT a navigation bar. Just context.

### 4. Tables appear inline in conversation

When Gordon returns tabular data (scans, positions, strategies, backtests), the table renders INSIDE the message, not in a separate panel.

Uses Rezi's `ui.table()` with:
- Color-coded cells (green/red for change, risk)
- Right-aligned numbers
- Sortable columns (when focused)
- Compact headers (SYM, LAST, CHG%, VOL)

### 5. Charts appear inline

Sparklines, price charts, equity curves — all render inside messages using Rezi's `ui.sparkline()` and `ui.canvas()`. They're part of the narrative, not separate widgets.

### 6. Approvals are inline, not modal

Routine approvals (medium risk) appear as a highlighted message in the conversation:
```
APPROVAL [a3f2]
  Gordon wants to use `create_trade_plan`
  Scope: livetrade.execute · Risk: medium
  → approve a3f2  |  deny a3f2
```

Only CRITICAL risk actions (live execution with real money) get a modal overlay via `ui.modal()`.

### 7. Agent progress is inline

When Gordon is working, the task tree shows inline:
```
GORDON · Scanner
  ● Scanning top movers...
    ├─ Market data ✓
    ├─ Volume filter ✓
    └─ Setup detection...
```

Uses Rezi's `ui.spinner()` for active items, `ui.badge()` for status.

### 8. No lens/tab/panel switching

The old 1-5 lens model is gone. Instead:
- `/positions` shows your positions inline as a table
- `/strategies` shows strategy leaderboard inline
- `/plan BTC` shows a trade ticket inline
- The user scrolls up to see previous context

This is how Claude Code works. No mode switching. Just conversation.

### 9. Context bar (optional, toggleable)

For traders who want persistent position visibility, a SMALL context bar can appear at the TOP (below status line) showing:
- Open positions count + total P&L
- Pending approvals count
- Active strategy count

Toggle with Ctrl+I. Default: hidden. When shown, it's ONE line, not a panel.

```
POS: 3 (+$142.50)  ORD: 1  APPROVAL: 2 pending  STRAT: 1 running
```

### 10. Boot sequence

On startup:
1. Clear screen
2. General Liquidity ASCII logo (from ascii-art.txt) — centered in a box, bone-colored
3. Logo particles disperse with liquid motion (~1.5s)
4. System checks flash (Runtime ✓, Config ✓, Session ✓, Plugins ✓)
5. Transition to conversation with welcome message

## Rezi Widget Usage

| Widget | Use |
|--------|-----|
| `ui.column` | Main conversation flow (vertical scroll) |
| `ui.text` | All text rendering (messages, labels, inline content) |
| `ui.table` | Inline tables (scans, positions, strategies, tickets) |
| `ui.sparkline` | Inline price charts in messages |
| `ui.canvas` | OHLC charts, volume profiles |
| `ui.input` | Command bar (pinned bottom) |
| `ui.badge` | Role labels (YOU, GORDON, APPROVAL, SYSTEM) |
| `ui.status` | Status indicators (Ready, Streaming, Armed) |
| `ui.spinner` | Active agent/tool progress |
| `ui.callout` | Important warnings, risk alerts |
| `ui.modal` | CRITICAL risk approvals only |
| `ui.commandPalette` | Ctrl+P command search |
| `ui.statusBar` | Top status line |
| `ui.card` | Welcome message, onboarding |
| `ui.divider` | Approval request separators |
| `ui.progress` | Backtest/scan progress |
| `ui.gauge` | Risk meters, portfolio health |
| `ui.heatmap` | Correlation matrices (inline) |
| `ui.tag` | Quick action hints |

## Color Palette

| Color | Use |
|-------|-----|
| `rgb(232, 228, 217)` bone | Primary text |
| `rgb(138, 134, 120)` dim | Secondary text, labels |
| `rgb(74, 72, 64)` ghost | Placeholder, disabled |
| `rgb(201, 168, 76)` brass | Gordon's voice, brand, emphasis |
| `rgb(76, 175, 80)` green | Positive change, safe mode, success |
| `rgb(239, 83, 80)` red | Negative change, armed mode, danger |
| `rgb(255, 179, 0)` amber | Warnings, pending approvals |
| `rgb(144, 202, 249)` ice | System messages, links, info |
| `rgb(120, 144, 156)` steel | Borders, separators |

## Permission Model (replaces ARMED/DISARMED)

Inspired by Claude Code's permission system and Pear VC's "plan-then-execute" paradigm: **every action is individually gated based on scope and risk, not a global mode toggle.**

> "Make a plan, pressure-test it together, then execute." — Pear VC

### Why not ARMED/DISARMED
- Binary toggle: user forgets they're ARMED, everything executes
- All-or-nothing: can't allow scans but block orders
- No per-action accountability
- Arbitrary 1-hour expiry

### The new model
Like Claude Code's ask/auto/plan modes, but for trading:

| Permission Scope | Default | User can set to |
|---|---|---|
| `market.read` (scans, quotes, charts) | Auto-approve | — |
| `analysis.run` (TA, indicators, regime) | Auto-approve | — |
| `portfolio.read` (positions, balances) | Auto-approve | — |
| `papertrade.execute` (paper orders) | Ask | Always allow |
| `livetrade.execute` (real orders) | Ask | Always allow (per-tool) |
| `transfer.execute` (fund movement) | Always ask | — |
| `wallet.write` (key management) | Always ask | — |

### Risk-based escalation within "Ask" mode

| Risk Class | Behavior |
|---|---|
| Low | Inline approval: "Allow / Deny" |
| Medium | Inline approval with plan preview: "Always allow / This time / Deny" |
| High | Bordered approval with full ticket: plan, risk metrics, estimated cost |
| Critical | Bordered approval + 3-second countdown before confirm is active |

### The flow (matches Claude Code exactly)
```
YOU: buy 100 AAPL at market

GORDON · Planner
  ┌──────────────────────────────────┐
  │ BUY  AAPL  100 shares  MARKET   │
  │ Est. cost: ~$21,450              │
  │ Risk: 2.1% of portfolio          │
  │ Venue: Alpaca (live)             │
  └──────────────────────────────────┘

  ▸ Always allow stock orders
    Allow this time
    Deny
```

### Policy enforcement (from Pear VC)
- Position size limits enforced BEFORE approval dialog appears
- Cash reserve % enforced by system, not agent judgment
- Concurrent trade limits enforced at PermissionEngine level
- All decisions logged to audit trail (already built)

### StatusLine shows permission mode, not ARMED/SAFE
```
GORDON  ask  thread-abc  Scanner  1.2K tokens  $0.04
```

Permission mode values: `auto` (everything allowed), `ask` (default, per-action approval), `strict` (always ask, no "always allow" option).

## Build Order

### Phase 1: Shell renders and accepts input
1. `<App>` — Ink render root with `<Box flexDirection="column">`
2. `<StatusLine>` — single line at top: GORDON, SAFE/ARMED, thread
3. Conversation area — `<Box flexGrow={1}>` with welcome message
4. `<TextInput>` from ink-ui — pinned to bottom, slash command detection
5. Keybindings — Ctrl+C exit guard, Ctrl+P placeholder, basic nav

### Phase 2: Conversation flows
6. `<MessageBubble>` — role-based styling (YOU/GORDON/SYSTEM/APPROVAL)
7. `<Static>` for completed messages — past messages don't re-render
8. Backend bridge — wire SessionRuntime.streamMessage(), slash command dispatch
9. `<StreamingText>` — word-by-word streaming with cursor indicator
10. `<WorkerBadge>` — colored agent labels inline

### Phase 3: Agent progress and approvals
11. `<AgentProgress>` — task tree with box-drawing chars (├─ ✓/●/✗)
12. `<ApprovalDialog>` — inline approval with Select (Always/Once/Deny)
13. `<Byline>` — metadata separator: "Scanner · 1.2K tokens · 3.2s"
14. `<Divider>` — section separators for approvals

### Phase 4: Inline data (ticker-grade)
15. `<DataTable>` — Box+Text table: right-aligned numbers, color cells, compact headers
16. `<TickerRow>` — single-row market quote for use inside DataTable
17. Wire scan/positions/strategies/orders to render as inline DataTables
18. `<InlineChart>` — Unicode block sparkline (▁▂▃▅▇)

### Phase 5: Polish
19. `<CollapsibleOutput>` — truncate large outputs, Ctrl+E to expand
20. `<CommandPalette>` — fuzzy search overlay (Ctrl+P)
21. `<SetupWizard>` — onboarding flow
22. Boot sequence — ASCII logo → system checks → welcome
23. Double-press exit guard, armed mode banner, session resume
24. `<Ratchet>` — layout stability for live-updating content

## What v1 Includes

- Conversation with streaming
- Input with slash commands + natural language
- Status line
- Inline tables for all data
- Inline approvals
- Agent progress inline
- Command palette
- Session resume

## Patterns Borrowed from Claude Code

### Conversation Rendering
- **Virtual scrolling** with dynamic height caching for long sessions
- **Message type discrimination** — user, assistant, system, tool, approval, handoff each styled differently
- **Streaming text** — word-by-word appearance with cursor
- **Collapsible output** — large tables/results truncate by default, Ctrl+E expands
- **Compact/verbose toggle** — Ctrl+O toggles full transcript vs summary view
- **"N new messages" pill** — when scrolled up, shows count of unseen messages

### Agent Progress
- **Shimmer animation** — text shimmers while agent is routing/classifying
- **Worker badges** — colored labels per agent (Scanner=cyan, Analyst=blue, Planner=brass, Executor=green, Monitor=steel)
- **Task tree with box-drawing chars** — ├─ ✓ Done, └─ ● Running...
- **Agent handoff visualization** — Scanner → Analyst → Planner shown as chain

### Permission/Approval Dialogs
- **Radio select for approvals** — "Always allow / This time / Deny" (not just text)
- **Inline diff for plan changes** — before/after when modifying trade parameters
- **Permission rule explanation** — shows WHY this needs approval
- **Shimmer while classifier checks** — "Attempting to auto-approve..." with animation
- **Auto-approve safe patterns** — routine scans/analysis skip approval dialog

### Input System
- **History search** — Ctrl+R for fuzzy search past commands
- **Queued commands** — stashed commands shown above input (max 3 visible)
- **Dynamic placeholder** — changes based on context:
  - Streaming: "Gordon is thinking..."
  - Approval pending: "2 approvals pending — approve or deny"
  - Armed mode: "ARMED — orders will execute"
  - Default: "Type a message or / for commands"
- **Paste detection** — large pastes get shimmer feedback
- **Input truncation** — auto-truncate at token limits with warning

### Status Line
- **Token/cost tracking** — real-time: "1.2K tokens · $0.04 · 12s"
- **Context collapse warning** — "95% context — auto-compacting..."
- **Rate limit display** — utilization percentage
- **Active worker indicator** — which agent is currently working

### Safety Patterns
- **Double-press exit guard** — "Press Ctrl+C again to exit" when positions are open
- **Armed mode banner** — persistent warning in input area when ARMED
- **Position warning on exit** — "System is ARMED. Open positions will continue on the exchange."

### Tool Output
- **Inline rendering** — tool results appear inside the conversation, not separate panels
- **Truncation with expansion** — first N lines visible, "Show more" to expand
- **Error with fix suggestion** — "Exchange API key invalid. Run /configure exchange"
- **Tool progress inline** — spinner + tool name + args while executing

## Inline Data Visualization (ticker-grade)

All tabular/chart data renders INSIDE conversation messages using Rezi widgets:

### Tables (ui.table with custom renderers)
- Right-aligned numeric columns
- Color-coded cells (green/red for change/P&L)
- Compact headers (SYM, LAST, CHG%, VOL — not "Symbol", "Current Price")
- Summary rows at bottom (total P&L, total value)
- Sortable when focused
- Virtual scrolling for large datasets (50+ rows)

### Charts (ui.sparkline, ui.canvas)
- Sparklines inline in messages (price history)
- Mini charts in table cells
- Equity curves for backtest results
- Volume profiles via canvas

### Indicators (ui.badge, ui.status, ui.gauge)
- Risk badges: LOW (green), MEDIUM (amber), HIGH (red), CRITICAL (red bold)
- Status dots: ● Ready, ● Streaming, ● Armed
- Progress bars for scans/backtests
- Gauges for portfolio health

## What v1 Includes

- Ink-based conversation shell (renders, scrolls, streams)
- `<TextInput>` command bar pinned to bottom
- `<StatusLine>` with mode, agent, thread, tokens
- `<MessageBubble>` with role-based styling (YOU/GORDON/SYSTEM/APPROVAL/TOOL/HANDOFF)
- `<StreamingText>` with word-by-word appearance
- `<WorkerBadge>` with per-agent colors
- `<AgentProgress>` task tree inline
- `<ApprovalDialog>` with radio select (Always/Once/Deny)
- `<DataTable>` — ticker-grade inline tables for scans, positions, strategies, orders
- `<InlineChart>` — Unicode block sparklines
- Slash command dispatch to all 160+ commands
- Natural language routing to SessionRuntime.streamMessage()
- Dynamic placeholder (streaming/approval/armed context)
- Double-press Ctrl+C exit guard with position warning
- Session resume with transcript restoration
- `<Byline>`, `<Divider>`, `<Ratchet>` for visual polish
- `<CollapsibleOutput>` for large results
- `<CommandPalette>` (Ctrl+P)

## What v1 Defers

- Boot animation (logo rotation, particles) — nice to have
- Context bar toggle (persistent P&L strip) — add when user requests
- Custom themes (dark/light switch) — dark only for v1
- Vim keybindings — add later
- Export/sharing — add later
- Heatmaps, canvas OHLC charts — add after DataTable + InlineChart work
- SetupWizard — onboarding can use existing CLI flow for v1

## Deep Patterns from Claude Code Source (claurst spec + 4537-file repo)

### Rendering Architecture
- **Double-buffered screen** — front/back frame swap after diff. Prevents flicker on complex updates.
- **Patch optimizer** — merges/deduplicates ANSI patches before writing to terminal. Critical for high-frequency trading data.
- **Frame-based animation clock** — shared 50ms tick across ALL animated components (not per-component timers). Prevents animation drift.
- **Style interning pools** — session-lived pools for ANSI styles, characters, hyperlinks. Prevents allocation in hot render path.
- **Console patching** — intercepts `console.log/warn/error` to separate file descriptor so they don't corrupt the TUI output.

### Layout Components
- **Ratchet** — prevents layout bounce by maintaining minimum height equal to max seen height. Critical for live-updating tables that change row count (positions filling/closing).
- **Pane** — screen region container that's modal-aware (skips divider when inside modal, uses different padding).
- **ScrollBox with chrome context** — decoupled scroll state management. Scroll position, unseen divider, sticky prompt all managed via ref-based context (no re-renders on scroll).
- **Byline** — metadata separator joining children with middot (` · `). Auto-filters null/undefined. Use for: "Scanner · 1.2K tokens · 3.2s".

### Message System
- **29 null-rendered attachment types** — system context, token usage, mode transitions silently filtered from display. Gordon equivalent: system context injections, tool routing metadata, permission scope declarations.
- **Collapsed groups** — "Scanned 50 symbols, found 8 setups" as a collapsible one-liner with 700ms minimum display delay.
- **Compact boundary marker** — "✻ Conversation compacted (ctrl+o for history)" when session exceeds token limits.
- **Rate limit with countdown** — API errors hidden for first 3 retries, then show "retry X/Y" with countdown timer.
- **Task assignment boxes** — cyan-bordered box showing agent delegation: "Scanner assigned to: scan top movers by volume".
- **Shutdown messages** — warning-bordered box for strategy stops: "Strategy paused: drawdown exceeded 5%".

### Worker/Agent Display
- **Worker-colored bullets** — each agent gets a persistent color:
  - Gordon (orchestrator): brass
  - Scanner: cyan
  - Analyst: blue
  - Planner: brass-dim
  - Executor: green
  - Monitor: steel
  - Teacher: ice
  - Backtester: amber
  - Critic: red-dim
  - Auditor: ghost
- **Agent progress tree** — `├─` / `└─` with status (✓/✗/●/○), tool count, token count, duration.
- **Teammate spinner tree** — multi-level agent status when strategies run in parallel.

### Animation System
- **Shimmer animation** — 20fps character-by-character shimmer sweep. Used during: agent routing, classifier checking, auto-approval.
- **Stall detection** — red intensity ramps after 3s inactivity. Shows "connection may be slow" when exchange API is unresponsive.
- **Glimmer message** — streaming text preview with shimmer effect. For Gordon: streaming analysis results character-by-character.
- **Flashing char** — cursor/loading indicator that blinks on/off.
- **Token counter animation** — appears after 30 seconds with smooth interpolation. Shows real-time token consumption.

### Permission System (detailed)
- **Permission dialog container** — title bar (colored), subtitle, children content, optional sticky footer.
- **Classifier auto-approval** — shimmer animation "Attempting to auto-approve..." while classifier runs. Safe patterns (scans, reads) auto-approve with green checkmark.
- **Radio select with 3 options** — "Always allow this tool" / "Allow this time" / "Deny". Not binary yes/no.
- **Permission rule explanation** — inline text showing WHY: "This tool accesses livetrade.execute scope. Your current mode is ARMED."
- **Sticky footer for plan review** — plan content stays visible at bottom while user scrolls through plan details above.
- **Worker badge in permissions** — colored `● @Scanner` showing which agent requested the action.

### Input System (detailed)
- **FuzzyPicker with atuin-style direction** — items[0] at bottom, search upward through history. For command history: most recent at bottom.
- **Typeahead system (212KB component)** — debounced async filtering, keyboard navigation, multi-select, match highlighting. For symbol search, strategy picker.
- **Multi-line input** — Shift+Enter for multi-line. For complex trade descriptions.
- **Input state tracking** — cursor position, selection, undo/redo stack, clipboard integration.
- **Queued command display** — max 3 tasks visible above input, "+N more" for overflow. Filters idle notifications.

### Session Management
- **Session browser** — list previous sessions with preview (duration, message count, last activity).
- **Session restoration** — restores transcript, scroll position, focus state on resume.
- **Thread switching** — load a previous thread mid-session.
- **Compact summary on resume** — shows "Resumed session from 2h ago. 45 messages. Last: analyzed BTC."

### Wizard Pattern
- **Multi-step state machine** — `currentStepIndex`, `totalSteps`, `wizardData`, navigation history stack for back.
- **Step counter in title** — "Setup Exchange (2/7)".
- **Navigation footer** — "← Back | Next → | Ctrl+C to cancel".
- **Data accumulation** — partial data collected across steps, validated on submit.
- For Gordon: exchange setup, broker setup, strategy configuration, wallet setup.

### Error Handling (detailed)
- **Priority routing for errors** — interrupt → plan rejection → classifier denial → custom reject → tool-specific → fallback.
- **Max 10 lines for tool errors** — "+N lines (ctrl+o to see all)" when truncated.
- **Sandbox violation stripping** — removes XML tags from error messages.
- **API error countdown** — timer counting down to next retry attempt.
- **Error with fix field** — every error includes plain-language fix suggestion.

### Performance Patterns
- **Ref-heavy state** — `useRef` extensively to prevent re-renders on frequent updates. Critical for live price ticks.
- **Decoupled contexts** — AppState, Notifications, Stats, Overlay, Modal all separate. No monolithic store.
- **Virtual scrolling** — 5000+ messages without lag. Height caching per item, invalidated on width change.
- **Memoized message rendering** — `areMessagePropsEqual` skips expensive re-renders for unchanged messages.
- **Style/char/hyperlink interning** — zero allocation in render hot path.

### Keyboard System
- **Global keybindings** — accessible from any screen. Conflict resolution built in.
- **Context-specific bindings** — different keys in Confirmation, Settings, Chat, Application contexts.
- **Chord support** — multi-key combos (Ctrl+K then X). Shows "Ctrl+K..." while waiting for next key.
- **Configurable shortcuts** — user can rebind keys via config file.
- **Vim mode** — full Vi command support when enabled. INSERT/NORMAL/VISUAL modes.

### Notification System
- **Toast notifications** — auto-dismiss after configurable timeout (default 5s).
- **Multiple stacking** — notifications stack on screen.
- **Action buttons** — notifications can have clickable actions.
- **Type system** — info/warning/error/success with corresponding colors.
- For Gordon: order fills, stop triggers, price alerts, strategy status changes.

### OSC 8 Hyperlinks
- **Clickable links** — file paths, URLs, transaction IDs rendered as terminal hyperlinks.
- For Gordon: exchange URLs, block explorer links, order IDs.

### CLI Trader Alignment
- **"Decision throughput under cognitive load"** — the conversation reduces cognitive load vs dashboard monitoring.
- **"One interface, one conversation"** — all exchanges, brokers, chains through one chat.
- **"Workflows become engineering problems"** — Gordon's 160+ commands, playbooks, and approval gates ARE the encoded trading process.
- **"Value in encoded expertise"** — strategies, backtests, learning loops are the durable edge. The TUI surfaces them conversationally.
- **Process discipline** — every trade follows: Research → Analyze → Plan → Review → Execute → Monitor. Gordon guides this naturally through conversation.

## Component Inventory

### From Ink Core
| Component/Hook | Use |
|--------|-----|
| `<Box>` | All layout (flexbox: row, column, padding, margin, borders, gap, overflow) |
| `<Text>` | All text (bold, dim, color, wrap, truncate) |
| `<Static>` | Completed messages that don't re-render (conversation history above fold) |
| `<Spacer>` | Flexible spacing |
| `<Transform>` | Output transformation |
| `useInput()` | Keyboard handling (chars, arrows, ctrl combos) |
| `useFocus()` / `useFocusManager()` | Focus management across components |
| `useApp()` | App lifecycle (exit) |
| `useStdin()` / `useStdout()` | Raw stream access |
| `useWindowSize()` | Terminal dimensions (responsive layout) |
| `useCursor()` | Cursor visibility |

### From ink-ui
| Component | Use |
|--------|-----|
| `<TextInput>` | Command bar (pinned bottom) |
| `<Select>` | Exchange picker, strategy picker, approval options |
| `<MultiSelect>` | Watchlist symbols, bulk operations |
| `<ConfirmInput>` | Quick Y/n confirmations |
| `<Spinner>` | Agent/tool progress indicator |
| `<ProgressBar>` | Scan/backtest progress |
| `<Badge>` | Role labels (YOU, GORDON, APPROVAL), risk levels, status |
| `<StatusMessage>` | Success/error/warning messages with icons |
| `<Alert>` | Risk alerts, important warnings |
| `<OrderedList>` / `<UnorderedList>` | Help text, strategy lists |

### Custom Components (built on Box + Text)
| Component | What it does | Reference |
|--------|-----|-----|
| `<DataTable>` | Ticker-grade table: right-aligned numbers, color-coded cells, compact headers (SYM, LAST, CHG%), summary rows, sortable | Claude Code's table patterns + ticker visual vocabulary |
| `<InlineChart>` | Sparkline using Unicode blocks (▁▂▃▅▇), color-coded trend direction | Block character rendering |
| `<AgentProgress>` | Task tree: ├─ ✓ Done, └─ ● Running, worker-colored bullets, token/time byline | Claude Code's AgentProgressLine |
| `<ApprovalDialog>` | Bordered dialog with radio select (Always/Once/Deny), rule explanation, sticky footer | Claude Code's PermissionDialog + BashPermissionRequest |
| `<CommandPalette>` | Fuzzy search overlay: debounced filter, keyboard nav, match highlighting, categories | Claude Code's FuzzyPicker (41KB reference) |
| `<MessageBubble>` | Role-prefixed message: badge + timestamp + content. Handles user/gordon/system/approval/tool/handoff variants | Claude Code's message type dispatch |
| `<StreamingText>` | Character-by-character text appearance with shimmer animation | Claude Code's GlimmerMessage + ShimmerChar |
| `<WorkerBadge>` | Colored bullet + agent name: ● Scanner, ● Analyst, ● Planner | Claude Code's WorkerBadge |
| `<StatusLine>` | Single-line top bar: mode, agent, thread, tokens, cost. Ref-based updates (no re-render) | Claude Code's StatusLine |
| `<Divider>` | Horizontal rule with optional title, Unicode ─ character | Claude Code's Divider |
| `<Byline>` | Metadata joined with middot: "Scanner · 1.2K tokens · 3.2s" | Claude Code's Byline |
| `<CollapsibleOutput>` | Truncated output with "Ctrl+E to expand" hint, full expansion on keypress | Claude Code's expansion pattern |
| `<Ratchet>` | Wrapper that prevents layout bounce by maintaining minimum height | Claude Code's Ratchet |
| `<SetupWizard>` | Multi-step flow: step counter, nav footer, data accumulation | Claude Code's WizardProvider |
| `<TickerRow>` | Compact single-row market quote: SYM LAST CHG% VOL — used inside DataTable | ticker visual vocabulary |

### Component Architecture Pattern
```
<App>                                    ← Ink render root
  <Box flexDirection="column" height="100%">
    <StatusLine />                       ← 1 line, ref-based updates
    <Box flexGrow={1} overflow="hidden"> ← Scrollable conversation area
      <Static items={completedMessages}> ← Past messages (don't re-render)
        {msg => <MessageBubble />}
      </Static>
      <Box flexDirection="column">       ← Active messages (re-render on stream)
        <MessageBubble />                ← Current streaming message
        <AgentProgress />                ← Task tree (if streaming)
        <ApprovalDialog />               ← Inline approval (if pending)
      </Box>
    </Box>
    <Box borderStyle="single" borderColor="gray"> ← Input area
      <TextInput />                      ← Pinned to bottom
    </Box>
  </Box>
</App>
```

## Patterns from fintool (Rust CLI Trading Toolkit)

### Data Formatting
- **`fmt_num()` trailing zero strip** — format to 8 decimals, strip trailing zeros. Better than fixed `.toFixed(2)` for crypto where BTC needs 2 decimals but small tokens need 6+. Gordon's `<DataTable>` should use adaptive precision.
- **`color_pnl()` / `color_change()`** — green for positive, red for negative, "+" prefix for gains. Standard, but fintool does it cleanly.
- **`time_ago()` relative timestamps** — "2d ago", "3h ago", "45m ago". Use in message bylines instead of absolute timestamps.

### Orderbook Display
- **Side-by-side bid/ask** — bids (green) on left, asks (red) on right, fixed-width columns (14 chars). Spread + mid-price in footer. Gordon's inline orderbook should follow this exact layout.

### Quote Enrichment
- **LLM-enriched quotes** — structured analysis: trend (bullish/bearish/neutral), strength (strong/moderate/weak), momentum summary (1-2 sentences), volume note (1 sentence), confidence rating. Gordon already does this via the Analyst agent, but should output in this structured format for inline display.

### Position Display
- **Position columns** — SYM, SIDE, SIZE, ENTRY, MARK, PNL, LEVERAGE. The MARK column (current price) and LEVERAGE column are missing from our current spec — add them.

### Backtest Forward P&L
- **Offset projections** — show P&L at +1d, +2d, +4d, +7d. Gordon's backtest output should include this table.

## Patterns from claude-code-meta Repos

### Architecture (from full repo docs)
- **Pipeline model:** User Input → CLI Parser → Query Engine → LLM API → Tool Execution Loop → Terminal UI
- **Parallel prefetch on startup** — MDM settings, Keychain, API preconnect fire BEFORE heavy module imports. Gordon should parallel-prefetch config + exchange status + session state.
- **Three command types:** PromptCommand (sends to LLM), LocalCommand (returns text), LocalJSXCommand (returns React JSX). Gordon's slash commands should follow this taxonomy.

### Sourcemap Repo (earlier Claude Code version)
- **`AsciiLogo.tsx`** — dedicated component for ASCII art logo display. Gordon needs this for the General Liquidity logo.
- **`CostThresholdDialog.tsx`** — alerts when API cost exceeds threshold. Relevant for Gordon's session cost tracking.
- **`LogSelector.tsx`** / `LogList.tsx` — log browsing UI. Relevant for Gordon's audit trail display.

### Nano Claude Code (900-line Python reimpl)
- **Slash command parity** — `/help`, `/clear`, `/model`, `/config`, `/save`, `/load`, `/history`, `/context`, `/cost`, `/verbose`, `/thinking`, `/permissions`, `/cwd`, `/exit`. Gordon should support ALL of these equivalents.
- **Session save/load** — explicit save/load to file. Gordon already has session persistence but should support explicit `/save` and `/load` commands.
- **Context window usage display** — `/context` shows token usage vs window. Gordon needs this in the status line.
- **Rich markdown rendering** — uses Python `rich` library for markdown panels, syntax highlighting. Gordon's `<MessageBubble>` should render markdown in responses.

### Skill.md / agent.md (from full repo)
- **Claude Code is ~1,900 files, 512,000+ lines of TypeScript** — confirms the scale of reference architecture we're working from.
- **Tech stack confirmed:** TypeScript strict + Bun + React + Ink + Commander.js + Zod v4 + GrowthBook + MCP. Gordon uses the same stack minus Commander.js (uses custom CLI parser) and GrowthBook.
- **Agent operating guide:** "Keep changes small, targeted, easy to review. Preserve existing command behavior. Favor existing patterns." Good discipline for Gordon's development too.

### Subsystems Reference
- **Bridge (IDE integration)** — bidirectional channel between CLI and IDE. Gordon could expose a bridge for web/mobile frontends in the future.
- **Coordinator (multi-agent)** — orchestrates multiple workers. Directly maps to Gordon's Scanner→Analyst→Planner→Executor chain.
- **Task system** — background task management. Maps to Gordon's autonomous trading loops.
- **Memory system** — persistent context across sessions. Maps to Gordon's session persistence + strategy learning.

## Category Mistakes to Avoid

- Building a dashboard (Gordon is a conversation, not a control panel)
- Adding sidebars (information goes in the conversation)
- Adding tabs (there's only one view: the chat)
- Making tables permanent fixtures (they appear inline and scroll away)
- Modal-first approvals (routine approvals are inline)
- Hiding the input (it's always visible)
- Orange borders everywhere (use Gordon palette, not Rezi defaults)
- Per-component animation timers (use shared frame clock)
- Monolithic state store (use decoupled contexts)
- Re-rendering unchanged messages (memoize with equality check)
- Full-tree re-render on scroll (ref-based scroll state)
- Blocking the render loop with async I/O (all I/O off main thread)
