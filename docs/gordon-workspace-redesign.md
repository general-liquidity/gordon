# Gordon Workspace Redesign

## 1. Codebase understanding

Gordon is already a multi-surface trading runtime. The current terminal exposes it mostly as a chat shell.

### Core shell and entrypoints

- `src/index.tsx` boots the CLI app, setup flags, and daemon integration.
- `src/entry.ts` is the compiled runtime entrypoint.
- `src/app/App.tsx` is the primary shell controller.
- `src/app/screens/ChatScreen.tsx` is the active conversation screen.
- `src/app/ChatInput.tsx` and `src/app/ChatView.tsx` define the main live prompt and transcript flow.
- `src/app/slashCommands.ts` is the command registry and discovery surface.
- `src/app/state/AppStore.ts` is the external app store for view and transcript state.

### Runtime and orchestration

- `src/runtime/session/SessionRuntime.ts` owns session state, approvals, transcript, persistence, bridge, plugins, and runtime inspection data.
- `src/runtime/query/QueryRuntime.ts` owns request dispatch and runtime-level execution paths.
- `src/runtime/tools/ToolInvoker.ts` is the runtime tool invocation layer.
- `src/runtime/state/RuntimeStore.ts` is the canonical runtime state container.
- `src/infra/agents/orchestrator.ts` is still the large execution engine behind the runtime shell.
- `src/infra/agents/agents.ts` defines the agent roles.
- `src/infra/agents/tools/index.ts` is the largest capability surface for analysis, trading, execution, rails, and research actions.

### Trading and execution primitives

- `src/core/risk-kernel/kernel.ts` contains the real risk posture and allocation logic.
- `src/core/execution/index.ts` and `src/core/monitor.ts` handle execution and monitoring lifecycle work.
- `src/infra/exchange/index.ts` and `src/infra/broker/index.ts` define exchange and broker execution connectivity.
- `src/services/portfolio.service.ts` and related portfolio formatting flows expose book state and capital context.

### Strategy, research, and systematic surfaces

- `src/app/commands/workflow.ts` already defines chained workflows:
  - quick analysis
  - due diligence
  - backtest cycle
  - Tinyfish web due diligence
  - Tinyfish web monitoring
- `src/app/commands/strategy.ts` already defines strategy management:
  - registry listing
  - generated strategy inspection
  - playbooks
  - active slots
  - genomes and experiments
- `src/strategies/registry.ts` and `src/strategies/dsl/index.ts` define the strategy layer.
- `src/backtest/engine.ts` is the backtest core.
- `src/infra/systematic/service.ts` exposes systematic validation, promotion, and portfolio summary flows.
- `src/core/playbooks/index.ts` is the playbook registry and protocol surface.

### Important current truth

The engine is already closer to an AI-native trading workstation than the current shell suggests.

## 2. Workflow inventory

The repository already supports these serious user workflows:

### Desk workflows

- Open-ended market reasoning through agent chat
- Symbol analysis and trade planning
- Runtime approvals and reviewable actions
- Threading, replay, and resume

### Market workflows

- scan the tape with `/scan`
- inspect movers with `/trending`, `/volume`, `/breakouts`, `/score`
- deep-dive a symbol with `/analyze`, `/deep`, `/ta`, `/chart`, `/candlestick`, `/whales`
- detect and compare regime with `/regime` and `/regime-history`

### Plan and execution workflows

- build trade plans with `/plan`
- preview execution with `/preview-order`
- inspect positions and orders with `/positions` and `/orders`
- live posture via `/arm` and `/disarm`
- wallet, funding, bridge, payment, and earn flows through `/wallet`, `/fund`, `/pay`, `/earn`

### Lab workflows

- strategy listing and inspection
- generated strategy creation from natural language
- quick backtests and comparisons
- playbook review
- running slot review
- genome/evolution and experiment review
- systematic datasets, lifecycle, decay, validation, and runtime diff review

### Monitor workflows

- portfolio and health review
- audit trail review
- runtime health
- live monitor cycle and realtime price support
- daemon and bridge activity

## 3. UX diagnosis

The current TUI is improved relative to earlier versions, but the product model is still too transcript-centered.

### What is weak today

- The terminal still treats high-value financial objects as chat output instead of first-class surfaces.
- The user has to remember commands for workflows the product already knows how to do.
- The shell still over-concentrates interaction in one transcript, one prompt, one quick-actions layer.
- The status and runtime surfaces exist, but there is no clear distinction between:
  - persistent context
  - current workflow state
  - reviewable action
  - diagnostic state
- Strategy, systematic, and playbook functionality exists in code but feels hidden compared with market chat.

### What is underexposed

- `workflow.ts` has real multi-step trading workflows but no first-class workflow surface.
- `strategy.ts` exposes a serious lab product, but the terminal frames it as a command namespace.
- `risk-kernel/kernel.ts` is central to trust, but risk review is not a primary surface.
- `systematic/service.ts` exposes validation and promotion logic that deserves a lab view, not just chat output.
- `SessionRuntime` already has enough runtime state to support a better operator shell than the current one.

## 4. Design thesis

Gordon should stop behaving like a generic agent transcript with finance add-ons.

The correct model is:

- an AI-native trading workstation
- with a transcript for reasoning
- with workspace views for repeated financial workflows
- with explicit review surfaces for plans, risk, and action

Claude Code is the right reference for fluency, incremental state, and composability.
It is not the right reference for metaphors. Traders do not live in file trees and diffs. Gordon should translate those strengths into:

- market exploration
- ticket review
- risk review
- strategy lab work
- live monitoring

The design target is:

- Claude Code fluency
- Bloomberg seriousness
- hedge fund sharpness
- Wall Street restraint
- AI-native composability

without becoming a dashboard parody or terminal cosplay.

## 5. Proposed interface architecture

Gordon should adopt a workspace shell with five primary views.

### Primary workspaces

- `Desk`
  - default transcript workspace
  - reasoning, delegation, approvals, live prompt
  - persistent enough for daily use
- `Market`
  - scan board
  - movers, regime, opportunity shortlist, symbol drill-down commands
  - persistent while exploring a session
- `Plan`
  - trade ticket review
  - thesis, entry, stop, invalidation, sizing, readiness, approval posture
  - review surface
- `Lab`
  - strategy, playbook, backtest, experiment, systematic state
  - persistent across repeated research work
- `Monitor`
  - portfolio, positions, orders, runtime health, alerts, bridge/background activity
  - persistent when supervising live state

### Persistent shell structure

- top workspace rail
  - current workspace
  - desk mode (`SAFE` or `ARMED`)
  - compact next actions
- main canvas
  - workspace-specific content
- right rail only when there is actionable state
  - approvals
  - background tasks
  - bridge sessions
  - live operator items
- shared bottom composer
  - prompt input
  - slash autocomplete
  - workspace-aware placeholder

### State model

- persistent:
  - workspace
  - thread
  - session
  - mode
  - runtime approvals
  - recent transcript
  - market/account context worth pinning
- transient:
  - active tool call
  - current stream
  - current activity line
  - command autocomplete
- actionable:
  - approvals
  - execution previews
  - plan readiness
  - live alerts
- dangerous:
  - live execution posture
  - approvals tied to external side effects
- reviewable:
  - plans
  - runtime history
  - strategy comparisons
  - audit entries

## 6. Concrete terminal patterns

### Workspace shell

```text
WORKSPACE RAIL  SAFE  Desk / Market / Plan / Lab / Monitor
Desk is active. Use /market, /plans, /lab, /monitor to switch.

[workspace content]

> prompt
```

### Market workspace

```text
MARKET
Turn the tape into a shortlist.

[ Scan board ]        [ Symbol drill-down ]
- /scan               - /analyze BTC
- /trending           - /deep BTC
- /breakouts          - /ta BTC 4h
- /regime             - /whales BTC
```

### Plan workspace

```text
PLAN
Review tickets before action.

[ Trade ticket ]      [ Risk and approval posture ]
- /plan BTC           - mode: SAFE
- /grid BTC           - pending approvals: N
- /preview-order      - next action: preview or approve
```

### Lab workspace

```text
LAB
Build, compare, and validate strategies.

[ Strategy registry ] [ Systematic lane ]
- /strategies         - /systematic status
- /gen ...            - /dataset list
- /strategy compare   - /validate <strategy>
- /workflow backtest-cycle ...
```

### Monitor workspace

```text
MONITOR
Supervise capital, runtime, and live state.

[ Book ]              [ Runtime ]
- /portfolio          - /runtime health
- /positions          - /audit recent
- /orders             - /runtime-history
- /health             - /runtime-bridge
```

### Output taxonomy

The terminal should render these as distinct surfaces, not generic chat:

- reasoning summary
- market scan result
- indicator snapshot
- trade plan
- risk review
- execution preview
- execution result
- alert
- backtest result
- strategy comparison
- research memo
- audit event
- approval ticket

## 7. Implementation roadmap

### Phase 1: workspace shell

- add workspace state to `AppStore`
- add workspace metadata
- add top workspace rail
- keep `Desk` as the current chat surface
- scaffold `Market`, `Plan`, `Lab`, and `Monitor` as real boards powered by existing commands

### Phase 2: route existing commands into workspaces

- add explicit workspace navigation commands
- map quick actions into the correct workspace
- stop treating every action as "return to chat"

### Phase 3: first-class plan surface

- transform trade plan output into a review object
- keep approvals adjacent to plan review
- make plan review the trading-native equivalent of diff review

### Phase 4: lab surface

- lift strategy, playbook, and systematic outputs into a dedicated lab board
- expose experiments, decay, validation, and lifecycle as first-class lab state

### Phase 5: monitor surface

- bring together book, orders, runtime, daemon, bridge, and alerts without forcing them into the main transcript

### Risks

- `App.tsx` remains very large; shell work must avoid making it worse
- current runtime outputs are still mostly text-first, so typed workspace objects will need gradual adapters
- some commands still assume "chat is the destination" and will need routing cleanup

## 8. First implementation slice

The first slice should be small but structural:

- add `Desk`, `Market`, `Plan`, `Lab`, and `Monitor` workspace state
- add a compact workspace rail above the active shell
- keep the existing transcript and prompt path intact
- show workspace-specific boards for non-desk views using existing commands and runtime state
- add explicit slash commands to switch workspaces

This gives Gordon a real shell model immediately without destabilizing the runtime.
