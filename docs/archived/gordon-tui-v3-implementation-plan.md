# Gordon TUI v3 — Implementation Plan (Ink/React)

## Context

The TUI has been rebuilt on Ink + ink-ui + custom components per `docs/gordon-tui-v3-design.md`. 17 files exist under `src/tui/`. The component library is built but not fully wired to Gordon's backend. This plan covers everything needed to go from "components exist" to "fully working product."

**Design spec:** `docs/gordon-tui-v3-design.md`
**Stack:** Ink 6.6 + @inkjs/ui + custom components on Box+Text

## What's Built (17 files)

- `App.tsx` — main shell with state, keybindings, runtime init, submit handler
- `components/StatusLine.tsx` — top bar: GORDON + SAFE/ARMED + thread + agent + tokens
- `components/MessageBubble.tsx` — role-based messages (YOU/GORDON/SYSTEM/APPROVAL/TOOL/HANDOFF)
- `components/StreamingText.tsx` — word-by-word with blinking cursor
- `components/WorkerBadge.tsx` — colored per-agent bullets
- `components/AgentProgress.tsx` — task tree with box-drawing chars
- `components/ApprovalDialog.tsx` — radio select (Always/Once/Deny)
- `components/DataTable.tsx` — ticker-grade table with borders, color cells, fmtNum
- `components/InlineChart.tsx` — Unicode block sparkline
- `components/CollapsibleOutput.tsx` — truncate + Ctrl+E expand
- `components/CommandPalette.tsx` — fuzzy search overlay (Ctrl+P)
- `components/Byline.tsx` — middot metadata separator
- `components/Divider.tsx` — horizontal rule
- `components/Ratchet.tsx` — layout bounce prevention
- `bridge/runtime.ts` — SessionRuntime init, streaming, basic slash dispatch
- `index.tsx` + `test.tsx` — entry points

## What's Missing

### A. Slash Command Wiring
**Problem:** `bridge/runtime.ts` only routes a small set of "agent commands" to `streamMessage()`. The 160+ slash commands from `src/app/slashCommands.ts` and their handlers in `src/app/commands/` are not dispatched.

**Fix:**
1. In `bridge/runtime.ts`, import `parseSlashCommand` and `commandToPrompt` from `src/app/slashCommands.ts`
2. Import all handlers from `src/app/commands/index.ts` (handleMCPCommand, handleConfigCommand, handleBrokerCommand, etc.)
3. Route tool-type commands to their handlers, agent-type commands to `streamMessage()` with the right prompt
4. Display handler results as system messages in the conversation

**Files to modify:** `src/tui/bridge/runtime.ts`
**Files to read:** `src/app/slashCommands.ts`, `src/app/commands/index.ts`

### B. Rich Message Rendering (DataTable + InlineChart in messages)
**Problem:** When Gordon returns scan results, positions, strategies, etc., the content comes as text in the stream. It should render as inline `<DataTable>` and `<InlineChart>`.

**Fix:**
1. Create `src/tui/components/RichContent.tsx` — parses message content for structured data patterns and renders appropriate components
2. Detect table-like output (agent returns structured data as JSON or formatted text) and render via `<DataTable>`
3. Detect price history data and render via `<InlineChart>`
4. Wrap in `<CollapsibleOutput>` when content exceeds 10 lines
5. Update `<MessageBubble>` to use `<RichContent>` for message body

**Files to create:** `src/tui/components/RichContent.tsx`
**Files to modify:** `src/tui/components/MessageBubble.tsx`

### C. Approval Integration
**Problem:** `<ApprovalDialog>` component exists but isn't rendered in the conversation when approvals are pending.

**Fix:**
1. Add `pendingApprovals` to App state
2. When runtime emits pending approvals, store them in state
3. Render `<ApprovalDialog>` inline in conversation for medium-risk actions
4. For high/critical risk, render a bordered modal-like box
5. Wire the onDecision callback to `runtime.approvePendingRequest()` / `denyPendingRequest()`

**Files to modify:** `src/tui/App.tsx`, `src/tui/bridge/runtime.ts`

### D. CommandPalette with Real Commands
**Problem:** Palette items are hardcoded. Should pull from `SLASH_COMMANDS` registry.

**Fix:**
1. Import `SLASH_COMMANDS` from `src/app/slashCommands.ts`
2. Map to `PaletteItem[]` with label, description, category
3. Pass to `<CommandPalette>` dynamically

**Files to modify:** `src/tui/App.tsx`
**Files to read:** `src/app/slashCommands.ts`

### E. Session Management
**Problem:** No `/resume`, `/threads`, `/switch-thread`, `/new-session` support.

**Fix:**
1. Add session commands to bridge dispatch
2. On resume, restore transcript from `runtime.getTranscript()` and convert to `Message[]`
3. Show session info in welcome message when resuming

**Files to modify:** `src/tui/bridge/runtime.ts`, `src/tui/App.tsx`

### F. Setup/Onboarding Flow
**Problem:** No guided setup for first-time users.

**Fix:**
1. Create `src/tui/components/SetupWizard.tsx` — multi-step wizard using ink-ui Select + TextInput
2. Steps from `src/app/setup-flow.ts`: exchange → broker → chains → rails → mcp → llm → preferences
3. On first run (detected via `collectDoctorReport()`), show wizard before conversation
4. Wire to `applyBootstrap()` from `src/app/setup-runtime.ts`

**Files to create:** `src/tui/components/SetupWizard.tsx`
**Files to read:** `src/app/setup-flow.ts`, `src/app/setup-runtime.ts`

### G. Boot Sequence
**Problem:** No ASCII logo animation on startup.

**Fix:**
1. Create `src/tui/components/BootScreen.tsx` — shows General Liquidity logo from `ascii-art.txt`, system checks, then transitions to conversation
2. Add `bootPhase` to App state ("boot" | "ready")
3. Render `<BootScreen>` when phase is "boot", conversation when "ready"
4. System checks: config loaded ✓, session restored ✓, plugins loaded ✓

**Files to create:** `src/tui/components/BootScreen.tsx`
**Files to modify:** `src/tui/App.tsx`

### H. Cleanup Dead Directories
**Problem:** Empty directories from old TUI: `src/app/components/`, `src/app/screens/`, `src/app/state/`, `src/app/assets/`

**Fix:** Delete empty directories.

### I. index.tsx Signal Handler Fix
**Problem:** `src/index.tsx` registers SIGINT/SIGTERM handlers that call `process.exit()`. Ink also handles Ctrl+C. Our App has a double-press guard. These may conflict.

**Fix:**
1. Remove the process.on("SIGINT") handler from index.tsx — let Ink handle Ctrl+C
2. Keep the gracefulShutdown function but call it from the App's exit path
3. Keep uncaughtException/unhandledRejection handlers

**Files to modify:** `src/index.tsx`

### J. StatusLine Real-Time Updates
**Problem:** StatusLine shows mode/agent/session but doesn't update token count or cost in real-time.

**Fix:**
1. Track tokenCount and cost in App state
2. Update from stream events (done event includes usage)
3. Pass to StatusLine

**Files to modify:** `src/tui/App.tsx`, `src/tui/bridge/runtime.ts`

## Implementation Order

1. **H** — Cleanup dead directories (fast, unblocks nothing but clean)
2. **I** — Fix index.tsx signal handlers (prevents Ctrl+C conflicts)
3. **A** — Slash command wiring (unblocks all commands)
4. **D** — CommandPalette with real commands (depends on A)
5. **C** — Approval integration (unblocks safe trading flow)
6. **B** — Rich message rendering (DataTable/InlineChart in messages)
7. **E** — Session management (resume, threads)
8. **J** — StatusLine real-time updates
9. **F** — Setup/onboarding wizard
10. **G** — Boot sequence

## Verification

1. `bun run src/tui/test.tsx` — shell renders, input works, welcome message visible
2. Type `/help` — renders command list inline
3. Type `/scan` — streams response with agent progress tree, result renders as DataTable
4. Type `/positions` — renders position table inline
5. Type "analyze BTC" — natural language routes to agent, streams analysis
6. Approval appears inline — radio select works, approve/deny updates state
7. Ctrl+P — command palette opens with all 160+ commands searchable
8. Ctrl+C — double-press guard works, shows position warning when ARMED
9. `bun run start` — full startup chain: license → telemetry → TUI renders
10. Session resume — restart shows previous conversation

## Critical Files

**TUI (modify):**
- `src/tui/App.tsx`
- `src/tui/bridge/runtime.ts`
- `src/tui/components/MessageBubble.tsx`

**TUI (create):**
- `src/tui/components/RichContent.tsx`
- `src/tui/components/SetupWizard.tsx`
- `src/tui/components/BootScreen.tsx`

**App layer (read, wire into):**
- `src/app/slashCommands.ts` — SLASH_COMMANDS, parseSlashCommand, commandToPrompt
- `src/app/commands/index.ts` — all handle*Command exports
- `src/app/commandUx.ts` — getQuickActionItems, WORKFLOW_CONFIG
- `src/app/chatFlow.ts` — buildPendingApprovalMessages
- `src/app/taskTree.ts` — createTaskTree, record* functions
- `src/app/setup-flow.ts` — SETUP_WIZARD_SECTIONS, getSetupSectionLabel
- `src/app/setup-runtime.ts` — applyBootstrap, collectDoctorReport

**Entry point (modify):**
- `src/index.tsx` — signal handler fix, TUI import

**Delete:**
- `src/app/components/` (empty)
- `src/app/screens/` (empty)
- `src/app/state/` (empty)
- `src/app/assets/` (empty)

---

## Additional Items (discovered post-initial plan)

### K. Permission Model Reframe (replaces ARMED/DISARMED)
**Problem:** Binary ARMED/DISARMED is a global toggle — user forgets, everything executes. Pear VC's "plan-then-execute" paradigm + Claude Code's per-action permission model is superior.

**Fix:**
1. Remove ARMED/DISARMED mode from App state — replace with `permissionMode: "auto" | "ask" | "strict"`
2. StatusLine shows permission mode instead of SAFE/ARMED
3. ApprovalDialog renders for every execution-class action (not just when "ARMED")
4. Radio select options: "Always allow this tool" / "Allow this time" / "Deny" (like Claude Code)
5. High/critical risk: bordered approval with full plan preview + risk metrics
6. Critical risk: 3-second countdown before confirm button activates
7. Wire to existing `PermissionEngine.evaluate()` and `RuntimeApprovalClass` system
8. Policy enforcement (position limits, cash reserve) happens at PermissionEngine level before dialog appears
9. All decisions logged to audit trail

**Files to modify:** `src/tui/App.tsx`, `src/tui/components/StatusLine.tsx`, `src/tui/components/ApprovalDialog.tsx`, `src/tui/bridge/runtime.ts`
**Files to read:** `src/runtime/permissions/PermissionEngine.ts`, `src/runtime/contracts/types.ts`

### L. Multi-Agent Visual Display
**Problem:** Gordon has 10 specialized agents (Scanner, Analyst, Planner, Executor, etc.) with handoff chains, but the TUI doesn't fully visualize parallel execution or background agents.

**Fix:**
1. **Parallel agent display** — when multiple agents work simultaneously (Scanner on BTC while Analyst finishes ETH), show parallel branches in AgentProgress tree
2. **Background agent notifications** — when autonomous strategies or deployed playbooks produce events (fills, stops, alerts), surface them as proactive messages in the conversation without user asking
3. **Worker scratchpad display** — when user asks `/runtime-scratchpad`, show agent working notes inline
4. **Handoff chain visualization** — "Scanner → Analyst → Planner" shown as connected chain with status per node
5. Update AgentProgress to support multiple concurrent root nodes (one per parallel agent)

**Files to modify:** `src/tui/components/AgentProgress.tsx`, `src/tui/bridge/runtime.ts`, `src/tui/App.tsx`
**Files to read:** `src/runtime/workers/ScratchpadStore.ts`, `src/runtime/workers/WorkerRegistry.ts`, `src/core/autonomous-loop.ts`

### M. Background Strategy Monitoring
**Problem:** When a strategy is deployed (`/deploy my_playbook`), it runs in the background. The TUI has no way to show proactive updates from background work.

**Fix:**
1. Subscribe to runtime background task state (`runtime.getState().background.tasks`)
2. When a background task changes status (fill, stop hit, alert), inject a system message into the conversation
3. Show persistent background task indicator in StatusLine: "1 strategy running"
4. `/strategies-live` shows all active background strategies with P&L

**Files to modify:** `src/tui/bridge/runtime.ts`, `src/tui/App.tsx`, `src/tui/components/StatusLine.tsx`

## Updated Implementation Order

1. **H** — Cleanup dead directories
2. **I** — Fix index.tsx signal handlers
3. **K** — Permission model reframe (removes ARMED/DISARMED, adds per-action approval)
4. **A** — Slash command wiring (all 160+ commands)
5. **D** — CommandPalette with real commands
6. **C** — Approval integration with new permission model
7. **B** — Rich message rendering (DataTable/InlineChart in messages)
8. **L** — Multi-agent visual display (parallel + handoff chain)
9. **E** — Session management (resume, threads)
10. **J** — StatusLine real-time updates (tokens, cost, permission mode, background tasks)
11. **M** — Background strategy monitoring
12. **F** — Setup/onboarding wizard
13. **G** — Boot sequence
