# Gordon TUI v3 — End-to-End Architecture Mapping

## Purpose

This document maps Claude Code's complete architecture (19 layers, from binary entry to pixel on screen) to Gordon's architecture, identifying exactly what exists, what's connected, what's missing, and what the TUI must do at each layer.

## The Two Architectures Side-by-Side

### Layer 0: Binary Entry

| Claude Code | Gordon | Status |
|---|---|---|
| `cli.tsx` — fast-path dispatch, feature flags, daemon workers | `entry.ts` → `index.tsx` — flag parsing, pre-TUI commands | ✓ Connected |

### Layer 1: Bootstrap

| Claude Code | Gordon | Status |
|---|---|---|
| `main.tsx` — parallel prefetch (keychain, MDM, MCP), model selection, tool registration | `index.tsx` — sequential: flags → runtime check → license → telemetry → TUI | ✓ Connected but simpler |
| 300-400ms to interactive REPL | Unknown startup time | Needs measurement |

**Gap:** Gordon doesn't parallel-prefetch. Config, exchange status, and session restore should happen concurrently during boot animation.

### Layer 2: React Root & Providers

| Claude Code | Gordon | Status |
|---|---|---|
| `App.tsx` → FpsMetricsProvider → StatsProvider → AppStateProvider → REPL | `tui/index.tsx` → `<App />` (no providers) | ⚠ Missing providers |

**Gap:** Gordon has no provider tree. AppState is `useState` in App.tsx. Should have:
- **StatsProvider** — token count, cost, API duration (maps to trading P&L, commission tracking)
- **NotificationsProvider** — toast notifications for fills, alerts, stops
- **PermissionProvider** — approval state (maps to trading permission engine)

### Layer 3: Main Screen Layout

| Claude Code Component | Gordon Equivalent | Status |
|---|---|---|
| `REPL.tsx` — Messages + PromptInput + Footer + Modals | `App.tsx` — Messages + TextInput + StatusLine | ⚠ Partial |
| `LogoV2` — small mascot + welcome + activity feed | `BootScreen.tsx` — full-screen animation | ✗ Wrong model |
| `VirtualMessageList` — 5000+ messages, virtual scroll | Plain `.map()` on messages array | ✗ Will break at scale |
| `PromptInput` with modes, typeahead, history, vim | `TextInput` from ink-ui | ✗ Basic |
| Footer: model, mode, cost, help hint | `StatusLine` at top | ⚠ Different position |

**What Claude Code's REPL actually renders:**
```
LogoHeader (tiny, stays forever as first item)
Messages (virtual scroll)
  ├─ Each message: role prefix + content + metadata
  ├─ Tool results inline
  ├─ Thinking blocks (collapsible)
  └─ Permission dialogs (inline, not modal)
PromptInput
  ├─ Mode indicator (❯ for normal)
  ├─ Text input
  └─ Footer: model · mode · cost · "? for help"
```

**What Gordon should render (trading adaptation):**
```
GordonHeader (tiny, stays as first item)
  ├─ Logo mark (2-3 chars) + "Welcome to Gordon"
  ├─ Session info + mode
  └─ Recent activity or setup prompt
Messages (virtual scroll needed for long sessions)
  ├─ User messages: "YOU" prefix
  ├─ Gordon messages: "GORDON · Agent" prefix + content
  ├─ Tool results: inline tables, charts
  ├─ Agent progress: task tree
  └─ Approvals: inline radio select
PromptInput
  ├─ "❯" prompt character
  ├─ Text input (with slash command detection)
  └─ Footer: mode · session · tokens · "Ctrl+P commands · ? help"
```

### Layer 4: Message Types

| Claude Code Message | Gordon Equivalent | Rendered How |
|---|---|---|
| UserMessage | User input | "YOU" bold white + content |
| AssistantMessage | Gordon response | "GORDON · Agent" bold cyan + markdown content |
| ToolUseMessage | Tool invocation | "TOOL" dim + tool name + args |
| ToolResultMessage | Tool result | Inline DataTable, chart, or text |
| ThinkingMessage | Agent reasoning | Collapsible dim text |
| ProgressMessage | Streaming progress | AgentProgress tree |
| CompactBoundaryMessage | Session compact | "✻ Conversation compacted" marker |
| SystemLocalCommandMessage | System output | "SYSTEM" cyan + message |
| **N/A** | **ApprovalMessage** | APPROVAL [id] + radio select (trading-specific) |
| **N/A** | **FillMessage** | ✓ Order filled: BTC 0.1 @ 67,432 (trading-specific) |
| **N/A** | **AlertMessage** | ⚠ Stop approaching: BTC -2.1% from stop (trading-specific) |

### Layer 5: Input Pipeline

| Claude Code | Gordon | Status |
|---|---|---|
| `PromptInput.tsx` — modes (normal/vim/search/focus), typeahead, paste, history | `TextInput` from ink-ui — basic text only | ✗ Basic |
| Slash command autocomplete in input | CommandPalette overlay (Ctrl+P) | ⚠ Different UX |
| `?` shows help inline | Not implemented | ✗ Missing |
| `!` enters bash mode | Not applicable for trading | N/A |
| `@` references files | Could reference symbols: `@BTC`, `@ETH` | ✗ Not built |

**What Gordon's input should support:**
1. Plain text → natural language to agent
2. `/command` → slash command dispatch
3. `approve X` / `deny X` → approval shorthand
4. `@SYMBOL` → symbol reference (future)
5. Arrow up/down → history
6. Ctrl+P → command palette
7. Ctrl+C → double-press exit guard
8. `?` → inline help hint

### Layer 6: Query Execution

| Claude Code | Gordon | Status |
|---|---|---|
| `QueryEngine.ts` → build request → stream API → tool loop | `SessionRuntime.streamMessage()` → `QueryRuntime` → orchestrator | ✓ Connected |
| Single model (Claude) | Multi-model via Mastra (OpenAI, Anthropic, Google) | ✓ Different but works |
| Tool-call loop: execute → feed result → continue | Same pattern via orchestrator stream events | ✓ Connected |

### Layer 7: Tool Execution

| Claude Code Tool | Gordon Equivalent | Category |
|---|---|---|
| BashTool | N/A (no shell execution) | — |
| ReadFileTool | N/A (no file system) | — |
| EditFileTool | N/A (no code editing) | — |
| WebFetchTool | market data fetching | market |
| WebSearchTool | N/A | — |
| AgentTool (subagent) | Agent handoff (Scanner→Analyst→Planner) | core |
| McpTool (MCP) | MCP plugin tools | plugin |
| **N/A** | scan_movers, get_chart_data | market |
| **N/A** | analyze_technicals, check_regime | analysis |
| **N/A** | create_plan, preview_order | planning |
| **N/A** | place_order, execute_plan | execution |
| **N/A** | monitor_position, check_exit | monitoring |
| **N/A** | backtest_strategy, optimize | research |

### Layer 8: Permission System

| Claude Code | Gordon | Status |
|---|---|---|
| `canUseTool()` per tool | `PermissionEngine.evaluate()` per tool | ✓ Connected |
| Auto/Manual/Danger modes | auto/ask/strict modes | ✓ Mapped |
| Permission dialog (inline in conversation) | ApprovalDialog (inline in conversation) | ✓ Built |
| "Always allow X" persistence | `approvePendingRequest({ persist: true })` | ✓ Connected |
| Dangerous command detection | Risk class evaluation (low/medium/high/critical) | ✓ Connected |

### Layer 9: Streaming

| Claude Code | Gordon | Status |
|---|---|---|
| `stream.on('contentBlockDelta')` → text delta | `event.type === "text_delta"` → streamBuffer | ✓ Connected |
| `stream.on('contentBlockStart', tool_use)` → tool start | `event.type === "tool_call_start"` → taskTree | ✓ Connected |
| `stream.on('contentBlockStop')` → tool end | `event.type === "tool_call_end"` → taskTree | ✓ Connected |
| Message (final) → usage tracking | `event.type === "done"` → finalize + tokenCount | ✓ Connected |
| Multiple overlapping streams (model + tool + tasks) | Single stream from orchestrator | ⚠ Simpler |

### Layer 10: State Management

| Claude Code | Gordon | Status |
|---|---|---|
| Global bootstrap state (module singleton) | No global state singleton | ✗ Missing |
| AppState via React Context (immutable updates) | AppState via `useState` (direct) | ⚠ Simpler |
| StatsProvider (token/cost tracking) | `tokenCount` in AppState | ⚠ Basic |
| NotificationsProvider (toast system) | Not implemented | ✗ Missing |
| FpsMetricsProvider (perf monitoring) | Not needed for v1 | — |

### Layer 11: Commands

| Claude Code | Gordon | Status |
|---|---|---|
| `commands.ts` — 50+ commands, 3 types (Prompt/Local/LocalJSX) | `slashCommands.ts` — 150+ commands, 3 types (agent/tool/menu) | ✓ Connected |
| `/commit`, `/review`, `/plan` | `/scan`, `/analyze`, `/plan`, `/positions` | ✓ Different domain |
| Help: `/help` paginated | `/help` via `formatPaginatedCommandHelp()` | ✓ Connected |
| Doctor: `/doctor` | `/doctor` via `collectDoctorReport()` | ✓ Connected |

### Layer 12: Rendering

| Claude Code | Gordon | Status |
|---|---|---|
| Custom Ink renderer (250KB fork) — double-buffered, optimized | Stock Ink 6.6 | ⚠ No optimization |
| Virtual message list (height caching, 5000+ msgs) | Plain array `.map()` | ✗ Will break at scale |
| 60fps frame cap, throttled scheduling | Default Ink rendering | ⚠ Fine for now |
| Syntax highlighting (Ansi component) | RichContent (basic markdown) | ⚠ Basic |

## What the TUI Should Look Like (Claude Code model, trading content)

### Screen 1: First Launch (matches Claude Code's LogoV2)

```
 ██  Welcome to Gordon.
 ██  General Liquidity Trading Terminal
 ██  ask mode · session-tui-abc123

> Set up your first exchange? Type /setup or just start chatting.

❯                                                    ask · Ctrl+P · ? help
```

- `██` = General Liquidity mark (2 chars, stays forever as first item)
- Welcome text = one-time, part of the conversation
- No bordered panels. No command grid. Just text.
- Input at very bottom: `❯` prompt, right-aligned hints

### Screen 2: Conversation (matches Claude Code's message stream)

```
 ██  Welcome to Gordon.
 ██  ask mode · session-abc123

YOU                                                              just now
  scan top movers

GORDON · Scanner                                                 12s ago
  Found 8 setups across 50 symbols.

  SYM      LAST       CHG%     VOL       SIGNAL
  BTC      67,432    +2.14%    1.2B      BREAKOUT
  ETH       3,821    +1.82%    890M      SUPPORT
  SOL       142.5    +4.21%    340M      MOMENTUM
  AVAX      38.20    -1.45%    120M      REVERSAL
  DOGE     0.1842    +3.10%     95M      VOLUME_SURGE

  Try: /analyze BTC or "build me a swing long on ETH"

YOU                                                              just now
  analyze BTC

GORDON · Analyst
  ├─ Market data ✓
  ├─ Indicators ✓
  └─ Pattern recognition ●

  BTC/USDT Technical Analysis
  Regime: TRENDING (bullish, 78% confidence)

  ▁▂▃▃▄▅▆▆▇█████▇▇▆▇▇████ ↑

  Key Levels:
    S1: 65,200   S2: 63,800   S3: 61,500
    R1: 69,400   R2: 71,200   R3: 73,000

  Signal: BUY — RSI 58, MACD bullish cross,
  volume above 20-day average.█

❯                                              ask · ● Analyst · Ctrl+P
```

**Key design rules (from Claude Code):**
1. No borders around messages — just text with role prefixes
2. Tables are clean aligned columns with color, no box borders
3. Charts are Unicode block chars inline
4. Agent progress is tree chars (├─ └─) inline
5. Streaming cursor (█) at end of text being generated
6. Timestamps right-aligned, dim
7. Input prompt: `❯` + text + right-aligned mode/agent/hints

### Screen 3: Approval (matches Claude Code's permission dialog)

```
─────────────────────────────────────────────────────────────────
APPROVAL [a3f2]
  Gordon wants to use `place_market_order`
  Scope: livetrade.execute · Risk: HIGH · Effect: execution

  Order: BUY 0.1 BTC @ MARKET
  Est. cost: ~$6,743 · Slippage: ~0.2%

  ▸ Allow this time
    Always allow stock orders
    Deny
─────────────────────────────────────────────────────────────────
```

**Key:** Approvals render inline in the conversation (not a modal popup). Divider lines above and below. Radio select for decision. This is exactly how Claude Code does bash permission requests.

## Color Scheme

**Following Claude Code's approach:** mostly white/default text, color only for semantic meaning.

| Element | Color | Ink prop |
|---|---|---|
| User badge "YOU" | White bold | `<Text bold>YOU</Text>` |
| Gordon badge | Cyan bold | `<Text bold color="cyanBright">GORDON</Text>` |
| Agent name | Cyan | `<Text color="cyan">Scanner</Text>` |
| System badge | Cyan dim | `<Text color="cyan" dimColor>SYSTEM</Text>` |
| Approval badge | Yellow bold | `<Text bold color="yellow">APPROVAL</Text>` |
| Timestamps | Gray dim | `<Text dimColor>12s ago</Text>` |
| Message content | Default (white) | `<Text>content</Text>` |
| Positive change/PnL | Green | `<Text color="green">+2.14%</Text>` |
| Negative change/PnL | Red | `<Text color="red">-1.45%</Text>` |
| Prompt character | Cyan | `<Text color="cyanBright">❯</Text>` |
| Dividers | Gray dim | `<Text dimColor>────</Text>` |
| Hints | Gray dim | `<Text dimColor>Ctrl+P · ? help</Text>` |
| Streaming cursor | Cyan | `<Text color="cyanBright">█</Text>` |
| Progress ✓ | Green | `<Text color="green">✓</Text>` |
| Progress ● | Cyan | `<Text color="cyanBright">●</Text>` |
| Progress ✗ | Red | `<Text color="red">✗</Text>` |
| Risk LOW | Green | `<Text color="green">LOW</Text>` |
| Risk MEDIUM | Yellow | `<Text color="yellow">MEDIUM</Text>` |
| Risk HIGH | Red bold | `<Text bold color="red">HIGH</Text>` |
| Risk CRITICAL | Red bold inverse | `<Text bold color="red" inverse> CRITICAL </Text>` |
| Mode "ask" | Cyan | `<Text color="cyan">ask</Text>` |
| Mode "auto" | Red | `<Text color="red">auto</Text>` |
| Mode "strict" | Green | `<Text color="green">strict</Text>` |

**No background colors on panels.** No bordered boxes around conversation. Color is for semantics only.

## Gaps in Current TUI (What to Fix)

| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | Boot animation shows full-screen, should be tiny header like Claude Code's LogoV2 | Wrong feel | Replace BootScreen with GordonHeader component (2-3 lines, stays in conversation) |
| 2 | StatusLine at top with bordered box | Not how Claude Code works | Move to footer-style hints on input line |
| 3 | Welcome shows command table | Claude Code shows 3-4 lines of welcome, not a grid | Simplify to welcome text + 1-2 example prompts |
| 4 | Messages have no virtual scrolling | Will break at 100+ messages | Need to implement or use Static for old messages |
| 5 | Input is basic TextInput | Claude Code has modes, history, typeahead | Add history (arrow keys), mode indicator, right-aligned hints |
| 6 | No header that stays | Claude Code's LogoV2 is always the first item | Add permanent GordonHeader as first message |
| 7 | Borders everywhere | Claude Code uses none on messages | Remove all borderStyle from conversation |
| 8 | Black background | Claude Code uses terminal default | Use terminal default, not forced background |
| 9 | Yellow as primary color | Claude Code uses white + semantic colors | Switch to cyan accent, white primary |
| 10 | No inline slash command hints | Claude Code shows suggestions as you type / | Add typeahead for slash commands |
| 11 | No `?` help shortcut | Claude Code shows help on `?` | Add inline help on `?` press |
| 12 | No session resume display | Claude Code shows "Resumed session" with context | Show resume info when loading previous session |
| 13 | Notification system missing | Claude Code has toasts for async events | Need for order fills, alerts, stop triggers |
