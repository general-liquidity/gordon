# Gordon TUI v4 — The Definitive Specification

## What Is Vibe Trading?

Vibe trading is: **you describe intent in English, an AI agent handles the technical execution, you approve or deny.** The terminal is where this conversation happens. Not a dashboard. Not a chart viewer. A conversation with an agent that has trading expertise.

From Pear VC: *"Make a plan, pressure-test it together, then execute."*
From CLI Trader: *"The bottleneck isn't execution speed — it's decision throughput under cognitive load."*

The TUI exists to reduce cognitive load. The user talks. Gordon researches, analyzes, plans, and presents. The user approves or redirects. Gordon executes. Everything happens in one conversation.

---

## Classification (cli-design-framework)

**Purpose:** AI trading agent you talk to in your terminal.
**Primary role:** Runtime — long-running conversational session.
**Primary user type:** Human trader — conversational, describes intent in English.
**Primary interaction form:** Conversational REPL with inline rich output.
**Statefulness:** Sessionful — persistent threads, resumable.
**Risk profile:** High — real money. Per-action approval gates.

**Design stance:** Gordon optimizes for decision throughput. The conversation IS the trading workflow. Every other surface (tables, charts, progress) exists to enrich the conversation, not replace it.

---

## The Complete Architecture Mapping

### Claude Code → Gordon → Vibe Trading TUI

For every Claude Code system, here is the exact Gordon equivalent and how the TUI surfaces it.

---

### 1. ENTRY & BOOTSTRAP

| Claude Code | Gordon | Vibe Trading Adaptation |
|---|---|---|
| `cli.tsx` → fast-path dispatch | `entry.ts` → `index.tsx` → flag parsing | Same pattern. `/gordon --help`, `--json`, `--version` work before TUI loads. |
| `main.tsx` → parallel prefetch (keychain, MDM, MCP, model strings) | `index.tsx` → sequential: license → telemetry → TUI | **Fix:** Parallel-prefetch config + exchange status + session restore during boot screen. |
| `init()` → OAuth, settings, analytics | License check + config load | Gordon adds: exchange connection test, broker auth verify. |

**TUI responsibility:** Show something within 100ms (cli-guidelines: `robustness-100ms-response`). Boot screen with logo + system checks satisfies this.

**Vibe trading adaptation:** System checks aren't "Runtime ✓ Config ✓" — they're:
```
✓ Binance connected (250ms)
✓ Account verified (paper mode)
✓ 5 tools loaded
✓ Session restored (12 messages)
```

---

### 2. REACT ROOT & PROVIDERS

| Claude Code | Gordon | What to Build |
|---|---|---|
| `App.tsx` → FpsMetricsProvider → StatsProvider → AppStateProvider | `App.tsx` → single `useState` | Add 2 providers: AppStateProvider + NotificationsProvider |
| 9 context providers | 2 needed for v1 | AppState (messages, streaming, approvals) + Notifications (fills, alerts, stops) |
| `onChangeAppState` callback | Not implemented | Add: persist session on state change |

**Vibe trading adaptation:** The notification provider is CRITICAL. Trading events happen asynchronously — order fills, stop triggers, price alerts. These MUST inject into the conversation without the user asking.

---

### 3. MAIN SCREEN LAYOUT

| Claude Code | Gordon | Vibe Trading |
|---|---|---|
| LogoV2 (tiny mascot, stays as first message) | BootScreen (full-screen animation) | **Change:** Small logo header (2-3 lines) that stays forever as first message. No full-screen boot. |
| VirtualMessageList (5000+ messages) | Plain `.map()` | **Change:** Use Ink's `<Static>` for completed messages. Only re-render active/streaming. |
| PromptInput (modes, typeahead, vim, paste) | `<TextInput>` from ink-ui | **Change:** Add history (arrow keys), mode indicator (`ask`/`auto`/`strict`), right-aligned hints. |
| Footer (model · mode · cost · "? for help") | StatusLine at top | **Change:** Move to right-aligned hints on the input line. No separate status bar. |

**The layout:**
```
GordonHeader (first message, permanent)
Conversation (scrollable, <Static> for old messages)
  ├─ Messages (role-prefixed, color-coded)
  ├─ Tool results (inline tables, charts)
  ├─ Agent progress (tree)
  └─ Approvals (inline with dividers)
StreamingText (active response)
PromptInput (pinned bottom)
  └─ ❯ input text                    ask · Ctrl+P · ? help
```

No borders. No panels. No boxes around conversation. Just text with semantic color.

---

### 4. MESSAGE TYPES

| Claude Code Message | Gordon Equivalent | Gordon Module | Rendered As |
|---|---|---|---|
| UserMessage | User input | `app/chatTypes.ts` → `ChatMessage` | `YOU` white bold + content |
| AssistantMessage | Gordon response | StreamEvent → `text_delta` | `GORDON · Agent` cyan bold + content |
| ToolUseMessage | Tool invocation | StreamEvent → `tool_call_start` | `TOOL` dim + name + args (collapsible) |
| ToolResultMessage | Tool result | StreamEvent → `tool_call_end` | Inline table/text via RichContent |
| ThinkingMessage | Agent reasoning | Not exposed (future) | Collapsible dim block |
| ProgressMessage | Agent progress | `app/taskTree.ts` | Tree: ├─ ✓ ● ✗ |
| PermissionRequest | Approval | `runtime/permissions/PermissionEngine` | Inline radio select with dividers |
| **N/A** | **Fill notification** | `core/executor.ts` event | `✓ Filled: BUY 0.1 BTC @ 67,432` green |
| **N/A** | **Stop trigger** | `core/monitor.ts` event | `⚠ Stop triggered: BTC -2.1%` red |
| **N/A** | **Alert** | `core/monitor.ts` event | `! Price alert: ETH above 4,000` yellow |
| **N/A** | **Strategy update** | `core/autonomous-loop.ts` | `◈ Strategy: momentum +1.2% today` cyan |
| CompactBoundaryMessage | Session compact | `runtime/transcript/CompactionManager` | `✻ Conversation compacted (45 → 12 messages)` dim |

**Vibe trading adaptation:** Trading adds 4 new message types that Claude Code doesn't have: fills, stops, alerts, and strategy updates. These are proactive — Gordon pushes them into the conversation without the user asking.

---

### 5. TOOL EXECUTION → TRADING OPERATIONS

| Claude Code Tool | Gordon Module | What It Does | TUI Display |
|---|---|---|---|
| BashTool | N/A | Shell execution | N/A (no shell) |
| ReadFileTool | `infra/storage/config.ts` | Read config | Text message |
| EditFileTool | N/A | Edit code | N/A |
| WebFetchTool | `infra/exchange/*.ts` | Market data | Inline table (scan results) |
| AgentTool (subagent) | `infra/agents/orchestrator.ts` | Agent handoff | Progress tree + WorkerBadge |
| McpTool | `infra/mcp/client.ts` | MCP plugins | Tool result message |
| **N/A** | `core/scanner.ts` | Scan markets | Table: SYM, LAST, CHG%, VOL, SIGNAL |
| **N/A** | `core/analyzer.ts` | Technical analysis | Levels table + sparkline + regime badge |
| **N/A** | `core/planner.ts` | Trade plan | Ticket: entry, stop, targets, size, risk |
| **N/A** | `core/executor.ts` | Place orders | Approval → confirmation → fill notification |
| **N/A** | `core/monitor.ts` | Track positions | Position table (live P&L) |
| **N/A** | `backtest/engine.ts` | Run backtests | Results table + equity sparkline |
| **N/A** | `strategies/registry.ts` | List strategies | Leaderboard table |
| **N/A** | `core/autonomous-loop.ts` | Auto-trade | Background notifications |
| **N/A** | `core/risk-kernel/kernel.ts` | Risk check | Pre-approval policy enforcement |

**How tool results render:**

The agent returns text. The TUI renders it with `RichContent` which detects:
- JSON arrays → `DataTable` with auto-inferred columns
- Markdown tables → aligned columns with color
- Long text → `CollapsibleOutput` (truncate + Ctrl+E)
- Price data → `InlineChart` (Unicode sparkline)

---

### 6. PERMISSION SYSTEM → TRADING APPROVALS

| Claude Code | Gordon Module | Vibe Trading |
|---|---|---|
| `canUseTool()` per tool | `PermissionEngine.evaluate()` | Per-action approval based on scope + risk |
| Auto/Manual/Bypass modes | `auto`/`ask`/`strict` modes | `ask` default — every execution action asks |
| "Always allow X" persistence | `approvePendingRequest({persist:true})` | "Always allow scan" but always ask for orders |
| Dangerous command detection | Risk class: low/medium/high/critical | Risk kernel evaluates before dialog appears |
| Permission dialog (inline) | ApprovalDialog (inline with dividers) | Radio select: Always / This time / Deny |

**Vibe trading adaptation — the Pear VC flow:**

```
YOU: buy 100 shares of AAPL

GORDON · Planner
  Building trade plan...
  ├─ Market data ✓
  ├─ Risk check ✓
  └─ Plan generated ✓

  BUY AAPL · 100 shares · MARKET
  Est. cost: ~$21,450 · Risk: 2.1% of portfolio
  Venue: Alpaca (live)

─────────────────────────────────────────────
⚠ APPROVAL [a3f2]
  Scope: livetrade.execute · Risk: HIGH

  ▸ Allow this time
    Always allow stock orders
    Deny
─────────────────────────────────────────────
```

This is "plan-then-execute." Gordon shows the plan. The user pressure-tests it (sees risk, cost, venue). Then approves or redirects.

For CRITICAL risk (large positions, margin, withdrawals): 3-second countdown before confirm button activates.

---

### 7. AGENT ORCHESTRATION → WORKER CHAIN

| Claude Code | Gordon Module | Vibe Trading |
|---|---|---|
| Single agent (Claude) | 10 specialized agents via Mastra | Scanner→Analyst→Planner→Executor→Monitor |
| AgentTool spawns subagents | `infra/agents/orchestrator.ts` handoffs | Automatic chain based on intent |
| Coordinator mode (parallel) | `core/runtime/coordinator.ts` | Parallel scans across symbols |
| Task system (background) | `core/autonomous-loop.ts` | Deployed strategies run in background |

**TUI display:**

```
GORDON · Scanner                                        3.2s
  ├─ Market data ✓
  ├─ Volume filter ✓
  └─ Setup detection ✓

GORDON · Analyst                                        5.1s
  ├─ RSI analysis ✓
  ├─ Support/resistance ✓
  └─ Pattern recognition ●
```

Worker badges: Scanner=cyan, Analyst=blue, Planner=brass, Executor=green, Monitor=gray.

---

### 8. SLASH COMMANDS → TRADING COMMANDS

| Claude Code Command | Gordon Equivalent | Workflow | Action |
|---|---|---|---|
| `/help` | `/help` | operate | Show commands |
| `/doctor` | `/doctor` | operate | System health (exchange, broker, LLM) |
| `/commit` | N/A | — | — |
| `/review` | N/A | — | — |
| `/plan` | `/plan BTC` | trade | Generate trade plan |
| `/memory` | N/A (future) | — | — |
| `/cost` | `/cost` | operate | Token + trading costs |
| `/compact` | `/compact` | operate | Compress conversation |
| `/resume` | `/resume` | operate | Resume previous session |
| N/A | `/scan` | discover | Scan top movers |
| N/A | `/analyze BTC` | analyze | Technical analysis |
| N/A | `/positions` | accounts | Open positions |
| N/A | `/orders` | accounts | Active orders |
| N/A | `/portfolio` | accounts | Holdings + P&L |
| N/A | `/backtest` | run | Run historical backtest |
| N/A | `/strategies` | run | Strategy leaderboard |
| N/A | `/deploy` | run | Deploy live strategy |
| N/A | `/exchange` | accounts | Manage exchanges |
| N/A | `/broker` | accounts | Manage brokers |

Gordon has 150+ commands across 6 workflows (discover, analyze, trade, run, accounts, operate). Claude Code has ~100+ across its domain.

**TUI dispatch:** All commands route through `parseSlashCommand()` → 3 paths:
- `action: "agent"` → `streamMessage()` with prompt from `commandToPrompt()`
- `action: "tool"` → direct handler (`handleConfigCommand()`, etc.)
- `action: "menu"` → local UI handler (`handleMenuCommand()`)

---

### 9. INPUT SYSTEM

| Claude Code | Gordon | Vibe Trading |
|---|---|---|
| PromptInput with 5 modes (normal/vim/search/focus/bash) | TextInput (basic) | Add: history (↑↓), mode indicator, right-aligned hints |
| `/` triggers slash autocomplete in-input | Ctrl+P opens CommandPalette overlay | Keep both: `/` inline + Ctrl+P overlay |
| `?` shows help | Not implemented | Add: `?` when input empty shows quick reference |
| `!` enters bash mode | Not applicable | Not applicable |
| `@` references files | Future: `@BTC` references symbols | Defer |
| Tab completion | Not implemented | Defer to v2 |

**Vibe trading input patterns:**
```
❯ scan top movers                    → natural language to agent
❯ /analyze BTC                       → slash command
❯ approve a3f2                       → approval shorthand
❯ approve a3f2 persist               → always allow this tool
❯ deny a3f2 too risky                → deny with reason
❯ ?                                  → quick help
```

---

### 10. STREAMING → LIVE DATA

| Claude Code | Gordon | Vibe Trading |
|---|---|---|
| `stream.on('contentBlockDelta')` → text delta | `event.type === "text_delta"` | Word-by-word text with blinking cursor |
| `stream.on('contentBlockStart', tool_use)` → tool start | `event.type === "tool_call_start"` | Add node to progress tree |
| Message (final) → usage tracking | `event.type === "done"` → finalize | Add message + check approvals + update token count |
| Multiple overlapping streams | Single stream from orchestrator | Future: parallel agent streams |

**Vibe trading adaptation:** Gordon adds background streams that Claude Code doesn't have:
- Position monitor emits fill/stop events → inject into conversation
- Autonomous loop emits strategy updates → inject into conversation
- These are PUSH, not PULL — the user doesn't ask for them

---

### 11. STATE MANAGEMENT

| Claude Code | Gordon | Vibe Trading |
|---|---|---|
| `AppState` via Zustand-like store with selectors | `useState` in App.tsx | Add AppStateProvider with selectors |
| `onChangeAppState` for side effects | Not implemented | Add: persist session on change |
| StatsProvider (tokens, cost, duration) | tokenCount in state | Track: tokens + trading P&L + commissions |
| NotificationsProvider (toast queue) | Not implemented | Add: priority queue for fills/alerts/stops |
| 9 context providers | 0 providers | Add 2: AppState + Notifications |

---

### 12. SESSION MANAGEMENT

| Claude Code | Gordon | Vibe Trading |
|---|---|---|
| Sessions auto-saved to disk | `runtime/persistence/RuntimePersistence.ts` | Save/restore transcript + positions + approvals |
| `/resume` loads previous | `SessionRuntime.resumeSession()` | Show "Resumed · 45 messages · last: analyzed BTC" |
| Session list | `runtime.listRecentHistory()` | `/threads` lists previous sessions |
| Cost tracking per session | tokenCount per session | Add: P&L per session, commissions, trade count |

---

### 13. HELP & DISCOVERABILITY (cli-ux-designer)

**Claude Code:** `/help` paginated, `?` inline, command suggestions in footer.

**Gordon adaptation:**

Pressing `?` when input is empty shows:
```
Quick Reference:
  /scan          Scan top movers
  /analyze BTC   Technical analysis
  /plan BTC      Create trade plan
  /positions     Open positions
  /help          Full command list
  /doctor        System health

  Or just describe what you want in English.
  "find me safe momentum setups under 2% risk"
```

This disappears when the user starts typing. It's NOT a permanent display.

---

### 14. ERROR HANDLING (cli-guidelines)

| Error Type | Gordon Module | TUI Display |
|---|---|---|
| Exchange API down | `infra/exchange/*.ts` | `✗ Binance: connection lost. Retrying... (5s)` |
| Insufficient balance | `core/executor.ts` | `✗ Order rejected: need $42,500, have $38,000` + suggested fix |
| Rate limited | `infra/exchange/*.ts` | `⚠ Rate limited. Waiting 2 min...` (hidden for first 3 retries) |
| LLM API error | `infra/llm/*.ts` | `✗ API error. Retrying... (attempt 2/5)` |
| Invalid symbol | Agent response | `Gordon: I couldn't find XYZUSDT. Did you mean BTCUSDT?` |

Every error includes a fix suggestion (cli-guidelines: `errors-rewrite-for-humans`).

---

### 15. BACKGROUND OPERATIONS

| Claude Code | Gordon Module | Vibe Trading |
|---|---|---|
| Background tasks (DreamTask, LocalAgentTask) | `core/autonomous-loop.ts` | Deployed strategies run autonomously |
| Task status in footer | `runtime/state background.tasks` | Show "1 strategy running" in input hints |
| Task completion notification | Background monitoring | Push fill/stop/alert messages into conversation |

**How background events appear:**

```
[conversation continues normally]

◈ STRATEGY UPDATE · momentum_btc                     2m ago
  ✓ Filled: BUY 0.05 BTC @ 67,120
  Running P&L: +$142.50 (+0.21%)

[conversation continues]
```

These inject between messages. The user never asked — Gordon proactively reports.

---

### 16. DOCTOR / DIAGNOSTICS

| Claude Code | Gordon |
|---|---|
| `/doctor` checks: Node, npm, git, permissions | `/doctor` checks: exchanges, brokers, wallets, LLM, database |

**Gordon doctor output:**
```
GORDON DOCTOR

Exchange
  ✓ Binance API connected (250ms)
  ✓ WebSocket live
  ✓ Rate limit: 850/1200 req/min

Broker
  ✓ Alpaca authenticated
  ⚠ Paper mode (switch with /config mode live)

LLM
  ✓ API key valid
  ✓ Budget: 50K/100K tokens

Session
  ✓ 12 messages · 3 trades · 1 open position

Overall: HEALTHY ✓
```

---

### 17. SETUP / ONBOARDING

| Claude Code | Gordon |
|---|---|
| Trust dialog → permission mode selection → project onboarding | First-run detection → SetupWizard → exchange/broker/LLM setup |

**Gordon onboarding (first run):**
```
Welcome to Gordon. Let's set up your trading environment.

Step 1/5: LLM Provider
  Which AI provider?
  ▸ OpenAI (recommended)
    Anthropic
    Inception

[user selects, enters API key]

Step 2/5: Exchange
  Connect a crypto exchange?
  ▸ Binance
    Coinbase
    Skip

[continues through broker, risk level, done]
```

After setup: "Setup complete. Try /scan to see what's moving."

---

## Color Scheme (cli-ux-designer)

| Element | Color | Why |
|---|---|---|
| User text ("YOU") | White bold | Primary speaker, high contrast |
| Gordon text ("GORDON") | Cyan bright bold | Brand identity, distinguishes agent |
| Agent name ("Scanner") | Cyan | Consistent with brand |
| System messages | Cyan dim | Informational, not attention-grabbing |
| Positive (P&L up, fills, ✓) | Green | Universal trader convention |
| Negative (P&L down, errors, ✗) | Red | Universal trader convention |
| Warnings, approvals | Yellow | Attention without alarm |
| Timestamps, metadata | Dim gray | Recedes, doesn't compete |
| Prompt character (❯) | Cyan bright | Always visible, inviting |
| Dividers | Dim gray | Structure without noise |
| Streaming cursor (█) | Cyan bright | Active indicator |

NO background colors on panels. NO bordered boxes around conversation. Color is semantic only.

---

## Risk Ladder (cli-design-framework)

| Level | Scope | Examples | Guardrail |
|---|---|---|---|
| None | `market.read`, `analysis.run`, `portfolio.read` | Scan, analyze, chart, positions | Auto-approve always |
| Low | `papertrade.execute` | Paper orders | Inline approval (can "always allow") |
| Medium | `livetrade.execute` (small positions) | Small market/limit orders | Inline approval with plan preview |
| High | `livetrade.execute` (significant positions) | Large orders, bracket orders | Bordered approval with full ticket + risk metrics |
| Critical | `transfer.execute`, `wallet.write` | Fund withdrawals, large margin | Bordered approval + 3-second countdown |

Policy enforcement (position limits, cash reserve %, concurrent trade limits) happens at `core/risk-kernel/kernel.ts` BEFORE the approval dialog appears. The dialog only shows if the risk kernel approves the operation is within limits.

---

## Exhaustive Build Specification

### Complete File Inventory

**Files to CREATE:**
| File | Purpose |
|---|---|
| `src/tui/components/GordonHeader.tsx` | Permanent first message: GL mark + welcome + mode + session info |
| `src/tui/components/FooterHints.tsx` | Right-aligned hints on input line: `ask · 3 agents · Ctrl+P · ? help` |
| `src/tui/components/InlineHelp.tsx` | Quick reference shown on `?` press, hidden on type |
| `src/tui/components/SwarmTree.tsx` | Coordinator → workers visualization for parallel agents |
| `src/tui/components/HandoffArrow.tsx` | `→ Handing off to Analyst` transition between agent chains |

**Files to REWRITE (significant changes):**
| File | Changes |
|---|---|
| `src/tui/App.tsx` | Remove all borders. Add GordonHeader as first static message. Replace StatusLine with FooterHints. Add `<Static>` for completed messages. Add notification injection. Add parallel agent state. Add swarm state. |
| `src/tui/components/MessageBubble.tsx` | Remove all borders. Cyan for GORDON, white for YOU. Use RichContent for body. Add variants: fill, stop, alert, strategy, handoff. |
| `src/tui/components/DataTable.tsx` | Remove box-drawing border characters. Use plain aligned columns with color. |
| `src/tui/components/StatusLine.tsx` | DELETE — replaced by FooterHints on input line |
| `src/tui/components/ApprovalDialog.tsx` | Remove bordered box for standard risk. Keep bordered for high/critical only. Use horizontal dividers (─) above and below. |
| `src/tui/components/AgentProgress.tsx` | Support `chains: ProgressChain[]` (multiple concurrent agents). Render handoff arrows between chains. Show duration per chain. |
| `src/tui/components/WorkerBadge.tsx` | Change yellow → cyan for Gordon's voice. Keep per-agent color map. |
| `src/tui/components/CommandPalette.tsx` | Pull from `SLASH_COMMANDS` dynamically (already done). Add workflow group headers. |
| `src/tui/components/BootScreen.tsx` | Simplify: small logo (3 lines) + system checks. Not full-screen. |
| `src/tui/components/SetupWizard.tsx` | Wire to `applyBootstrap()`. Add first-run detection via `collectDoctorReport()`. |
| `src/tui/bridge/runtime.ts` | Full slash command routing via `parseSlashCommand()` + `commandToPrompt()`. Background monitoring via subscription (not polling). Session resume with transcript restore. Token + cost tracking from `done` events. |
| `src/index.tsx` | Remove SIGINT handler (let Ink handle). Keep SIGTERM/SIGHUP. |

**Files to KEEP (minor or no changes):**
| File | Status |
|---|---|
| `src/tui/components/StreamingText.tsx` | Keep — change cursor color to cyan |
| `src/tui/components/Byline.tsx` | Keep as-is |
| `src/tui/components/Divider.tsx` | Keep as-is |
| `src/tui/components/Ratchet.tsx` | Keep as-is |
| `src/tui/components/CollapsibleOutput.tsx` | Keep as-is |
| `src/tui/components/InlineChart.tsx` | Keep as-is |
| `src/tui/components/RichContent.tsx` | Keep — already detects JSON and renders DataTable |
| `src/tui/index.tsx` | Keep as-is |
| `src/tui/test.tsx` | Keep as-is |

**Files to DELETE:**
| File | Reason |
|---|---|
| `src/tui/components/StatusLine.tsx` | Replaced by FooterHints |

---

### Complete App State

```typescript
interface AppState {
  // Permission (replaces ARMED/DISARMED)
  permissionMode: "auto" | "ask" | "strict";

  // Conversation
  messages: Message[];                    // All messages (completed + active)
  completedMessageCount: number;          // Index for <Static> split
  streamBuffer: string;                   // Current streaming text
  isStreaming: boolean;

  // Multi-agent
  activeAgents: AgentChain[];             // Multiple concurrent agent chains
  swarmMode: boolean;                     // True when coordinator is active
  handoffHistory: HandoffEvent[];         // Scanner → Analyst → Planner transitions

  // Approvals
  pendingApprovals: ApprovalRequest[];

  // Session
  sessionId: string | null;
  threadId: string | null;
  isResumedSession: boolean;

  // Metrics
  tokenCount: number;
  cost: number;
  tradeCount: number;                     // Trades executed this session

  // Background
  backgroundTasks: BackgroundTask[];       // Autonomous loops, deployed strategies
  backgroundNotifications: Notification[]; // Pending fill/stop/alert notifications

  // UI state
  ctrlCPressed: boolean;
  showPalette: boolean;
  showSetup: boolean;
  showHelp: boolean;                      // ? quick reference visible
  runtimeReady: boolean;
  bootPhase: "boot" | "ready";
}

interface AgentChain {
  id: string;
  agentName: string;
  symbol?: string;                         // What symbol this chain is working on
  status: "running" | "done" | "error";
  startedAt: number;
  duration?: number;
  nodes: ProgressNode[];
}

interface HandoffEvent {
  from: string;                            // "Scanner"
  to: string;                              // "Analyst"
  timestamp: number;
}

interface BackgroundTask {
  id: string;
  label: string;                           // "momentum_btc"
  type: "strategy" | "monitor" | "autonomous";
  status: "running" | "completed" | "failed";
  lastEvent?: string;                      // "Filled: BUY 0.05 BTC @ 67,120"
  pnl?: number;
}

interface Notification {
  id: string;
  type: "fill" | "stop" | "alert" | "strategy";
  message: string;
  timestamp: string;
  injected: boolean;                       // Has it been added to messages yet?
}
```

---

### Complete Message Variants

```typescript
interface Message {
  id: string;
  role: "user" | "gordon" | "system";
  content: string;
  timestamp?: string;
  variant?: MessageVariant;
  agent?: string;                          // "Scanner", "Analyst", etc.
  badge?: string;                          // Approval short ID
}

type MessageVariant =
  | "default"        // Normal message
  | "approval"       // Pending approval (yellow ⚠)
  | "system"         // System info (cyan dim)
  | "tool"           // Tool invocation (gray dim)
  | "handoff"        // Agent transition (cyan →)
  | "fill"           // Order filled (green ✓) — NEW for trading
  | "stop"           // Stop triggered (red ⚠) — NEW for trading
  | "alert"          // Price alert (yellow !) — NEW for trading
  | "strategy"       // Strategy update (cyan ◈) — NEW for trading
  | "error"          // Error (red ✗)
  | "compact"        // Conversation compacted (dim ✻)
  | "resume"         // Session resumed (dim)
  | "welcome"        // GordonHeader (permanent first message)
```

**Rendering per variant:**
| Variant | Badge | Badge Color | Content Color | Icon |
|---|---|---|---|---|
| default (user) | YOU | white bold | white | — |
| default (gordon) | GORDON · Agent | cyan bold | white | — |
| approval | APPROVAL [id] | yellow bold | yellow | ⚠ |
| system | SYSTEM | cyan dim | dim | — |
| tool | TOOL | gray | dim | — |
| handoff | → Agent | cyan | cyan | → |
| fill | FILLED | green bold | green | ✓ |
| stop | STOP | red bold | red | ⚠ |
| alert | ALERT | yellow bold | yellow | ! |
| strategy | STRATEGY · name | cyan | cyan | ◈ |
| error | ERROR | red bold | red | ✗ |
| compact | — | dim | dim | ✻ |
| resume | — | dim | dim | ↻ |
| welcome | ██ Gordon | cyan bold | dim | ██ |

---

### Complete Keyboard Bindings

| Key | Context | Action |
|---|---|---|
| Enter | Input has text | Submit message/command |
| Ctrl+C (first) | Any | Show "Press again to exit" warning |
| Ctrl+C (second) | Within 2s of first | Exit application |
| Ctrl+P | Any | Toggle command palette |
| ? | Input empty | Toggle inline help |
| ↑ | Input focused | Previous input history |
| ↓ | Input focused | Next input history |
| Escape | Palette open | Close palette |
| Escape | Help visible | Close help |
| Escape | Input has text | Clear input |
| Ctrl+E | Output focused | Toggle collapsible output expansion |

---

### Complete Slash Command Routing

**Path:** User types `/command args` → `parseSlashCommand(input)` → `{command, args}` → route:

| Command Action | Route | Example |
|---|---|---|
| `action: "agent"` | `commandToPrompt(command, args)` → `runtime.streamMessage(prompt)` | `/scan`, `/analyze BTC`, `/plan BTC` |
| `action: "tool"` | Direct handler function | `/config set mode live`, `/mcp list` |
| `action: "menu"` | Local UI dispatch | `/help`, `/doctor`, `/resume`, `/setup` |

**Menu commands handled locally:**
| Command | Handler | What It Does |
|---|---|---|
| `/help [topic]` | `formatPaginatedCommandHelp()` | Show commands by workflow |
| `/doctor` | `collectDoctorReport()` → `formatDoctorReport()` | System health |
| `/resume` | `runtime.resumeSession()` + transcript restore | Resume previous session |
| `/new-session` | `runtime.startNewSession()` + clear messages | Fresh session |
| `/session` | `runtime.getCurrentSession()` | Session info |
| `/threads` | `runtime.listRecentHistory()` | List saved sessions |
| `/runtime-state` | `runtime.getState()` | Runtime inspection |
| `/runtime-plugins` | `runtime.getState().tooling.plugins` | Plugin list |
| `/runtime-approvals` | `runtime.getPendingApprovals()` | Approval queue |
| `/runtime-approve <id>` | `runtime.approvePendingRequest()` | Approve action |
| `/runtime-deny <id>` | `runtime.denyPendingRequest()` | Deny action |
| `/runtime-transcript` | `runtime.getTranscript()` | View transcript |
| `/runtime-scratchpad` | `runtime.getScratchpadEntries()` | Agent working notes |
| `/runtime-handoffs` | `runtime.getHandoffArtifacts()` | Agent transitions |
| `/compact` | `runtime.compactTranscript()` | Compress history |
| `/ask` | Set `permissionMode: "ask"` | Per-action approval |
| `/auto` | Set `permissionMode: "auto"` | Auto-approve |
| `/strict` | Set `permissionMode: "strict"` | Always ask |
| `/setup` | Show `SetupWizard` | Configuration |

**Tool commands routed to handlers:**
| Command | Handler | Source |
|---|---|---|
| `/mcp` | `handleMCPCommand(argsArray)` | `src/app/commands/mcp.ts` |
| `/config` | `handleConfigCommand(args)` | `src/app/commands/config.ts` |
| `/exchange` | `handleExchangeCommand(args)` | `src/app/commands/exchange.ts` |
| `/broker` | `handleBrokerCommand(args)` | `src/app/commands/broker.ts` |
| `/stocks` | `handleStocksCommand(args)` | `src/app/commands/stocks.ts` |
| `/strategy` | `handleStrategyCommand(args)` | `src/app/commands/strategy.ts` |
| `/workflow` | `handleWorkflowCommand(args, ctx)` | `src/app/commands/workflow.ts` |
| `/export` | `handleExportCommand(args, ctx)` | `src/app/commands/export.ts` |
| `/keyring` | `handleKeyringCommand(args)` | `src/app/commands/keyring.ts` |
| `/telemetry` | `handleTelemetryCommand(args)` | `src/app/commands/telemetry.ts` |
| `/context` | `handleContextCommand(args)` | `src/app/commands/context.ts` |

**Agent commands (routed to LLM via prompt):**
All commands with `action: "agent"` in `SLASH_COMMANDS` — includes: `/scan`, `/analyze`, `/trending`, `/volume`, `/regime`, `/whales`, `/breakouts`, `/score`, `/chart`, `/ta`, `/deep`, `/fast-deep`, `/mtf`, `/ensemble`, `/compare-coins`, `/plan`, `/preview-order`, `/grid`, `/backtest`, `/optimize`, `/compare`, `/deploy`, `/research`, `/forecast`, `/liquidation`, and 100+ more.

---

### Complete Backend Connections

| TUI Event | Backend Call | Gordon Module |
|---|---|---|
| User submits text | `runtime.streamMessage(text)` | `runtime/session/SessionRuntime.ts` |
| Slash command `/scan` | `commandToPrompt(cmd, args)` → `runtime.streamMessage(prompt)` | `app/slashCommands.ts` → `runtime/query/QueryRuntime.ts` |
| Tool command `/config` | `handleConfigCommand(args)` | `app/commands/config.ts` → `infra/storage/config.ts` |
| Approve action | `runtime.approvePendingRequest(id, opts)` | `runtime/permissions/PermissionEngine.ts` |
| Deny action | `runtime.denyPendingRequest(id, opts)` | `runtime/permissions/PermissionEngine.ts` |
| Stream event: text_delta | Append to `streamBuffer` | — |
| Stream event: agent_switch | Update `activeAgents`, add HandoffEvent | `app/taskTree.ts` |
| Stream event: tool_call_start | Add node to active chain | `app/taskTree.ts` |
| Stream event: tool_call_end | Complete node in chain | `app/taskTree.ts` |
| Stream event: done | Finalize message + check approvals + update tokens | `runtime/session/SessionRuntime.ts` |
| Stream event: error | Add error message | — |
| Background task change | Inject notification message | `runtime/state/RuntimeStore.ts` |
| Runtime state change | Update `pendingApprovals`, `sessionId`, `threadId` | `runtime/state/RuntimeStore.ts` |
| Session resume | Restore transcript → messages | `runtime/transcript/TranscriptStore.ts` |
| Doctor request | `collectDoctorReport()` → format | `app/setup-runtime.ts` |
| Setup complete | `applyBootstrap(options)` | `app/setup-runtime.ts` |

---

### Implementation Order (21 steps, 5 phases)

#### Phase 1: Visual Foundation (make it look like Claude Code)
1. **Rewrite `App.tsx`** — remove all `borderStyle`, add GordonHeader as first `<Static>` message, replace StatusLine with FooterHints on input line, add `completedMessageCount` for `<Static>` split
2. **Rewrite `MessageBubble.tsx`** — remove all borders, cyan for GORDON badge, white for YOU, dim for SYSTEM, use `RichContent` for body, add all 12 variant renderers
3. **Rewrite `DataTable.tsx`** — remove box-drawing border chars (┌─┐│└┘), use aligned columns with padding only, keep color-coded cells
4. **Color scheme pass** — global find/replace: `color="yellow"` for Gordon → `color="cyanBright"`, keep yellow only for warnings/approvals
5. **Create `GordonHeader.tsx`** — permanent first message: `██ Gordon Trading Terminal` + `██ General Liquidity, Inc.` + `██ ask mode · session-abc123`
6. **Create `FooterHints.tsx`** — right-aligned on input line: `ask · Ctrl+P · ? help`, updates with agent count when streaming

#### Phase 2: Interaction (make it work like Claude Code)
7. **Create `InlineHelp.tsx`** — shown when `?` pressed with empty input, lists 6 essential commands + example prompt, hidden on type
8. **Add `<Static>` split** — messages before `completedMessageCount` render in `<Static>` (no re-render), active/streaming messages render normally
9. **Session resume** — on startup, `runtime.initializeSession({autoResume: true})` → restore transcript → add resume system message: `↻ Resumed · 45 messages · last: analyzed BTC`
10. **Full slash command routing** — `parseSlashCommand()` dispatches ALL 150+ commands via action type (agent/tool/menu)

#### Phase 3: Trading Intelligence (make it trade)
11. **Background notification injection** — `runtime.subscribe()` watches for background task changes, injects fill/stop/alert/strategy messages into conversation as they happen
12. **Doctor output** — `/doctor` calls `collectDoctorReport()`, formats with ✓/✗ for each subsystem (exchange, broker, LLM, session)
13. **Setup wizard** — on first run (detected via doctor report `onboardingComplete: false`), show `SetupWizard` before conversation. Wire to `applyBootstrap()`.

#### Phase 4: Multi-Agent System (make it orchestrate)
14. **Parallel agent display** — `AgentProgress` accepts `chains: AgentChain[]` instead of flat `nodes: ProgressNode[]`. Each chain renders its own tree section.
15. **Create `SwarmTree.tsx`** — flat agent list with status when coordinator is active: `├─ Scanner ● scanning 50 symbols`
16. **Background agent notifications** — subscribe to `runtime.getState().background.tasks`, on change inject variant-specific messages (fill=green ✓, stop=red ⚠, alert=yellow !, strategy=cyan ◈)
17. **Coordinator count in hints** — `FooterHints` shows `3 agents` when `activeAgents.length > 1`
18. **Create `HandoffArrow.tsx`** — renders `→ Handing off to Analyst` between agent chain transitions. Triggered by `agent_switch` stream events.

#### Phase 5: Polish
19. **Simplify `BootScreen.tsx`** — 3-line logo + 4 system checks (exchange, broker, LLM, session), not full-screen animation
20. **Collapsible output** — `CollapsibleOutput` already built, wire Ctrl+E in `App.tsx` `useInput`
21. **Command palette** — `CommandPalette` already built with `SLASH_COMMANDS`, add workflow group headers (DISCOVER ◆, ANALYZE ◈, TRADE ▲, RUN ◇, ACCOUNTS ■, OPERATE ●)

---

### What Is NOT Being Built (explicit deferrals)

| Feature | Reason | When |
|---|---|---|
| Custom Ink fork | Stock Ink 6.6 is sufficient | Never unless performance requires it |
| Virtual scroll engine | `<Static>` handles scale | If sessions exceed 5000 messages |
| Vim mode | Not core to trading | v2 if requested |
| Voice mode | Requires Anthropic voice API | v2 |
| Bridge/IDE integration | No IDE needed for trading | v2 if web UI built |
| Dashboard panels | Conversation-first, never panels | Never |
| Bordered boxes on conversation | Claude Code style: no borders | Never |
| Full-screen boot animation | Deferred, simple logo for v1 | v2 for cinematic feel |
| Tab completion in input | Ctrl+P palette covers discovery | v2 |
| Buddy/Tamagotchi | Fun but not core | v2 as easter egg |
| KAIROS full autonomous | `autonomous-loop.ts` already exists | v2 for KAIROS-style heartbeat |

### What IS Being Built (complete list)

| Feature | Component | Backend Module |
|---|---|---|
| Conversation shell | `App.tsx` | — |
| Permanent header | `GordonHeader.tsx` | — |
| Message rendering (12 variants) | `MessageBubble.tsx` | `app/chatTypes.ts` |
| Streaming text with cursor | `StreamingText.tsx` | StreamEvent `text_delta` |
| Ticker-grade inline tables | `DataTable.tsx` + `RichContent.tsx` | Agent text → JSON detection |
| Inline sparkline charts | `InlineChart.tsx` | Price data in responses |
| Per-action approval (4 risk tiers) | `ApprovalDialog.tsx` | `runtime/permissions/PermissionEngine.ts` |
| Agent progress tree | `AgentProgress.tsx` | `app/taskTree.ts` |
| Parallel agent chains | `AgentProgress.tsx` (rewritten) | `infra/agents/orchestrator.ts` |
| Agent swarm visualization | `SwarmTree.tsx` | `core/runtime/coordinator.ts` |
| Agent handoff arrows | `HandoffArrow.tsx` | StreamEvent `agent_switch` |
| Worker badges (10 agents) | `WorkerBadge.tsx` | `runtime/contracts/types.ts` WorkerRole |
| Background notifications (4 types) | `App.tsx` injection | `runtime/state background.tasks` |
| Command palette (150+ commands) | `CommandPalette.tsx` | `app/slashCommands.ts` SLASH_COMMANDS |
| Inline help (`?` shortcut) | `InlineHelp.tsx` | — |
| Footer hints (mode, agents, shortcuts) | `FooterHints.tsx` | AppState |
| Input with history | `TextInput` + `useInput` | — |
| Double-press Ctrl+C guard | `App.tsx` | — |
| Session resume with transcript | `bridge/runtime.ts` | `runtime/session/SessionRuntime.ts` |
| 150+ slash commands routed | `bridge/runtime.ts` | `app/slashCommands.ts` + `app/commands/*` |
| Doctor diagnostics | `bridge/runtime.ts` menu handler | `app/setup-runtime.ts` |
| Setup wizard (5 steps) | `SetupWizard.tsx` | `app/setup-flow.ts` + `app/setup-runtime.ts` |
| Boot screen (logo + checks) | `BootScreen.tsx` | `ascii-art.txt` |
| Collapsible output (Ctrl+E) | `CollapsibleOutput.tsx` | — |
| Rich content rendering | `RichContent.tsx` | JSON → DataTable detection |
| Byline metadata | `Byline.tsx` | — |
| Dividers | `Divider.tsx` | — |
| Layout stability | `Ratchet.tsx` | — |
| Token + cost tracking | `FooterHints.tsx` + AppState | StreamEvent `done` usage |
| Permission mode commands | `bridge/runtime.ts` | `/ask`, `/auto`, `/strict` |

---

## Success Criteria

1. User types "scan top movers" → sees scan results as aligned table within 15 seconds
2. User types "/analyze BTC" → sees technical analysis with levels and signal
3. User types "build me a swing long on ETH" → sees trade plan with approval dialog
4. Approval dialog: user selects "Allow this time" → order executes → fill notification appears
5. Background strategy: fill notification appears without user asking
6. `/doctor` → shows exchange + broker + LLM health with check marks
7. `/help` → shows essential commands grouped by workflow
8. Ctrl+P → command palette with fuzzy search across all commands
9. Session resume → shows "Resumed · N messages" with previous transcript
10. First run → setup wizard guides through exchange + LLM configuration
