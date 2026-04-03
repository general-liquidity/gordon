# Gordon TUI Master Plan

Note: for current app-layer cockpit decisions, read [docs/gordon-tui-v2-design-spec.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-tui-v2-design-spec.md) first.
For the new runtime decision and client boundary, also read [docs/gordon-rezi-client.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-rezi-client.md).

This document remains useful as the broad capability and implementation reference, but it is no longer the primary source for Gordon's visible shell grammar.

This document is the implementation contract for the Gordon terminal reset.

For the exhaustive capability-to-surface map, see:

- [docs/gordon-feature-census.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-feature-census.md)
- [docs/gordon-design-traceability-matrix.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-design-traceability-matrix.md)

It replaces the previous "incremental polish" approach with a product-first plan grounded in the current repository, current runtime architecture, and the actual capabilities already implemented across trading, strategy, monitoring, runtime approvals, and workflow automation.

It is intentionally opinionated.

The goal is not to make Gordon "look better".
The goal is to make Gordon feel like the canonical terminal for an AI-native trading agent.

---

## 1. Purpose And Classification

### Gordon purpose

Gordon is an AI-native trading workstation that lets a user explore markets, form trade theses, review risk, run systematic research, and supervise execution from one terminal.

### CLI / TUI classification

Using the CLI design framework, Gordon is:

- Primary role: Runtime + Workflow + Operator workstation
- Primary user: Human operator using an AI system for financial reasoning and execution
- Interaction form: Mixed
  - live conversational prompt
  - keyboard-first TUI navigation
  - structured command and review workflows
- Statefulness: Sessionful and resumable
- Risk profile: High
  - because the system can route into approvals, execution, funding, and live account state
- Secondary surfaces:
  - machine-readable exports
  - runtime inspection
  - plugin and MCP integration
  - daemon / bridge coordination

### Design stance

Gordon should optimize for repeated trading workflows, fast review, and operator confidence under pressure.

Gordon should not optimize for "generic assistant flexibility" as the top-level UX shape.
It should not feel like a chatbot with widgets, and it should not feel like a web dashboard compressed into ANSI boxes.

---

## 2. Repository Reality

This plan is grounded in the current codebase.

### Current shell and UI control plane

- `src/app/App.tsx`
- `src/app/screens/ChatScreen.tsx`
- `src/app/ChatInput.tsx`
- `src/app/ChatView.tsx`
- `src/app/StatusBar.tsx`
- `src/app/slashCommands.ts`
- `src/app/state/AppStore.ts`
- `src/app/workspaces.ts`
- `src/app/workspaceViewModels.ts`
- `src/app/screens/WorkspaceBoard.tsx`
- `src/app/components/RuntimeInspector.tsx`

### Runtime and orchestration

- `src/runtime/session/SessionRuntime.ts`
- `src/runtime/query/QueryRuntime.ts`
- `src/runtime/state/RuntimeStore.ts`
- `src/runtime/tools/ToolInvoker.ts`
- `src/runtime/permissions/PermissionEngine.ts`
- `src/runtime/plugins/RuntimePluginManager.ts`
- `src/runtime/bridge/RuntimeBridge.ts`
- `src/infra/agents/orchestrator.ts`
- `src/infra/agents/tools/withMetrics.ts`

### Trading, execution, and monitoring

- `src/infra/agents/tools/trading.ts`
- `src/core/risk-kernel/kernel.ts`
- `src/core/execution/index.ts`
- `src/core/monitor.ts`
- `src/services/portfolio.service.ts`
- `src/infra/exchange/index.ts`
- `src/infra/broker/index.ts`
- `src/infra/agents/tools/wallet.ts`
- `src/infra/agents/tools/uniswap-data.ts`

### Market analysis and tape exploration

- `src/core/scanner.ts`
- `src/core/analyzer.ts`
- `src/infra/agents/tools/market.ts`
- `src/infra/agents/tools/technical.ts`
- `src/infra/agents/tools/market-structure.ts`
- `src/infra/agents/tools/order-book.ts`
- `src/infra/agents/tools/flow.ts`

### Strategy, lab, and systematic research

- `src/app/commands/workflow.ts`
- `src/app/commands/strategy.ts`
- `src/strategies/registry.ts`
- `src/strategies/dsl/index.ts`
- `src/backtest/engine.ts`
- `src/backtest/optimization/index.ts`
- `src/infra/systematic/service.ts`
- `src/infra/agents/tools/systematic-tools.ts`
- `src/core/playbooks/index.ts`

### Important repository truth

Gordon already contains enough capability to justify a serious multi-mode trading terminal.

The current UI underexposes:

- workflow chaining
- structured trade review
- systematic state and lifecycle
- account and book supervision
- runtime approvals as first-class operator actions
- plugin and integration health as real operating context

---

## 3. Capability Map

The current codebase already supports these product surfaces.

### Market discovery

- scans
- movers and volume
- regime
- single-symbol analysis
- technical analysis
- charting
- whale / flow analysis

### Plan and execution

- trade plan creation
- grid entry planning
- execution preview
- live order routing
- plan approval
- positions and orders inspection
- wallet / rails / funding support

### Strategy lab

- built-in strategy registry
- generated strategies
- playbooks
- quick backtests
- comparison
- optimization and evolution
- systematic profiles
- decay / lifecycle / validation / export

### Monitoring and operations

- portfolio summary
- positions and open orders
- runtime approvals
- runtime history
- background tasks
- daemon / bridge state
- plugin and MCP inventory
- system and connection health

### Agentic workflows

- quick workflow
- due diligence workflow
- backtest cycle
- Tinyfish web DD
- Tinyfish monitor scheduling and execution

---

## 4. Current UX Problems

### Structural problems

- Too much of the product still passes through a generic transcript.
- Non-desk workspaces still inherit too much of the same card/board grammar.
- Review objects are still rendered as message-like blocks instead of durable trading surfaces.
- The current shell spreads attention across too many equal-weight widgets.

### Interaction problems

- The user still relies too heavily on slash command recall.
- Keyboard focus is not local enough to each workspace.
- The prompt is still doing too much of the product's control work.
- Actions, hints, and status often repeat the same information in multiple places.

### Visual problems

- The UI still looks like a strong generic CLI agent more than a trading-native terminal.
- Current surfaces emphasize boxes rather than tables, ledgers, and ticket sheets.
- Monitor, Market, and Lab do not yet have distinct visual primitives.

### Performance / stability problems

- Streaming, loading, and layout changes still produce more reflow than a top-tier terminal should.
- Too many mounted regions can compete for redraws.
- The transcript and non-desk surfaces still share too much shell churn.

---

## 5. Product Thesis

Gordon should be rebuilt around trading-native primitives, not generic agent UI primitives.

The closest useful references are:

- Claude Code for fluency, progressive action, and composability
- ticker for market tables and watchlist discipline
- CLI Trader for the command -> strategize -> approve -> execute loop
- Charmbracelet's modern TUI stack for operator prompts, markdown rendering, layout discipline, table/viewports, and terminal-capability handling
- Karpathy's agent-native CLI thesis and `fintool` for financial capabilities exposed through agent-usable command surfaces
- Evangelion screen graphics for interlock grammar, warning semantics, and typographic authority
- donut-math style ASCII rendering for startup motion philosophy, adapted into a Gordon-specific orbital identity
- Pi / `pi-tui` for custom full-screen terminal interaction architecture
- k9s / lazygit / hledger-ui for focused panes, drill-downs, and high-signal operator ergonomics
- OpenTUI / Rezi for render ambition, overlays, and list stability
- Hatchet's "TUIs are easy now" article for the development loop, reference-driven iteration, and visual validation discipline
- `CLI-Anything` for REPL + subcommand duality, machine-readable contracts, and agent-friendly command surfaces
- CLIG / cli-guidelines for command behavior, help, output contracts, and error semantics

### Gordon thesis

Gordon is:

- the AI-native command center for markets
- the place where the user turns the tape into a thesis
- the place where the thesis becomes a ticket
- the place where a ticket becomes a reviewed action
- the place where systematic and discretionary work coexist

### Gordon should feel like

- premium
- sharp
- quiet under stress
- live but controlled
- financial without cosplay
- modern without web-app mimicry

### Gordon should not feel like

- a dashboard toy
- a crypto casino
- a generic assistant terminal
- a "card board" of equally weighted panels

### Agent-native infrastructure stance

Gordon should not only feel agent-native at the shell layer.
It should also prefer an agent-native ecosystem contract.

That means:

- Gordon should consume and expose capabilities through CLI, MCP, markdown, and stable structured output
- external helper tools should be binary-state wherever possible: they should either work or fail clearly
- heavy inference sidecars should prefer deterministic packaged runtimes or binaries over dependency-fragile scripts where practical
- Gordon docs, exports, and workflow artifacts should remain agent-readable and machine-chainable

The design implication is important:

- the terminal is the human command center
- CLI / MCP / markdown are the machine-access surfaces behind it

CLI Trader sharpens this further:

- a serious agentic trading stack is a three-layer system: CLI tools, MCP servers, and skills
- workflow quality matters more than clicking speed
- explicit execution confirmation is mandatory for risk-critical actions
- GUI can remain a secondary visual aid, but workflow control should stay in the terminal
- Gordon should treat trading software as personal software: the shell, prompts, workflows, and tool stack should become specific to the operator over time
- one terminal session should unify many markets and venues without making the user think in terms of separate apps
- Gordon should work for non-programmers through plain-English intent and strong defaults, even though the underlying system remains programmable

CLIG sharpens a different but equally important layer:

- the full-screen TUI can be custom, but command behavior should still follow familiar CLI conventions
- help, errors, prompts, output streams, and machine-readable modes should feel predictable to humans and agents

### Evangelion influence rule

Evangelion is a style amplifier, not the product skeleton.

Gordon should borrow:

- interlock language
- typographic severity
- alarm semantics
- stateful rails
- transition ritual

Gordon should not borrow:

- fake telemetry
- anime cosplay copy
- nonstop emergency styling
- decorative diagrams with no trading meaning

---

## 6. Terminal Information Architecture

The reset should use a stable shell with multiple focused workspaces.

### Shell zones

1. Global rail
2. Active workspace canvas
3. Shared command bar
4. Optional drawers and overlays

### Global rail

Persistent. Always visible.

Contains:

- mode: `SAFE` / `ARMED`
- active workspace
- active account / venue
- queue counts
- alert counts
- runtime health token
- focus token for the current workspace

Should not contain:

- explanatory prose
- repeated command hints
- route-by-route instructional text

### Workspace canvas

Primary work area.
Each workspace gets its own visual grammar and keyboard ownership model.

### Shared command bar

Always available.

Contains:

- prompt
- inline autocomplete
- contextual command hints
- staged action preview when the workspace wants to seed a command

The command bar should also support a dual-interface model:

- human-facing CLI phrasing and readable previews
- agent-facing structured tool invocation through CLI or MCP behind the scenes

### Overlays and drawers

Only for:

- command palette
- approval review
- symbol jump
- help / shortcuts
- export / share
- compare views

They should not be used for routine reading of primary workspace data.

---

## 7. Gordon Feature Surfaces

These are the product surfaces Gordon should expose.

### Persistent

- active workspace
- current mode
- current thread
- current focus symbol or focus object
- top-level risk posture
- live queue / alert counts

### Semi-persistent

- shortlist
- selected plan
- selected strategy
- current blotter scope
- current watch focus
- current comparison context

### Ephemeral

- live tool activity
- prompt autocomplete
- inline action staging
- streaming line markers
- temporary notices

### Reviewable

- plan tickets
- approvals
- workflow results
- backtest summaries
- systematic validation results
- alert history
- runtime history

### Dangerous

- approvalable live actions
- route-to-broker / route-to-wallet flows
- live execution mode
- funding actions

---

## 8. Workspace Model

There are five primary workspaces.

### 8.1 Desk

Role:

- conversational reasoning
- live steering
- inline approvals
- active tool loop

Primary object:

- transcript

Secondary objects:

- live strip
- compact action log
- inline approval tickets

Data sources:

- `src/app/ChatView.tsx`
- `src/runtime/query/QueryRuntime.ts`
- `src/runtime/session/SessionRuntime.ts`
- `src/app/chatFlow.ts`
- `src/app/presenters/RuntimePresenter.ts`

Should be:

- persistent
- scrollable
- least boxed of all workspaces

Should not become:

- a dashboard
- a substitute for Market / Plan / Lab / Monitor

Keyboard model:

- prompt first
- transcript scrolling
- quick inline approve / deny staging
- open palette
- open symbol jump

### 8.2 Market

Role:

- convert market noise into a shortlist
- keep one symbol in focus while preserving table context

Primary object:

- watchlist / shortlist table

Secondary objects:

- focus symbol dossier
- context rail
- activity log

Data sources:

- `lastResults.scan`
- `lastResults.analysis`
- `lastResults.technicalAnalysis`
- `lastResults.regime`
- market scanner and analysis tools

Should be:

- table-first
- sortable / focusable
- width-adaptive

Should not be:

- a stack of narrative cards

#### Market layout

```text
MARKET  SAFE  queue 1  focus BTCUSDT

[SHORTLIST TABLE..........................] [FOCUS DOSSIER........]
 BTC   setup  score  vol  regime  change    symbol     BTCUSDT
 ETH   setup  score  vol  regime  change    trend      bullish
 SOL   setup  score  vol  regime  change    regime     trend
 ...                                     -> setup      support bounce
                                           levels     S1 / R1 / invalidation

[ACTIVITY LOG............................] [CONTEXT RAIL.........]
 scan  completed  28 markets               rails      exchange · broker
 ta    updated    BTCUSDT 4h               workflow   quick / dd / scan
 whales updated   BTCUSDT                  commands   /scan /analyze /regime
```

Keyboard model:

- `↑/↓` move shortlist row
- `Enter` set focus symbol
- `Tab` move to dossier / activity log
- `/` open slash or command palette
- `f` filter shortlist
- `s` sort
- `d` drill into symbol with staged command

### 8.3 Plan

Role:

- trade review before action
- ticket inspection
- risk and readiness review
- approval and execution posture

Primary object:

- ticket sheet

Secondary objects:

- approval drawer
- risk ladder
- plan book table

Data sources:

- stored `Plan` objects from `src/infra/agents/tools/trading.ts`
- runtime approvals
- portfolio and capital context
- risk kernel posture

Should be:

- review-first
- explicit
- asymmetric

Should not be:

- four equal panels
- chat with finance labels

#### Plan layout

```text
PLAN  ARMED  venue Binance  queue clear  focus BTCUSDT

[ACTIVE TICKET SHEET................................] [APPROVAL DRAWER....]
 symbol      BTCUSDT                                 pending     1
 side        long                                    next        approve a1f2
 strategy    support reclaim                         path        live rails
 entry       84000                                   mode        ARMED
 stop        81000
 targets     87000 / 89500
 size        10% of book
 invalid     lose 81000 on close
 thesis      reclaim after failed breakdown

[RISK LADDER........................................] [PLAN BOOK TABLE....]
 rr          1.5                                     id     sym   state
 reserve     ok                                      ...    ...   ...
 stop dist   3.6%
 max alloc   within limits
 warning     rr below preferred threshold
```

Keyboard model:

- `↑/↓` move ticket / book row selection
- `Enter` focus selected plan
- `a` stage approve for focused approval
- `d` stage deny
- `x` stage preview execution
- `b` toggle book focus
- `c` compare with previous plan revision

### 8.4 Lab

Role:

- systematic research
- strategy development
- playbook review
- backtest and validation comparison

Primary object:

- strategy table / leaderboard

Secondary objects:

- detail pane
- validation timeline
- systematic slate
- experiment queue

Data sources:

- `src/app/commands/strategy.ts`
- `src/backtest/engine.ts`
- `src/infra/systematic/service.ts`
- `src/infra/agents/tools/systematic-tools.ts`
- generated strategies storage
- playbook registry

Should be:

- tabular
- compare-oriented
- good at ranking

Should not be:

- a generic research board

#### Lab layout

```text
LAB  SAFE  strategy 12  generated 5  live-eligible 3

[STRATEGY TABLE...........................] [DETAIL PANE..........]
 id        source      ret   sharpe dd       name       momentum_v3
 mom_v3    generated   18%   1.42   9%       source     generated
 pb_break  playbook    n/a   n/a    n/a      tf         4h / 1d
 mean_r1   built-in    n/a   n/a    n/a      risk       medium
                                           -> status     validated

[VALIDATION TIMELINE......................] [QUEUE / EXPORT.......]
 backtest   complete   BTCUSDT 90d          export   dataset / validation
 optimize   complete   mom_v3               queue    2 experiments
 decay      warn       mom_v3               next     /strategy compare
```

Keyboard model:

- `↑/↓` move strategy row
- `Enter` select strategy
- `c` stage compare
- `b` stage backtest
- `o` stage optimize
- `e` export artifact
- `v` validation detail

### 8.5 Monitor

Role:

- supervise live state
- inspect positions, orders, account exposure, alerts, runtime health

Primary object:

- positions / orders blotter

Secondary objects:

- alert feed
- runtime rail
- book summary strip

Data sources:

- portfolio summaries
- positions and orders snapshots
- runtime inspector
- bridge and background task state
- monitor cycle signals

Should be:

- ledger-first
- compact
- stable under refresh

Should not be:

- narrative
- verbose

#### Monitor layout

```text
MONITOR  ARMED  account main  alerts 2  runtime healthy

[BOOK STRIP.......................................................]
 book  125k   cash  31k   pnl +2.3k   exposure 58%   open pos 4

[BLOTTER TABLE............................] [ALERT FEED...........]
 sym    side  qty   pnl    age   state     BTC    stop near
 BTC    long  ...   +540   91m   open      SOL    order stale
 ETH    long  ...   -120   42m   open
 SOL    long  ...   +180   12m   order

[RUNTIME RAIL.............................]
 queue 0   approvals 0   plugins ok   bridge 0   background 0
```

Keyboard model:

- `↑/↓` move blotter row
- `Enter` focus symbol / position
- `o` open orders scope
- `p` open portfolio scope
- `r` open runtime scope
- `l` open alert log

---

## 9. Cross-Cutting Feature Plan

### 9.1 Command system

The current slash system is strong but too invisible.

Keep:

- slash commands
- aliases
- staged prompt seeding

Add:

- command palette overlay
- workspace-local action staging
- symbol jump overlay
- object-aware action staging

The user should be able to operate Gordon via:

- direct prompt
- slash
- row focus + hotkeys
- command palette

The command layer should also adopt a Pi-like principle:

- the shared command bar is not just a text box
- it is a replaceable control surface

That means Gordon should support command-bar replacement slots for:

- approval review
- setup and credential prompts
- export dialogs
- compare flows
- structured user follow-up forms

It should also preserve a CLI Trader principle:

- the operator can stay in one conversation while the system spans many markets, venues, and tool layers
- the shell should make cross-venue operation feel like one desk, not five apps

And it should adopt a CLIG principle:

- the full-screen workspace model can be unique
- but command semantics must stay boring, consistent, and reliable

### 9.1.1 CLI contract for Gordon

The TUI is not exempt from CLI discipline.
Every Gordon command surface should follow these rules where applicable.

#### Help and discoverability

- support `-h` and `--help` on real CLI entrypoints
- keep help concise and scannable
- lead with examples for common workflows
- make top-level help point to web docs and deeper guides when needed
- suggest corrections for typos and near-miss commands

#### Output modes

- default human output should be concise and high-signal
- support `--json` for machine-readable output on non-TUI command surfaces
- support `--plain` where colored or decorated output would interfere with scripts
- support `-q` / `--quiet` to suppress non-essential status output
- send data to stdout and status/progress/errors to stderr

#### Safety and confirmations

- support `--dry-run` for mutating or dangerous actions
- support `--yes` for explicit non-interactive confirmation where safe
- support `--no-input` to disable prompts in automation contexts
- only prompt interactively when stdin is a TTY
- for live trading routes, preserve the stronger Gordon rule: explicit approval or execution phrase before side effects

#### Flags and arguments

- prefer clear flags over ambiguous positional arguments
- provide long-form flags everywhere; add short flags only for frequent actions
- keep flag behavior order-independent
- use standard names where possible: `--help`, `--json`, `--plain`, `--quiet`, `--dry-run`, `--yes`, `--no-input`
- allow `-` for stdin/stdout on export and import style commands where it makes sense

#### Errors and exit behavior

- rewrite low-level errors into operator-readable messages
- include one actionable hint whenever possible
- use non-zero exit codes on failure
- document important exit-code classes for machine consumers
- keep repeated low-level trace noise out of the default operator path

#### TTY and rendering behavior

- detect TTY before color, animation, or interactive behavior
- no raw ANSI junk in non-TTY output
- progress indicators belong on stderr
- long-running TUI work should provide progress without corrupting machine output modes

#### Configuration and precedence

- follow precedence: flags > env vars > project config > user config > system config
- make risky environment-sensitive behavior explicit
- keep secrets out of flags when possible

#### Composability

- exported artifacts should be script-friendly
- commands should be pipeline-safe where feasible
- machine-readable output should be deterministic and stable enough for agents to depend on
- interactive REPL behavior and explicit subcommands should share the same command grammar where possible
- command discovery should be available from both the conversational prompt path and explicit command trees

#### Agent-facing command contract

Gordon should borrow the useful parts of `CLI-Anything` without copying its product form.

That means:

- keep both REPL-style and explicit subcommand entrypaths available
- make command trees discoverable without collapsing the product into a raw help maze
- prefer stable machine-readable response shapes for agent-facing non-TUI flows
- let the human operator stay in the TUI while agents can still call equivalent command surfaces directly
- ensure setup, diagnostics, export, and automation flows are callable as proper commands outside the fullscreen shell

### 9.2 Approvals and safety

Approvals are core product.

Approval features should include:

- inline ticket in transcript when blocking
- approval drawer in Plan
- approval desk in Desk / Monitor
- short IDs
- explicit persist scope for approval rules
- clear distinction between:
  - approve once
  - approve with rule
  - deny with reason
- explicit execution-language boundary for dangerous actions
  - support a hard confirmation phrase or action equivalent to `EXECUTE` for live routes where appropriate

Safety states must always show:

- `SAFE` / `ARMED`
- route availability
- live vs paper execution status
- approval queue count

### 9.3 Workflow execution

Workflows in `workflow.ts` should be elevated into first-class visual objects.

Need:

- workflow run row
- step timeline
- current step token
- durable review card after completion

This affects:

- quick
- due diligence
- backtest-cycle
- web-dd
- web-monitor

### 9.4 Strategy and systematic lifecycle

Lab must expose:

- strategy origin
- validation state
- backtest summary
- systematic lifecycle events
- decay and bias diagnostics
- promotion eligibility
- exportable artifacts

### 9.5 Monitoring and alerts

Monitor must expose:

- current book
- open positions
- open orders
- alert severity
- stale order / stop proximity / position age
- runtime degradation
- plugin attention

### 9.6 Plugin and MCP lifecycle

Plugin state should be treated as operational context, not a diagnostics appendix.

Need:

- plugin attention badge in Monitor / Desk
- reload-needed state
- degraded plugin list
- routed commands count
- current MCP availability state

### 9.7 Session memory and restore

Persist:

- last active workspace
- focus symbol
- selected plan
- selected strategy
- blotter scope
- last shortlist
- last plan focus
- last workflow result

Do not rely on transcript alone to restore user context.

Pi is a strong reference here conceptually:

- explicit session history
- branch / fork / revisit behavior
- strong operator awareness of where they are in the session

Gordon should translate that into trading-native recoverability:

- revisit prior plan states
- revisit prior shortlist states
- revisit workflow checkpoints
- branch from a prior ticket or research state without losing the current one

### 9.8 Onboarding and setup

First-run should map to the product loop:

1. identity
2. choose operating posture
3. connect rails
4. pick first workflow
5. land in the right workspace

QuickStart should no longer feel separate from opening the desk.

Onboarding should assume the user may be non-technical.

That means:

- plain-English prompts and examples first
- one-tool starter path
- clear guardrail template before any live route
- visible distinction between analysis-only mode and execution-capable mode

### 9.9 Exports and handoff

Users should be able to export:

- plan
- workflow summary
- strategy result
- systematic artifact
- blotter slice

Possible formats:

- markdown
- csv
- json

### 9.10 Agent-facing ecosystem contract

Gordon should explicitly treat agent accessibility as a product requirement.

For Gordon-owned surfaces, prefer:

- slash and direct CLI entrypoints
- MCP-exposed capabilities where appropriate
- markdown exports for human + agent reuse
- stable structured output for scripting and chaining

For external tools Gordon relies on, prefer:

- deterministic binaries
- single-command health verification
- obvious exit-code behavior
- clear stderr instead of dependency traceback noise

This matters especially for:

- voice / OCR / inference sidecars
- finance or market helper CLIs
- bridge and export tools
- scheduled workflow runners

The heuristic is simple:

- if an agent cannot install it, verify it, and call it with high confidence, it is not a good dependency for Gordon's operating loop

### 9.11 Startup, onboarding, and transition motion

Gordon should have one distinctive motion language, but only where motion improves identity or state comprehension.

Allowed motion surfaces:

- startup desk opening
- onboarding identity reveal
- long-running scan / backtest / inference wait states
- major mode transitions such as `SAFE` -> `ARMED`

The primary motion reference is the donut-math style ASCII render loop, but adapted into a Gordon-specific motif:

- not a literal donut
- instead an orbital ring, liquidity halo, rotating market globe, or execution field
- brightness-mapped ASCII or glyph shading
- short, deterministic, terminal-native motion

This should become a named Gordon primitive:

- `OrbitalBoot`

Rules:

- startup motion should be brief and skippable
- steady-state workspaces should not carry ambient decorative motion
- motion must reuse stable geometry and avoid shell reflow
- the animation should signal "desk powering on", not "retro demo scene"

### 9.12 Product identity in use

Gordon should feel like three things at once:

- a research lab
- a trading desk
- an analytics platform

The important detail is composability:

- research should flow into tickets
- tickets should flow into approvals
- approvals should flow into execution and monitoring

without making the user leave the terminal or rebuild context manually.

---

## 10. Visual Grammar

The current generic board/card language should be retired as the primary grammar for non-desk workspaces.

### Primary primitives to build

- `SummaryStrip`
- `WorkspaceTabs`
- `CommandBar`
- `InterlockRail`
- `DataTable`
- `BlotterTable`
- `DetailPane`
- `TicketSheet`
- `ApprovalDrawer`
- `ActivityLog`
- `MiniChartCell`
- `StatusToken`
- `ScopeTabs`
- `OrbitalBoot`

### Primitives to demote

- generic `DeskPanel`
- generic `TicketCard`
- generic stacked row boards
- transcript-style framing for non-transcript data

### Visual rules

- one dominant object per workspace
- one supporting pane
- one narrow rail or drawer
- avoid more than two major scroll regions
- use tables where the data is tabular
- use sheets where the object is reviewable
- use logs for sequence, not for state

### Interlock grammar

The persistent visual language should borrow Evangelion's discipline, not its cosplay.

Use:

- compressed uppercase section labels for machine state
- short, high-authority verbs and nouns
- segmented rails
- explicit warning tiers
- asymmetry when one object truly matters more

Do not use:

- decorative caution stripes with no meaning
- random technical numbers
- blinking red for normal state
- pseudo-military copy detached from trading actions

### Color and state semantics

- red only for danger, blocked execution, breached risk, or hard degradation
- amber for review, degraded feeds, stale orders, route attention, or incomplete setup
- green for confirmed readiness, safe completion, or active protection
- white / warm gray for primary reading surfaces
- muted secondary tones for labels and supporting rails

### Typography and label system

- labels should read like interlocks, not help text
- headings should be short enough to scan in one fixation
- persistent rails should prefer tokens over sentences
- the command bar should stay plainspoken even when the surrounding shell is more theatrical

### Motion grammar

Motion should feel computational, terminal-native, and expensive.

Allowed:

- orbital startup / onboarding sequence
- compact scan / backtest / inference loaders
- subtle state transitions when an approval drawer opens or a route arms

Banned:

- ambient background motion in steady-state workspaces
- loading spinners everywhere
- decorative flicker
- mode changes that shift layout aggressively

---

## 11. Keyboard Model

### Global

- `1-5` workspace switch
- `[` / `]` cycle workspace
- `Ctrl+K` command palette
- `/` slash and prompt
- `Esc` close overlay or stop active run

### Workspace-local

Each workspace owns:

- row navigation
- detail focus
- hot actions
- overlay entry points

Global shortcuts should not hijack local flows unless clearly higher priority.

### Overlay-local

Overlays should trap focus and own keys until dismissed.

Need overlays for:

- command palette
- approval review
- compare
- symbol jump
- help

---

## 12. Render And Stability Plan

Ink should be used harder before considering a new engine.

### Use more of Ink for

- `Static` completed activity above live panes
- focused pane ownership
- frozen detached scroll regions
- measured table widths
- more deterministic live updates

### Stability rules

- transcript should not rerender because a monitor token changed
- off-live-edge reads should freeze the visible slice
- workspace panes should redraw independently where possible
- loading states should reuse stable geometry

### Migration rule

Only consider OpenTUI or Rezi if:

- Ink cannot meet stability expectations after the architecture reset
- or if pane-local focus and virtualization remain too expensive to maintain

## 13. Framework Decision

Additional framework references reviewed:

- `https://github.com/vadimdemedes/ink`
- `https://github.com/vadimdemedes/ink-ui`
- `https://github.com/charmbracelet/gum`
- `https://github.com/charmbracelet/glow`
- `https://github.com/charmbracelet/lipgloss`
- `https://github.com/charmbracelet/bubbletea`
- `https://github.com/charmbracelet/bubbles`
- `https://github.com/charmbracelet/ultraviolet`
- `https://github.com/charmbracelet/colorprofile`
- `https://github.com/nberlette/tui`
- `https://github.com/semos-labs/glyph`
- `https://github.com/badlogic/pi-mono`
- `https://hatchet.run/blog/tuis-are-easy-now`
- `https://github.com/HKUDS/CLI-Anything`
- `https://github.com/second-state/fintool`
- Evangelion interface / screen-graphics studies
- `https://www.a1k0n.net/2011/07/20/donut-math.html`

### Ink

Ink remains the correct primary runtime for Gordon.

The useful parts to lean on harder are:

- `useInput()` for workspace-local key ownership
- `usePaste()` for reliable pasted prompts and multi-line input handling
- `useFocus()` and `useFocusManager()` for real pane-local focus instead of global shortcut collisions
- `<Static>` for completed actions and logs above the live workspace
- `measureElement()` for width-aware table schemas and responsive detail panes
- `useStdin()` and raw-mode support for safer input fallbacks

These are not optional polish items.
They are the correct path to make Gordon feel less like a generic CLI shell and more like a real terminal application.

### Ink UI

`@inkjs/ui` is useful, but should be used selectively.

What it is good for:

- `TextInput`
- `PasswordInput`
- `Select`
- `MultiSelect`
- `Spinner`
- `ProgressBar`
- theme extension through `ThemeProvider`

Where Gordon should use it:

- setup flows
- config forms
- command palette
- approval and export overlays
- credential / key / email / routing prompts

Where Gordon should not let it define the product:

- primary `Market` tables
- `Plan` ticket sheet
- `Monitor` blotter
- `Lab` leaderboard

Reason:

Ink UI provides polished commodity controls, but if it becomes the dominant grammar, Gordon risks looking like a generic developer CLI instead of a trading-native terminal.

### Charmbracelet stack

The Charmbracelet stack should influence Gordon heavily, but selectively and by layer.

#### `gum`

Use as a reference for:

- setup and onboarding prompts
- lightweight confirmations
- credential and environment bootstrap flows
- temporary operator prompts outside the main cockpit

Do not use it as the primary grammar for the fullscreen shell.

#### `glow`

Use as a reference for:

- markdown playbooks
- research notes
- export previews
- help, runbook, and report rendering inside overlays or side panes

This strengthens the case for a dedicated markdown/document primitive inside Gordon rather than treating longform content as transcript text.

#### `lipgloss`

Use as a reference for:

- typography hierarchy
- spacing rhythm
- border restraint
- adaptive layout discipline
- consistent token styling

This is a design-system reference, not a reason to move Gordon away from React / Ink.

#### `bubbletea` and `bubbles`

Use as references for:

- explicit state machines per workspace
- table, list, help, and viewport behavior
- pane-local keymaps
- model/view/update clarity
- deterministic workspace-local interaction

These are especially relevant to `Market`, `Monitor`, and `Lab`, where the user should feel focused list/detail control rather than generic component stacking.

#### `ultraviolet`

Use as a render-ambition reference for:

- cell-diffing discipline
- atomic redraw expectations
- stable geometry under rapid updates
- motion without terminal corruption

This raises the bar for how Gordon should use Ink rather than introducing a new runtime today.

#### `colorprofile`

Use as the reference for terminal capability handling:

- degrade color safely
- avoid unreadable palettes on weaker terminals
- adapt warnings, emphasis, and semantic color tokens to actual terminal support
- keep Gordon legible in low-color and no-color environments

The net result:

- Charmbracelet is not a migration target
- it is a strong reference family for prompt flows, markdown surfaces, layout discipline, state machines, redraw quality, and terminal compatibility

### nberlette/tui

`nberlette/tui` is interesting for different reasons:

- reactive signals / computed model
- explicit keyboard and mouse handling
- high refresh loop examples
- lightweight cross-runtime positioning model

What it contributes conceptually:

- more aggressive real-time pane thinking
- stronger component-local reactivity mindset
- future mouse support ideas for drag / resize / selection experiments

What it does not change right now:

- Gordon should not migrate away from Ink in this tranche

Reason:

- Gordon already has substantial Ink investment
- the reset problem is primarily product architecture and terminal primitive selection
- an engine rewrite now would increase risk before we have proven the new workspace model

### Glyph

`Glyph` is the strongest alternative-engine reference reviewed so far.

Useful traits:

- full-screen keyboard-driven React TUI runtime
- focus scopes, modal trapping, and jump navigation
- richer built-in component surface than Ink
- `List`, `Menu`, `ScrollView`, dialogs, toasts, and portals
- character-level diffing via double-buffered framebuffer
- explicit support expectations for large scrollable panes

What this means for Gordon:

- it validates the direction toward true pane-local workspaces instead of generic boards
- it validates heavy use of focus scopes and modal review flows
- it raises the bar for what Gordon should demand from Ink before considering migration

What it changes right now:

- Gordon should still stay on Ink for this reset tranche
- but the reset should borrow Glyph’s product lessons:
  - focus scopes
  - modal trapping
  - quick-jump style navigation
  - large-list virtualization expectations
  - character-stable redraw discipline

What it changes later:

- if Ink still feels structurally too weak after the workspace reset, `Glyph` becomes the first serious migration candidate ahead of lower-level alternatives

### Pi / pi-tui

Pi is not primarily a style reference for Gordon.
It is an interaction-architecture reference.

Useful traits from `pi-mono` and `@mariozechner/pi-tui`:

- differential rendering and synchronized output aimed at flicker-free updates
- a full-screen terminal structure with header, message area, editor, and footer
- overlays as first-class UI, not bolt-on panels
- extension-owned UI that can add widgets, status lines, footers, and overlays
- editor replacement with structured UI when the workflow needs it
- explicit session tree / fork / compact mental model

What Gordon should borrow:

- treat the command bar as a replaceable control plane, not just a prompt
- support overlay-owned structured input flows
- treat session history as an operator navigation problem, not just transcript persistence
- demand higher redraw stability and atomic updates from the render layer

What Gordon should not borrow:

- coding-agent product metaphors
- repo / file / diff-centric interaction assumptions
- Pi’s minimal harness identity

What this changes for Gordon:

- Pi becomes the strongest reference for command-bar replacement and operator-flow architecture
- it strengthens the case for approval overlays, setup dialogs, compare dialogs, and future session-tree navigation
- it also raises the bar for render stability expectations inside Ink

### Hatchet development loop

Hatchet's "TUIs are easy now" article is not a product-shape reference.
It is an implementation-discipline reference.

What Gordon should take from it:

- build the fullscreen shell as a small set of deterministic views
- iterate visually and frequently instead of overabstracting before seeing the terminal
- validate layouts and copy in real terminal sessions, not only in tests
- treat capture / tmux / screenshot review as part of the design loop
- keep view modules small enough that replacing a surface is cheap

This matters because Gordon is being rebuilt from scratch; the implementation loop should stay reference-driven and terminal-observed, not purely theoretical.

### CLI-Anything

`CLI-Anything` is not a UI reference.
It is a command-contract reference.

What Gordon should take from it:

- keep a real CLI surface outside the fullscreen TUI
- support agent-friendly command discovery and structured outputs
- preserve parity between interactive and scriptable paths where practical
- let automation invoke the same capability families without the cockpit being mandatory

What Gordon should avoid:

- turning the product into a raw command tree with no strong cockpit identity
- weakening the fullscreen trading terminal just to satisfy generic CLI symmetry

### Final framework stance

- keep Ink as the primary renderer
- use Ink features more deeply
- adopt Ink UI only for commodity operator controls and overlays
- use Charmbracelet projects as reference libraries for prompt flows, markdown panes, layout rules, state machines, render ambition, and terminal color handling
- keep `nberlette/tui` as a future reference, not the current implementation target
- treat `Glyph` as the primary alternative-engine benchmark if Ink still underdelivers after the reset
- treat Pi as the primary interaction-architecture benchmark for overlays, command-bar replacement, and session-tree style recoverability
- treat Hatchet as the implementation-discipline reference for how the rebuild is executed and visually validated
- treat `CLI-Anything` as the reference for agent-friendly command contracts and REPL/subcommand duality
- treat agent-friendly finance CLIs such as `fintool` as ecosystem-pattern references, not as visual references
- treat Evangelion screen graphics as the reference for interlock grammar and state signaling, not layout skeleton
- treat donut-math style ASCII rendering as the reference for startup / transition motion, not persistent workspace chrome

---

## 14. Implementation Program

This should be built in phases.

### Phase 0: lock the contract

- this document
- update older redesign docs to point here
- stop patching the current generic board system

### Phase 1: build the new primitives

Add:

- `DataTable`
- `BlotterTable`
- `DetailPane`
- `TicketSheet`
- `ApprovalDrawer`
- `SummaryStrip`
- `ActivityLog`
- `WorkspaceTabs`
- `CommandBar`
- `InterlockRail`

Do not build new workspaces on top of the old card model.

### Phase 2: Market reset

Replace generic Market board with:

- shortlist table
- symbol dossier
- context rail
- activity log

### Phase 3: Plan reset

Replace generic Plan board with:

- ticket sheet
- approval drawer
- risk ladder
- plan book table

### Phase 4: Monitor reset

Replace generic Monitor board with:

- book strip
- positions/orders blotter
- alert feed
- runtime rail

### Phase 5: Lab reset

Replace generic Lab board with:

- strategy leaderboard table
- detail pane
- validation timeline
- systematic slate
- export queue

### Phase 6: Desk integration

Keep transcript primary, but:

- reduce shell chrome further
- move completed tool runs into activity log behavior
- keep approvals inline and consistent with Plan
- add compact command bar and overlay polish

### Phase 7: Overlays and operator flows

Build:

- command palette
- symbol jump
- compare overlay
- approval review overlay
- export overlay
- markdown / runbook / research overlay
- setup and environment prompt flows

### Phase 8: Perf and stability

- transcript freezing refinements
- scroll isolation
- table redraw tuning
- log compaction
- terminal capability-aware color and emphasis degradation
- visual validation in real terminal sessions before each shell tranche closes

### Phase 9: Identity motion and onboarding polish

- implement `OrbitalBoot`
- fold startup identity and onboarding into one coherent desk-opening sequence
- add compact state-transition loaders for scans / backtests / inference
- keep all motion behind strict geometry-stability rules

---

## 15. File-Level Roadmap

### Files to retire or demote

- `src/app/screens/WorkspaceBoard.tsx`
- large parts of `src/app/workspaceViewModels.ts` in its current generic-card form

### Files to keep but refactor heavily

- `src/app/App.tsx`
- `src/app/screens/ChatScreen.tsx`
- `src/app/ChatInput.tsx`
- `src/app/StatusBar.tsx`
- `src/app/components/RuntimeInspector.tsx`
- `src/app/state/AppStore.ts`
- `src/app/workspaces.ts`

### New likely files

- `src/app/components/tables/DataTable.tsx`
- `src/app/components/tables/BlotterTable.tsx`
- `src/app/components/layout/SummaryStrip.tsx`
- `src/app/components/layout/DetailPane.tsx`
- `src/app/components/layout/CommandBar.tsx`
- `src/app/components/layout/WorkspaceTabs.tsx`
- `src/app/components/layout/InterlockRail.tsx`
- `src/app/components/review/TicketSheet.tsx`
- `src/app/components/review/ApprovalDrawer.tsx`
- `src/app/components/logs/ActivityLog.tsx`
- `src/app/components/motion/OrbitalBoot.tsx`
- `src/app/screens/MarketWorkspace.tsx`
- `src/app/screens/PlanWorkspace.tsx`
- `src/app/screens/LabWorkspace.tsx`
- `src/app/screens/MonitorWorkspace.tsx`
- `src/app/marketViewModel.ts`
- `src/app/planViewModel.ts`
- `src/app/labViewModel.ts`
- `src/app/monitorViewModel.ts`

---

## 16. V1 Boundaries

V1 of the reset should include:

- dedicated Market, Plan, Monitor, and Lab renderers
- table and ticket primitives
- command palette
- approval drawer
- focused pane keyboard model
- workspace-specific detail panes

V1 should defer:

- elaborate ambient animations
- full historical multi-tab workspace management
- cross-workspace split-screen custom layouts
- engine migration away from Ink

V1 may include:

- a single `OrbitalBoot` startup sequence if it does not destabilize render performance

---

## 17. Anti-Goals

Do not:

- build another generic board-of-cards system
- treat transcript as the universal container
- overload the top rail with instructions
- repeat the same actions in every pane
- create fake dashboard chrome
- imitate coding-agent metaphors directly
- sacrifice speed and clarity for decorative styling

---

## 18. Immediate Next Tranche

The next correct build step is:

1. stop extending `WorkspaceBoard.tsx`
2. build `DataTable`, `DetailPane`, `TicketSheet`, and `ApprovalDrawer`
3. replace `Market` with a dedicated table + dossier renderer
4. replace `Plan` with a dedicated ticket + approval renderer

That is the first point where Gordon becomes structurally trading-first rather than cosmetically trading-themed.
