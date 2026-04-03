# Gordon TUI V2 Design Spec

This document is the new app-layer design contract for Gordon.

It replaces the broad multi-reference TUI planning direction with a narrower, more disciplined model.

Use this document first for cockpit, interaction, and visual decisions.

Keep these older documents as supporting references only:

- [docs/gordon-tui-master-plan.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-tui-master-plan.md)
- [docs/gordon-feature-census.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-feature-census.md)
- [docs/gordon-design-traceability-matrix.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-design-traceability-matrix.md)

---

## 1. Why V1 Failed

The previous redesign direction was too broad.

It mixed too many authorities at once:

- Ink behavior
- Charm stack ideas
- Claude Code shell behavior
- Codex shell behavior
- `ticker` data presentation
- CLI Trader workflow
- Bloomberg seriousness
- Evangelion interface drama
- Pi / Glyph / Rezi / OpenTUI rendering ambition

That produced a planning system with too many valid answers.

The result was predictable:

- too many top-level sections behaving like peer apps
- too many surface types competing for attention
- too much UI pasted onto the screen at once
- too little distinction between conversational work and data-heavy work
- too much card/panel thinking
- no single grammar strong enough to unify the product

V2 fixes that by freezing the stack, freezing the authorities, and simplifying the product model.

---

## 2. Product Classification

Using the CLI design framework, Gordon is:

- Primary role: sessionful operator workstation for AI-assisted trading
- Primary user: human trader/operator supervising an AI system
- Primary interaction form: mixed
  - conversation-first
  - keyboard-first inspector
  - fullscreen overlays for dense or dangerous work
- Statefulness: sessionful and resumable
- Risk profile: high
- Secondary surfaces:
  - machine-readable CLI output
  - exports
  - runtime diagnostics
  - setup/configuration
  - plugin and connector inventory

This classification matters.

Gordon is not:

- a generic chatbot with finance widgets
- five unrelated full-screen apps inside one terminal
- a coding-agent shell with trading labels
- a dashboard compressed into ANSI boxes

---

## 3. Frozen Design Authorities

V2 uses a small set of primary authorities.

### Primary authorities

- Workflow model: CLI Trader
- Data presentation model: `ticker`
- Shell behavior model: Claude Code / Codex class conversational shell behavior
- Atmosphere model: Bloomberg seriousness with restrained Evangelion interlock grammar
- TUI stack model: Rezi-first TypeScript-native cockpit discipline

### Secondary references

These can inform edge cases or engineering taste, but they do not define the product grammar:

- Pi / pi-tui
- Glyph
- OpenTUI
- Ink
- Charm stack discipline from the Hatchet article
- `k9s`
- `lazygit`
- `VisiData`
- `hledger-ui`
- `posting`
- `btop`

### Banned design behavior

Do not use these as active design input:

- random new TUI references for each screen
- generic card grids
- coding-agent file/repo metaphors
- crypto-casino color language
- web-dashboard layout logic
- theatrical sci-fi decoration with no trading meaning

---

## 4. Frozen Stack

V2 assumes a single coherent TUI stack for the operator client:

- `Rezi`
- TypeScript
- Bun / Node runtime
- native-backed rendering through Rezi's engine
- Rezi-native tables, lists, overlays, panes, focus, and animation

And a strict development loop:

- fullscreen TUI only
- capture-pane visual review
- deterministic layout contracts
- terminal capability detection
- no mixed rendering philosophy

The existing Gordon backend remains valuable:

- runtime/session infrastructure
- approvals
- permissions
- orchestration
- tools
- strategy/backtest/systematic logic
- brokers/exchanges/rails
- storage and resume

But the visible cockpit is designed as a new TypeScript-native client layer with its own rules.

### Stack consequence

Do not build Gordon V2 like an improvised React app.
Do not split the product across Go and TypeScript.
Do not run two UI runtimes in parallel.

Build it like a deliberate terminal workstation:

- explicit state model
- explicit focused pane
- explicit table/list behaviors
- explicit overlays
- explicit rendering discipline

### Runtime choice

V2 explicitly rejects a cross-language Go/Charm bridge as the primary cockpit path.

Reason:

- Gordon's backend is already TypeScript-native
- Gordon benefits from staying in one language/runtime family
- Rezi offers a stronger fullscreen TUI architecture than Ink while staying TS-native
- a bridge architecture adds product and debugging complexity too early

---

## 5. Core Thesis

Gordon should be a conversation-first trading cockpit.

The conversation stays central.
Structured data stays stable.
Dense workflows open as inspectors or overlays.

The right product shape is:

- conversation orchestrates
- inspectors explain
- overlays operate

This is the key difference from the failed model.

We do not want:

- conversation everywhere
- panels everywhere
- five separate apps

We want:

- one shell
- one active inspector
- one command bar
- a small number of fullscreen data/review surfaces

---

## 6. Shell Model

### The shell is always present

Gordon should always feel like one operating environment.

The stable shell consists of:

1. `InterlockStrip`
2. `TranscriptPane`
3. `InspectorPane`
4. `LiveRail`
5. `CommandBar`

### Layout

Default layout:

- top: `InterlockStrip`
- left: `TranscriptPane`
- right: `InspectorPane`
- bottom: `LiveRail`
- very bottom: `CommandBar`

Fullscreen overlays may temporarily take over the center, but the shell identity should remain obvious.

### Top-level lens model

`1-5` still exist, but they do not switch into separate apps.

They switch the active inspector lens:

- `1 Desk`
- `2 Market`
- `3 Plan`
- `4 Lab`
- `5 Monitor`

The transcript remains anchored.

This is a lens model, not a page model.

---

## 7. Surface Ownership

One of the biggest V1 mistakes was not deciding what belongs where.

V2 fixes that explicitly.

### Chat-native

These belong in the transcript:

- intent capture
- reasoning
- trade thesis discussion
- clarifying questions
- approval prompts
- concise summaries
- next actions
- session continuity
- workflow narration

### Inspector-native

These belong in the right-hand inspector:

- active symbol dossier
- active trade ticket
- active strategy detail
- active runtime/portfolio detail
- compact market context
- compact book context
- focused review object

### Overlay-native

These belong in fullscreen or large overlays:

- screeners
- order books
- positions blotters
- orders blotters
- compare matrices
- backtest result tables
- strategy leaderboards
- document/runbook rendering
- setup/config flows
- approval review for dangerous actions

### Why not everything in chat

Chat is linear.
Trading data is comparative.

Anything requiring:

- row scanning
- stable columns
- row focus
- sorting
- repeated refresh
- side-by-side comparison

should not be trapped in transcript blocks.

---

## 8. Gordon Lenses

These are not five separate products.
They are five views into one operating system.

### 8.1 Desk lens

Desk is the default lens.

It owns:

- transcript
- queued work
- active run state
- inline approval prompts
- compact activity log
- thread/session continuity

Desk should feel calm, clear, and trustworthy.

It is the anchor, not a dumping ground.

### 8.2 Market lens

Market is the live discovery and context lens.

It owns:

- scan shortlist
- trending / movers tables
- symbol focus
- regime context
- flow / liquidation / whale views
- chart and market structure context
- pair and correlation comparison

Nested Market sections:

- `Screener`
- `Dossier`
- `Flows`
- `Orderbook`
- `Compare`

Market’s primary visual object is a `WatchTable`.

### 8.3 Plan lens

Plan is the review and execution lens.

It owns:

- active ticket
- risk ladder
- execution preview
- approvals
- recent tickets
- funding / venue / rail context

Nested Plan sections:

- `Ticket`
- `Risk`
- `Preview`
- `Approvals`
- `History`

Plan’s primary visual object is a `TicketSheet`.

### 8.4 Lab lens

Lab is the research and strategy lens.

It owns:

- strategy leaderboard
- generated strategy inventory
- playbooks
- backtests
- experiments
- optimization results
- systematic datasets and validation

Nested Lab sections:

- `Bench`
- `Compare`
- `Backtests`
- `Experiments`
- `Datasets`

Lab’s primary visual object is a `CompareMatrix` or ranked `WatchTable`, depending on context.

### 8.5 Monitor lens

Monitor is the supervision lens.

It owns:

- portfolio summary
- positions
- orders
- alerts
- runtime state
- bridge/plugin health
- audit and event log

Nested Monitor sections:

- `Blotter`
- `Orders`
- `Alerts`
- `Runtime`
- `Audit`

Monitor’s primary visual object is a `BlotterTable`.

---

## 9. Primitive Library

V2 uses a small number of strong primitives.

### Primary primitives

- `TranscriptPane`
- `InspectorPane`
- `CommandBar`
- `InterlockStrip`
- `LiveRail`
- `WatchTable`
- `BlotterTable`
- `OrderBookLadder`
- `TicketSheet`
- `CompareMatrix`
- `DetailPane`
- `ReviewDrawer`
- `EventLog`
- `MarkdownOverlay`

### Native ticker-derived components

Gordon should not embed `ticker` as a dependency or wrapper.

Instead, Gordon should build native TypeScript/Rezi components inspired by `ticker`'s presentation discipline:

- `WatchTable`
- `BlotterTable`
- `OrderBookLadder`
- `CompareMatrix`
- `MiniChartCell`

These should be Gordon-owned components with Gordon data contracts, Gordon keybindings, Gordon overlays, and Gordon styling.

### Rules

- No generic cards.
- No arbitrary panel-of-panel nesting.
- No box-first composition.
- Every primitive must have a clear data contract.

### Primitive intent

`WatchTable`
- top movers
- scans
- shortlist
- strategy inventories

`BlotterTable`
- positions
- orders
- fills
- exposure

`OrderBookLadder`
- depth
- imbalance
- price ladder
- liquidity

`TicketSheet`
- thesis
- entry
- stop
- targets
- size
- invalidation
- venue
- review state

`CompareMatrix`
- backtests
- strategies
- datasets
- regimes

`DetailPane`
- focused explanation
- metrics
- reasoning
- compact charts
- structured context

`EventLog`
- approvals
- fills
- alerts
- runtime actions
- workflow steps

---

## 10. Table And Data Rules

This is where Gordon should feel closer to `ticker` and Excel than to chat bubbles.

### Table behavior

Tables must support:

- stable columns
- numeric alignment
- right-aligned prices and percentages
- abbreviated but consistent headers
- row focus
- row expansion into `DetailPane`
- deterministic truncation
- keyboard sort/filter/jump

### Table styling

Tables should look like instruments, not widgets.

Use:

- hard alignment
- compact row height
- restrained separators
- clear active row treatment
- sparklines only when useful
- grouped summary rows where appropriate

Do not use:

- oversized borders
- padded cards around tables
- decorative labels that repeat column meaning

### Required data-heavy overlays

The following must use dedicated overlays or fullscreen panes:

- market screener
- order book
- positions blotter
- open orders
- strategy comparison
- backtest results
- runbook / markdown documents

### Ticker influence

The `ticker` reference is about:

- stable column layouts
- right-aligned numbers
- compact market scanning
- disciplined use of small charts
- dense visual comparison

It is not a request to make Gordon look like a cloned crypto dashboard.

---

## 11. Conversation Model

The best coding agents are conversational first.
Gordon should keep that property.

### Gordon’s conversational contract

The user should be able to say:

- "show me the best BTC and SOL mean reversion setups"
- "build me a swing long on ETH with 1% account risk"
- "compare my top generated strategies against built-ins"
- "show open risk and any decaying strategies"

And Gordon should:

1. respond conversationally
2. open or update the correct inspector
3. escalate to an overlay only when the task becomes dense or dangerous

### The command bar is a control plane

The command bar is not just a textbox.

It should support:

- natural language
- explicit slash commands
- staged actions
- command hints
- queued work
- contextual suggestions

But it should not become the only control surface.

### Inline vs staged vs committed

Three modes matter:

- `Discuss`
  - reasoning only
- `Stage`
  - prepare a ticket, filter, or review object
- `Commit`
  - approve / execute / persist

The shell should make that state obvious.

---

## 12. Overlay Model

Overlays are not decoration.
They are operational surfaces.

### Core overlays

- `CommandDeck`
- `SymbolJump`
- `MarketScreener`
- `OrderBook`
- `Blotter`
- `StrategyCompare`
- `ReviewDesk`
- `MarkdownOverlay`
- `SetupFlow`

### Overlay rules

- overlays open for density or danger
- overlays should not exist for every tiny action
- overlays should preserve context
- escape should back out cleanly
- return should restore the prior shell state

### Dangerous actions

Execution, funding, rail movement, and certain runtime approvals must use a stronger review surface than inline chat alone.

---

## 13. Visual Grammar

### Palette

Primary palette:

- black / graphite background
- off-white / bone foreground
- brass for structure and brand emphasis
- ice / steel for neutral information
- green for healthy / confirmed / filled
- red for blocked / danger / failure
- amber for warnings only

Orange is not a primary Gordon color.

### Typography and labeling

Use short, hard labels:

- `ROUTE`
- `QUEUE`
- `THESIS`
- `BOOK`
- `RISK`
- `VENUE`
- `EXPOSURE`
- `APPROVAL`
- `ALERT`
- `STATUS`

Avoid:

- friendly dashboard prose
- repeated explanatory sentences
- cute phrasing

### Border discipline

Use structure, not box clutter.

Allowed:

- rails
- dividers
- dense line separators
- compact section headers

Avoid:

- thick borders around everything
- nested boxes inside boxes
- panels that exist only to create shape

---

## 14. Motion

Motion should make Gordon feel premium, not busy.

### Allowed motion

- boot sequence
- loading sweep
- active row shimmer
- live route pulse
- subtle row flash on updates
- compact sparkline drift
- overlay open/close transition
- alert/fill emphasis

### Forbidden motion

- permanent ambient animation behind work
- multiple simultaneous attention-grabbers
- decorative movement unrelated to state
- theatrical animation on routine workflows

### Branded motion

Use a branded boot/loading treatment derived from the company mark.

That animation belongs in:

- startup
- reconnect
- major run initiation
- blocking wait states

It does not belong as ambient workspace chrome.

---

## 15. Markdown And Documents

Gordon has more document-like content than V1 respected:

- playbooks
- research summaries
- exported reports
- runbooks
- strategy notes

These should use a dedicated markdown surface, not raw transcript dumps.

Markdown belongs in:

- `MarkdownOverlay`
- inspector attachment panes when the document is the active object

It does not belong as a replacement for structured tables or tickets.

---

## 16. CLI Contract Outside The Cockpit

V2 is still a serious CLI product, not only a TUI.

Outside the fullscreen cockpit, Gordon should follow CLI best practices:

- `--help`
- concise examples
- `--json`
- `--plain`
- `--quiet`
- `--dry-run`
- `--yes`
- `--no-input`
- stdout for data
- stderr for progress/errors
- deterministic structured outputs
- clear exit codes

The cockpit is the primary human surface.
The CLI contract remains the primary machine and automation surface.

---

## 17. What Claude Code Still Contributes

`open-claude-code-main` remains useful only at the shell-behavior layer.

Keep from that family:

- conversation-first rhythm
- command bar fluency
- session continuity
- calm inline approvals
- agent-led flow

Do not keep from that family:

- coding metaphors
- file tree thinking
- repo-centric layout
- IDE-like structure

---

## 18. V2 Boundaries

### V2 includes

- one conversation-first shell
- one inspector architecture
- fullscreen overlays for dense work
- table-first trading surfaces
- ticket-first review
- blotter-first supervision
- markdown as a first-class document surface
- a frozen palette and motion language

### V2 excludes

- five unrelated full-screen apps
- generic dashboard cards
- random new influences per screen
- coding-agent metaphors
- aesthetic experimentation without contract changes

### Non-goal

V2 is not trying to impress by having more surfaces.

V2 is trying to make Gordon feel inevitable.

---

## 19. Implementation Order

If Gordon is rebuilt against this spec, the order should be:

1. Freeze Rezi stack and shell state model
2. Build `InterlockStrip`, `TranscriptPane`, `InspectorPane`, `LiveRail`, `CommandBar`
3. Build `WatchTable`, `BlotterTable`, `TicketSheet`, `CompareMatrix`, `DetailPane`, `EventLog`
4. Build `MarketScreener`, `OrderBook`, `StrategyCompare`, `ReviewDesk`, `MarkdownOverlay`
5. Reconnect Gordon backend capabilities into the new cockpit
6. Tune motion, spacing, and copy only after the structural shell is stable

### Build sequence inside the product

- `Desk` first
- `Plan` second
- `Market` third
- `Monitor` fourth
- `Lab` fifth
- `Setup` and document surfaces after the core cockpit feels right

This order matters because `Plan` and `Market` define Gordon’s identity faster than `Lab` polish does.

---

## 20. Final Direction

Gordon V2 should feel like:

- the best coding-agent shell behavior
- applied to trading instead of coding
- with `ticker`-grade data presentation
- with a TypeScript-native Rezi cockpit
- CLI Trader workflow discipline
- Bloomberg seriousness
- restrained Evangelion interlock flavor
- one coherent terminal grammar

If a design decision does not make Gordon more coherent, more inspectable, more reviewable, or more trustworthy under pressure, it should not ship.

---

## Appendix A. Capability Placement Matrix

This appendix answers a practical question:

How does the V2 shell leverage Gordon's actual codebase without scattering features all over the screen?

The rule is:

- every capability family gets a home
- not every capability family gets its own permanent widget

### Placement legend

- `Chat`
  - discussed, narrated, summarized, approved
- `Inspector`
  - compact focused object beside the transcript
- `Overlay`
  - dense, comparative, or dangerous fullscreen work
- `Setup/Runtime`
  - administrative or system-management surface

| Capability family | Primary placement | Secondary placement | Notes |
| --- | --- | --- | --- |
| Live reasoning, agent conversation, queued work, thread continuity | `Chat` | `Inspector` | This stays transcript-first |
| Runtime approvals, denials, execution confirmations | `Chat` | `Overlay` | Inline for routine review, overlay for dangerous commit |
| Market scans, movers, trending, shortlist | `Overlay` | `Inspector` | Screener overlay with one selected row pinned into Market inspector |
| Symbol analysis, TA, chart context, dossier | `Inspector` | `Overlay` | Dossier lives in inspector; multi-symbol compare escalates |
| Regime, correlation, pair/spread analysis | `Inspector` | `Overlay` | Compact in inspector, matrix in overlay |
| Whale, liquidation, order-flow intelligence | `Inspector` | `Overlay` | Inspector for focus, overlay for ranked feeds |
| Order book and depth ladder | `Overlay` | `Inspector` | Too dense for transcript; compact imbalance summary may pin in inspector |
| Trade ticket creation, thesis, size, invalidation | `Inspector` | `Chat` | TicketSheet is the main object; chat explains the logic |
| Risk review, preview, venue/funding rails | `Inspector` | `Overlay` | Overlay only when the review becomes execution-critical |
| Orders, fills, lifecycle, open positions | `Overlay` | `Inspector` | Blotter first, inspector second |
| Portfolio, balances, book exposure | `Inspector` | `Overlay` | Compact portfolio state in Monitor inspector; full book in blotter |
| Strategy registry, generated strategies, playbooks | `Overlay` | `Inspector` | Leaderboard/bench in overlay, selected strategy in Lab inspector |
| Backtests, optimization, experiments, systematic datasets | `Overlay` | `Inspector` | CompareMatrix or results table first, detail pane second |
| Runtime state, plugin/MCP inventory, bridge/background health | `Inspector` | `Setup/Runtime` | Persistent monitor context with deeper runtime surfaces behind it |
| Audit trail, alerts, action history, workflow execution log | `Inspector` | `Overlay` | EventLog in shell, full audit overlay for deep review |
| Setup, config, exchange/broker credentials, MCP/routing, keyring | `Setup/Runtime` | `Overlay` | Never permanent shell clutter |
| Playbooks, runbooks, markdown reports, exports, research notes | `Overlay` | `Inspector` | MarkdownOverlay first; inspector attachment only when doc is active focus |

### Summary by lens

`Desk`
- chat first
- approvals second
- compact activity log third

`Market`
- dossier in inspector
- screener/orderbook/compare in overlay

`Plan`
- ticket in inspector
- preview/review/execution confirmation in overlay

`Lab`
- selected strategy in inspector
- benches, backtests, compares, datasets in overlay

`Monitor`
- book/runtime summary in inspector
- blotters, audit feeds, plugin inventories in overlay
