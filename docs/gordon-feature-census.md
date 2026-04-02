# Gordon Feature Census And UI Mapping

This document is the exhaustive feature-to-surface map for Gordon.

It complements:

- [docs/gordon-tui-master-plan.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-tui-master-plan.md)
- [docs/gordon-workspace-redesign.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-workspace-redesign.md)
- [docs/gordon-desk-ui-spec.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-desk-ui-spec.md)
- [docs/gordon-design-traceability-matrix.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-design-traceability-matrix.md)

The master plan defines the product architecture.
This document answers a different question:

What does Gordon actually have today, where does it live in the repository, how should it surface in the terminal, and what should be persistent vs transient vs reviewable?

This is the planning artifact that keeps the reset grounded in the real codebase instead of broad design language.

---

## 1. Coverage And Method

This census is based on the current repository surfaces, especially:

### Shell and app state

- `src/app/App.tsx`
- `src/app/screens/ChatScreen.tsx`
- `src/app/ChatInput.tsx`
- `src/app/ChatView.tsx`
- `src/app/slashCommands.ts`
- `src/app/state/AppStore.ts`
- `src/app/workspaces.ts`
- `src/app/workspaceViewModels.ts`
- `src/app/commands/*.ts`

### Runtime and orchestration

- `src/runtime/session/SessionRuntime.ts`
- `src/runtime/query/QueryRuntime.ts`
- `src/runtime/state/RuntimeStore.ts`
- `src/runtime/permissions/PermissionEngine.ts`
- `src/runtime/plugins/RuntimePluginManager.ts`
- `src/runtime/bridge/RuntimeBridge.ts`
- `src/infra/agents/orchestrator.ts`
- `src/infra/agents/tools/withMetrics.ts`

### Capability registries

- `src/infra/agents/tools/index.ts`
- `src/infra/agents/tools/*.ts`
- `src/app/commands/index.ts`
- `src/app/commands/workflow.ts`
- `src/app/commands/strategy.ts`
- `src/core/*`
- `src/strategies/*`
- `src/backtest/*`
- `src/infra/systematic/*`

### External design references used to shape the target mapping

- `ticker`
- `CLI Trader`
- `k9s`
- `lazygit`
- `VisiData`
- `hledger-ui`
- `posting`
- `btop`
- `OpenTUI`
- `Rezi`
- `Glyph`
- `Pi / pi-tui`
- Charmbracelet stack:
  - `gum`
  - `glow`
  - `lipgloss`
  - `bubbletea`
  - `bubbles`
  - `ultraviolet`
  - `colorprofile`
- Hatchet "TUIs are easy now"
- `CLI-Anything`
- `clig.dev` / `cli-guidelines`
- Karpathy "Build for Agents" CLI thesis
- `fintool`
- Evangelion screen-graphics studies
- donut-math ASCII rendering

These references are used as pattern inputs, not as a request to clone their visuals.

---

## 2. Gordon Surface Taxonomy

Gordon’s features should surface through five primary workspaces and four secondary operator surfaces.

### Primary workspaces

- `Desk`
- `Market`
- `Plan`
- `Lab`
- `Monitor`

### Secondary operator surfaces

- `Setup`
- `Command palette`
- `Approval review`
- `Export / share / compare overlays`
- `Document / markdown overlays`
- `Startup / onboarding identity sequence`

### Terminal primitive families

The reset should map capabilities into these primitives:

- `Transcript`
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
- `StatusToken`
- `MiniChartCell`
- `Timeline`
- `MarkdownPane`
- `Overlay`
- `OrbitalBoot`

---

## 3. Feature Mapping Matrix

This is the primary planning table.

| Capability family | Key source files | Current entrypoints | Target workspace | Target primitive | Persistence | Risk | UX priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Live chat reasoning and delegated agent work | `src/app/ChatView.tsx`, `src/runtime/query/QueryRuntime.ts`, `src/infra/agents/orchestrator.ts` | prompt, agent chat, `/chat` | `Desk` | `Transcript` + `ActivityLog` | persistent | medium | P0 |
| Runtime approvals and tool gating | `src/runtime/permissions/PermissionEngine.ts`, `src/app/commands/runtime.ts`, `src/app/presenters/RuntimePresenter.ts` | inline errors, `/runtime-approvals`, approve / deny flows | `Desk`, `Plan`, `Monitor` | inline `ApprovalDrawer` + `ApprovalDesk` overlay | reviewable | high | P0 |
| Session restore and thread state | `src/runtime/session/SessionRuntime.ts`, `src/app/workspaceShellState.ts`, `src/app/commands/runtime.ts` | `/resume`, thread actions | `Desk` + global | `Transcript`, `ActivityLog`, restore overlay | persistent | low | P1 |
| Market scanning | `src/core/scanner.ts`, `src/infra/agents/tools/market.ts`, `src/app/commands/workflow.ts` | `/scan`, quick workflow | `Market` | `DataTable` shortlist | semi-persistent | low | P0 |
| Trending / volume / discovery | `src/infra/agents/tools/discovery.ts`, `src/app/slashCommands.ts` | `/trending`, `/volume` | `Market` | `DataTable` + `SummaryStrip` | transient to semi-persistent | low | P0 |
| Symbol analysis | `src/core/analyzer.ts`, `src/infra/agents/tools/market.ts`, `src/infra/agents/tools/indicators.ts` | `/analyze`, `/deep`, `/ta`, `/chart`, `/candlestick` | `Market` | `DetailPane` + `MiniChartCell` | semi-persistent | low | P0 |
| Regime analysis | `src/infra/agents/tools/regime-tools.ts`, `src/app/slashCommands.ts` | `/regime`, `/regime-history` | `Market`, `Lab` | `DetailPane` + `Timeline` | reviewable | low | P1 |
| Whale / flow / squeeze / liquidation analysis | `src/infra/agents/tools/market-analysis.ts`, `src/infra/agents/tools/liquidation-intelligence.ts`, `src/infra/agents/tools/base-signals.ts` | `/whales`, `/liquidation` | `Market` | `DetailPane` + ranked `DataTable` | reviewable | low | P1 |
| Pair / correlation / spread analysis | `src/infra/agents/tools/pair-analysis.ts` | `/pairs` | `Market`, `Lab` | `DataTable` + compare `DetailPane` | reviewable | low | P1 |
| Predictive / synth analytics | `src/infra/agents/tools/synthdata.ts` | `/predict`, `/synth` | `Market`, `Lab` | `DetailPane` + probabilistic `MiniChartCell` | reviewable | low | P2 |
| Trade plan creation | `src/infra/agents/tools/trading.ts`, `src/types/plan.ts`, `src/app/workspaceViewModels.ts` | `/plan`, planner agent | `Plan` | `TicketSheet` | persistent | medium | P0 |
| Grid planning | `src/infra/agents/tools/trading.ts` | `/grid` | `Plan` | `TicketSheet` variant | persistent | medium | P1 |
| Execution preview | `src/infra/agents/tools/discovery.ts`, `src/infra/agents/tools/trading.ts` | `/preview-order`, plan execution path | `Plan` | `TicketSheet` + review overlay | reviewable | high | P0 |
| Plan approval and execution | `src/infra/agents/tools/trading.ts`, `src/runtime/permissions/PermissionEngine.ts` | `approve_plan`, `/runtime-approve`, live execution | `Plan`, `Desk` | `ApprovalDrawer` + `TicketSheet` | reviewable | high | P0 |
| Orders and order lifecycle | `src/infra/agents/tools/orderbook.ts`, `src/app/state/AppStore.ts` | `/orders` | `Monitor`, `Plan` | `BlotterTable` | semi-persistent | medium | P0 |
| Positions and live trade state | `src/infra/agents/tools/positions.ts`, `src/infra/agents/tools/position-tracking.ts`, `src/core/monitor.ts` | `/positions` | `Monitor` | `BlotterTable` + `DetailPane` | persistent | medium | P0 |
| Portfolio and balances | `src/infra/agents/tools/account.ts`, `src/services/portfolio.service.ts`, `src/infra/agents/tools/wallet.ts` | `/portfolio`, `/wallet` | `Monitor` | `SummaryStrip` + `BlotterTable` | persistent | medium | P0 |
| Risk sizing and posture | `src/core/risk-kernel/kernel.ts`, `src/infra/agents/tools/risk-management.ts`, `src/infra/agents/tools/risk-gate.ts` | `/risk`, plan creation, runtime gating | `Plan`, `Monitor` | `Risk ladder` inside `TicketSheet` + `DetailPane` | reviewable | high | P0 |
| Trailing stop and exit management | `src/infra/agents/tools/trading.ts`, `src/infra/agents/tools/risk-management.ts` | stop management tool flows | `Plan`, `Monitor` | `BlotterTable` + action drawer | persistent | high | P1 |
| Strategy registry and inspection | `src/app/commands/strategy.ts`, `src/strategies/registry.ts`, `src/infra/agents/tools/strategies.ts` | `/strategies`, `/strategy info` | `Lab` | ranked `DataTable` + `DetailPane` | persistent | low | P0 |
| Generated strategies | `src/app/commands/strategy.ts`, `src/infra/storage/generated-strategies.ts`, `src/infra/agents/tools/strategy-generation.ts` | `/gen`, generated strategy flows | `Lab` | `DataTable` + `DetailPane` | persistent | low | P0 |
| Strategy explanation and iteration | `src/infra/agents/tools/strategy-explain.ts`, `src/infra/agents/tools/strategy-iterate.ts` | strategy AI flows | `Lab` | `DetailPane` + compare overlay | reviewable | low | P2 |
| Backtesting | `src/backtest/engine.ts`, `src/infra/agents/tools/backtest.ts`, `src/app/commands/workflow.ts` | `/backtest`, `/workflow backtest-cycle` | `Lab` | `Timeline` + results `DataTable` + `DetailPane` | reviewable | low | P0 |
| Optimization and compare | `src/infra/agents/tools/backtest.ts`, `src/app/slashCommands.ts` | `/optimize`, `/compare` | `Lab` | compare overlay + leaderboard `DataTable` | reviewable | low | P1 |
| Playbooks and protocol | `src/core/playbooks/index.ts`, `src/infra/agents/tools/playbook-tools.ts`, `src/core/playbooks/protocol-tools.ts` | `/strategy playbooks` and protocol flows | `Lab` | `DataTable` + `DetailPane` | persistent | low | P1 |
| Markdown playbooks, research notes, runbooks, and exported summaries | `docs/*.md`, `src/app/commands/export.ts`, `src/core/playbooks/*`, research/report flows | help, playbooks, exports, research summaries | `Desk`, `Lab`, global overlays | `MarkdownPane` + export overlay | reviewable | low | P1 |
| Genome / experiment lifecycle | `src/infra/agents/tools/genome-tools.ts` | `/evolve`, `/experiment` | `Lab` | `Timeline` + experiment `DataTable` | reviewable | low | P1 |
| Systematic datasets and validation | `src/infra/systematic/service.ts`, `src/infra/agents/tools/systematic-tools.ts` | `/systematic`, `/dataset`, `/validate`, `/decay` | `Lab` | `Systematic slate` + `Timeline` + export overlay | reviewable | low | P0 |
| Runtime strategy deployment | `src/infra/agents/tools/runtime-tools.ts` | `/deploy`, `/strategies-live`, `/pause`, `/resume-strategy`, `/stop`, `/rebalance` | `Lab`, `Monitor` | `BlotterTable` + runtime `DetailPane` | persistent | high | P1 |
| Workflow automation | `src/app/commands/workflow.ts`, `src/infra/tinyfish/service.ts` | `/workflow`, quick / DD / web workflows | `Desk`, `Market`, `Lab`, `Monitor` | `Timeline` + `ActivityLog` | reviewable | medium | P0 |
| Tinyfish web research and monitors | `src/infra/agents/tools/tinyfish.ts`, `src/app/commands/workflow.ts` | web DD and monitor commands | `Lab`, `Monitor` | `Timeline` + `ActivityLog` | reviewable | medium | P2 |
| Runtime health and plugin lifecycle | `src/runtime/plugins/RuntimePluginManager.ts`, `src/app/presenters/RuntimePresenter.ts`, `src/app/commands/runtime.ts` | `/runtime`, `/runtime-state`, `/runtime-plugins`, `/health` | `Monitor`, `Desk` | `SummaryStrip` + `ActivityLog` + `DetailPane` | semi-persistent | medium | P0 |
| Runtime transcript / scratchpad / handoffs / history | `src/app/commands/runtime.ts`, `src/runtime/history/RuntimeHistoryManager.ts` | `/runtime-transcript`, `/runtime-scratchpad`, `/runtime-handoffs`, `/runtime-history` | `Desk`, `Monitor` | overlay + `ActivityLog` | reviewable | low | P1 |
| Bridge / background tasks / remote ingress | `src/runtime/bridge/RuntimeBridge.ts`, `src/gateway/runtime/*`, `src/app/backgroundTasks.ts` | `/runtime-bridge`, daemon flows | `Monitor` | `ActivityLog` + runtime rail | semi-persistent | medium | P1 |
| Exchange management | `src/app/commands/exchange.ts`, `src/infra/exchange/*` | `/exchange` | `Setup`, `Monitor` | overlay + setup sheet | persistent | medium | P1 |
| Broker management | `src/app/commands/broker.ts`, `src/infra/broker/*` | `/broker` | `Setup`, `Monitor` | overlay + setup sheet | persistent | medium | P1 |
| MCP plugin marketplace | `src/app/commands/mcp.ts`, `src/runtime/plugins/RuntimePluginManager.ts` | `/mcp` | `Setup`, `Monitor` | overlay + inventory `DataTable` | persistent | low | P1 |
| Tool-to-agent routing | `src/app/commands/routing.ts`, `src/infra/routing/*` | `/routing` | `Setup`, `Monitor` | overlay + routing table | persistent | medium | P2 |
| Config and keyring | `src/app/commands/config.ts`, `src/app/commands/keyring.ts` | `/config`, `/keyring` | `Setup` | setup sheet | persistent | medium | P1 |
| Telemetry, context, diagnostics, doctor | `src/app/commands/telemetry.ts`, `src/app/commands/context.ts`, `src/app/DoctorPanel.tsx` | `/telemetry`, `/context`, `/doctor` | `Setup`, `Monitor` | overlay + `DetailPane` | reviewable | low | P2 |
| Export and session handoff | `src/app/commands/export.ts` | `/export` | global overlay | export overlay | reviewable | low | P1 |
| Threads, bookmarks, session log | `src/app/slashCommands.ts`, `src/runtime/session/SessionRuntime.ts` | `/clone`, `/threads`, `/switch`, `/bookmark`, `/thread-summary`, `/compact-thread` | `Desk` + global overlay | overlay + `ActivityLog` | persistent | low | P1 |
| Autonomous mode | `src/infra/agents/tools/autonomous.ts`, `src/app/slashCommands.ts` | `/autonomous` | `Monitor`, `Plan` | `StatusToken` + action drawer | high | high | P2 |
| Agent rails, payments, funding, wallet rails | `src/infra/agents/tools/agent-rails.ts`, `src/app/slashCommands.ts` | `/fund`, `/pay`, `/earn`, `/rails`, `/bridge` | `Plan`, `Monitor`, `Setup` | overlay + rail `DetailPane` | reviewable / dangerous | high | P1 |
| Solana rails and DeFi | `src/infra/agents/tools/solanakit-*` | `/solana` | `Plan`, `Monitor`, `Setup` | overlay + rail `DetailPane` | reviewable / dangerous | high | P2 |
| Polkadot rails and DeFi | `src/infra/agents/tools/polkadotkit-*` | `/polkadot` | `Plan`, `Monitor`, `Setup` | overlay + rail `DetailPane` | reviewable / dangerous | high | P2 |
| Base, Chainlink, DEX, DeFi rails | `src/infra/agents/tools/base-*`, `src/infra/agents/tools/chainlink-*`, `src/infra/agents/tools/dex-search.ts`, `src/infra/agents/tools/defillama-yields.ts`, `src/infra/agents/tools/uniswap-data.ts` | `/base`, `/chains`, `/prices` | `Market`, `Lab`, `Plan` | `DataTable` + `DetailPane` | reviewable | medium | P2 |
| Audit trail and agent activity | `src/infra/agents/tools/audit-tools.ts`, `src/app/slashCommands.ts` | `/audit` | `Monitor`, `Desk` | `ActivityLog` + audit overlay | reviewable | medium | P1 |

---

## 4. Workspace-Specific Feature Contracts

### 4.1 Desk

Desk owns:

- transcript
- active run strip
- inline approval tickets
- queued follow-ups
- action log of completed workflow/tool actions
- thread and resume affordances

Desk should not own:

- the main market shortlist
- the main plan book
- the main blotter
- the main strategy leaderboard

Desk command families:

- `/chat`
- `/help`
- `/menu`
- `/resume`
- `/new-session`
- `/threads`
- `/switch`
- `/thread-info`
- `/bookmark`
- `/bookmarks`
- `/thread-summary`
- `/compact-thread`
- `/runtime-approvals`
- `/runtime-approve`
- `/runtime-deny`

Primary primitives:

- `Transcript`
- `CommandBar`
- inline `ApprovalDrawer`
- `ActivityLog`

### 4.2 Market

Market owns:

- scans
- movers
- shortlist
- symbol focus
- tape context
- regime and structure
- pair comparison
- liquidation / whale / flow overlays

Market command families:

- `/market`
- `/scan`
- `/trending`
- `/volume`
- `/analyze`
- `/deep`
- `/whales`
- `/breakouts`
- `/score`
- `/chart`
- `/ta`
- `/candlestick`
- `/regime`
- `/regime-history`
- `/pairs`
- `/predict`
- `/liquidation`
- `/prices`
- `/chains`
- `/base`

Primary primitives:

- `DataTable`
- `DetailPane`
- `SummaryStrip`
- `ActivityLog`

### 4.3 Plan

Plan owns:

- active ticket
- risk ladder
- approval drawer
- plan book
- execution preview
- route posture
- size and invalidation

Plan command families:

- `/plans`
- `/plan`
- `/grid`
- `/preview-order`
- `/positions`
- `/orders`
- `/arm`
- `/disarm`
- `/fund`
- `/pay`
- `/earn`
- `/wallet`
- `/withdraw`
- `/bridge`
- `/rails`

Primary primitives:

- `TicketSheet`
- `ApprovalDrawer`
- `BlotterTable`
- `DetailPane`

### 4.4 Lab

Lab owns:

- strategy registry
- generated strategies
- playbooks
- backtests
- optimization
- compare
- experiment lifecycle
- systematic datasets / lifecycle / export

Lab command families:

- `/lab`
- `/strategies`
- `/gen`
- `/backtest`
- `/optimize`
- `/compare`
- `/deploy`
- `/strategies-live`
- `/pause`
- `/resume-strategy`
- `/stop`
- `/rebalance`
- `/evolve`
- `/experiment`
- `/systematic`
- `/dataset`
- `/decay`
- `/validate`
- `/workflow`

Primary primitives:

- ranked `DataTable`
- `DetailPane`
- `Timeline`
- `ActivityLog`

### 4.5 Monitor

Monitor owns:

- portfolio
- balances
- positions
- orders
- alerts
- runtime health
- plugin attention
- bridge activity
- daemon / background work

Monitor command families:

- `/monitor`
- `/portfolio`
- `/positions`
- `/orders`
- `/health`
- `/runtime`
- `/runtime-state`
- `/runtime-plugins`
- `/runtime-bridge`
- `/runtime-history`
- `/audit`
- `/telemetry`
- `/context`

Primary primitives:

- `SummaryStrip`
- `BlotterTable`
- `ActivityLog`
- runtime `DetailPane`

---

## 5. Secondary Operator Surfaces

Not every feature belongs in a main workspace.

### Setup

Owns:

- exchange add / switch / remove / compare
- broker add / switch / remove
- MCP plugin install / search / configure / enable / disable / update
- routing install / route / enable / disable
- keyring
- config
- doctor

Primary primitives:

- setup sheet
- config form
- plugin inventory table
- routing table

### Command palette

Owns:

- global command discovery
- workspace-local action staging
- symbol jump
- compare entry
- export entry

### Approval review overlay

Owns:

- claim the current pending request
- inspect why it is blocked
- choose once vs persist
- deny with reason

### Export / compare overlays

Owns:

- artifact export
- strategy compare
- plan compare
- backtest compare

---

## 6. Exact Slash Command Census

This section is intentionally explicit so there is no ambiguity about coverage.

### Market and discovery

- `/scan`
- `/trending`
- `/volume`
- `/analyze`
- `/whales`
- `/breakouts`
- `/score`
- `/chart`
- `/ta`
- `/candlestick`
- `/regime`
- `/regime-history`
- `/deep`
- `/parallel`
- `/compare-coins`
- `/fast-deep`
- `/mtf`
- `/pairs`
- `/prices`
- `/predict`
- `/liquidation`

### Trading and execution

- `/plan`
- `/grid`
- `/positions`
- `/orders`
- `/arm`
- `/disarm`
- `/portfolio`
- `/wallet`
- `/fund`
- `/pay`
- `/earn`
- `/withdraw`
- `/risk`
- `/simulate`

### Strategy, research, and runtime strategy ops

- `/backtest`
- `/optimize`
- `/compare`
- `/strategies`
- `/gen`
- `/deploy`
- `/strategies-live`
- `/pause`
- `/resume-strategy`
- `/stop`
- `/rebalance`
- `/evolve`
- `/experiment`
- `/systematic`
- `/dataset`
- `/decay`
- `/validate`
- `/ensemble`
- `/workflow`

### Runtime, health, and audit

- `/runtime`
- `/audit`
- `/health`
- `/status`
- `/metrics`
- `/runtime-state`
- `/runtime-plugins`
- `/runtime-transcript`
- `/runtime-scratchpad`
- `/runtime-handoffs`
- `/runtime-approvals`
- `/runtime-approve`
- `/runtime-deny`
- `/runtime-bridge`
- `/runtime-history`
- `/telemetry`
- `/context`

### Workspaces and shell

- `/chat`
- `/market`
- `/plans`
- `/lab`
- `/monitor`
- `/menu`
- `/help`
- `/shortcuts`
- `/theme`

### Session and thread management

- `/resume`
- `/new-session`
- `/session`
- `/clone`
- `/threads`
- `/switch`
- `/thread-info`
- `/delete-thread`
- `/rename-thread`
- `/action-log`
- `/bookmark`
- `/bookmarks`
- `/thread-summary`
- `/compact-thread`

### Setup, config, and operator tooling

- `/setup`
- `/configure`
- `/doctor`
- `/config`
- `/exchange`
- `/broker`
- `/stocks`
- `/model`
- `/mcp`
- `/routing`
- `/keyring`
- `/bugreport`
- `/whatsnew`

### Chains, rails, and onchain access

- `/autonomous`
- `/chains`
- `/rails`
- `/bridge`
- `/solana`
- `/polkadot`
- `/base`
- `/synth`

---

## 7. Tool Registry Census By Family

The slash command layer is not the whole product.
The tool layer shows how much functionality exists below it.

### Core market and charting

- `market.ts`
- `market-data.ts`
- `indicators.ts`
- `market-analysis.ts`
- `charts.ts`
- `orderbook.ts`
- `pair-analysis.ts`
- `liquidation-intelligence.ts`
- `discovery.ts`

### Trading and execution

- `trading.ts`
- `positions.ts`
- `position-tracking.ts`
- `risk-management.ts`
- `risk-gate.ts`
- `account.ts`
- `wallet.ts`
- `history.ts`

### Strategy and research

- `strategies.ts`
- `strategy-generation.ts`
- `strategy-generate.ts`
- `strategy-explain.ts`
- `strategy-iterate.ts`
- `backtest.ts`
- `backtest-tools.ts`
- `playbook-tools.ts`
- `genome-tools.ts`
- `systematic-tools.ts`
- `advanced-tools.ts`

### Runtime and operations

- `runtime-tools.ts`
- `scheduler.ts`
- `system.ts`
- `audit-tools.ts`
- `memory-tools.ts`
- `agent-rails.ts`

### DeFi, chains, rails, and onchain

- `base-onchain.ts`
- `base-signals.ts`
- `base-indexers.ts`
- `agentkit-onchain.ts`
- `agentkit-defi.ts`
- `polkadotkit-assets.ts`
- `polkadotkit-staking.ts`
- `polkadotkit-defi.ts`
- `solanakit-wallet.ts`
- `solanakit-trading.ts`
- `solanakit-defi-perps.ts`
- `solanakit-defi-lending.ts`
- `solanakit-defi-pools.ts`
- `solanakit-defi-bridge.ts`
- `uniswap-data.ts`
- `dex-search.ts`
- `defillama-yields.ts`
- `chainlink-streams.ts`
- `chainlink-feeds.ts`
- `chainlink-ccip.ts`

### Workflow and web automation support

- `tinyfish.ts`
- `autonomous.ts`

---

## 8. Under-Leveraged Features In The Current UX

These capabilities are already real in code, but the terminal still hides or flattens them.

### High-value underexposed surfaces

- workflow step timelines from `src/app/commands/workflow.ts`
- risk and readiness review from `src/core/risk-kernel/kernel.ts` and `src/infra/agents/tools/trading.ts`
- systematic lifecycle, decay, and export from `src/infra/agents/tools/systematic-tools.ts`
- experiment, lineage, and mutation flows from `src/infra/agents/tools/genome-tools.ts`
- plugin attention and routing health from `src/runtime/plugins/RuntimePluginManager.ts`
- position tracking lifecycle from `src/infra/agents/tools/position-tracking.ts`
- chain / rails / funding capabilities from `src/infra/agents/tools/agent-rails.ts` and chain-specific tool modules

### Why they are currently under-leveraged

- they are mostly presented as text results
- they lack a durable home in the TUI
- they compete with transcript output instead of becoming primary objects

---

## 9. Features With No Proper Home Yet

These features exist, but should not stay as loose command output.

### Needs a dedicated overlay or sheet

- command palette
- symbol jump
- approval review
- export / compare
- setup / config / routing / MCP

### Needs a dedicated workspace primitive

- market shortlist
- ticket sheet
- strategy leaderboard
- blotter table
- validation timeline

---

## 10. External Reference Mapping

This section records how the external inspirations should influence Gordon.

| Reference | Gordon takeaway | Applies to |
| --- | --- | --- |
| `ticker` | table-first market and positions rendering | `Market`, `Monitor` |
| `CLI Trader` | command -> strategize -> approve -> execute loop | `Desk`, `Plan` |
| CLI Trader glossary / runbook writing | CLI + MCP + Skills triad, process-quality discipline, explicit execution confirmation, GUI as secondary context, non-technical onboarding | global model, `Desk`, `Plan`, onboarding |
| CLI Trader philosophy / blog writing | personal software thesis, one-interface-many-markets, process quality over UI speed, terminal as research lab + trading desk + analytics platform | global model, onboarding, `Desk`, `Market`, `Plan`, `Monitor` |
| `k9s` | stable operator panes and local focus | all workspaces |
| `lazygit` | list/detail rhythm and hotkey ergonomics | `Market`, `Lab`, `Monitor` |
| `VisiData` | drill-down data exploration | `Market`, `Lab` |
| `hledger-ui` | summary -> register -> detail hierarchy | `Monitor`, `Plan` |
| `posting` | terminal-native overlays and command palette | global overlays |
| `btop` | live dense monitoring strips and rails | `Monitor`, global rail |
| `OpenTUI` | render ambition, overlays, frozen panes | engine usage style |
| `Rezi` | stable lists and dynamic TUI discipline | engine usage style |
| `Glyph` | focus scopes, modal trapping, list-heavy full-screen React TUI benchmark | engine benchmark and workspace interaction model |
| `Pi / pi-tui` | command-bar replacement, extension-owned UI slots, differential rendering, session-tree style recoverability | `Desk`, overlays, session/navigation model |
| `gum` | setup prompts, bootstrap confirmations, lightweight operator ask flows | onboarding, setup, credential / routing prompts |
| `glow` | markdown-native document rendering instead of transcript dumping | playbooks, reports, runbooks, exports |
| `lipgloss` | spacing rhythm, border restraint, typography hierarchy, token consistency | global shell grammar and component system |
| `bubbletea` / `bubbles` | state-machine workspaces, table/list/help/viewport behavior, pane-local keymaps | `Market`, `Lab`, `Monitor`, overlays |
| `ultraviolet` | cell-diffing ambition and atomic redraw expectations | render discipline, motion, stability |
| `colorprofile` | safe terminal capability handling and color degradation | global color system, warnings, accessibility |
| Hatchet "TUIs are easy now" | reference-driven iteration, tmux/capture visual validation, small deterministic views | implementation process, shell rebuild workflow |
| `CLI-Anything` | REPL + subcommand duality, discoverable agent-friendly command contracts, structured CLI parity | command surfaces, automation, non-TUI entrypoints |
| `clig.dev` / `cli-guidelines` | help shape, output contracts, stdout/stderr discipline, `--json`, `--dry-run`, TTY-safe interactivity, configuration precedence | command surfaces, exports, setup, non-TUI CLI behavior |
| Karpathy "Build for Agents" CLI thesis | CLI, MCP, markdown, and skills as agent-distribution surfaces | Gordon ecosystem contract, exports, external integrations |
| `fintool` | agent-friendly financial CLI surface and ecosystem contract | Gordon external integrations, helper tools, agent-facing exports |
| Evangelion screen graphics | interlock grammar, warning semantics, typographic authority, state rails | global rail, `Plan`, approvals, onboarding |
| donut-math ASCII rendering | orbital startup motion and computational terminal identity | startup / onboarding / transition loaders |

---

## 11. Implementation Priority By Feature Family

### P0

- Market shortlist and dossier
- Plan ticket sheet and approval drawer
- Monitor blotter and runtime rail
- Lab strategy table and validation lane
- Desk stripped down to transcript + action log + approvals

### P1

- setup and config overlays
- plugin and routing inventory tables
- export / compare overlays
- session and bookmark overlays
- systematic slate depth

### P2

- autonomous mode supervision
- advanced chain-specific rails overlays
- predictive / synth overlays
- advanced compare and mutation labs

---

## 12. Final Planning Rule

From this point onward, new UI work should be evaluated against this census.

A feature is not "covered" merely because there is a slash command for it.
A feature is covered only when:

- it has a clear workspace or overlay home
- it uses the correct terminal primitive
- its persistence level is intentional
- its risk level is signaled correctly
- the keyboard path is defined

That is the bar for the Gordon reset.
