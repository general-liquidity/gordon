# Gordon Task Tree

Gordon's task tree is the terminal-native execution view for active user-assigned work.

It is driven by real runtime events, not decorative loading states:

- request routing
- agent handoffs
- tool call start/end
- queued steering and follow-ups
- cancellation, failure, and completion

## Execution Model

The task tree is built from the streaming event flow emitted by the orchestrator:

- `agent_switch`
- `tool_call_start`
- `tool_call_end`
- `done`
- `cancelled`
- `error`

Primary source:

- [src/infra/agents/orchestrator.ts](/mnt/c/Users/adria/Downloads/gordon-cli-alpha/src/infra/agents/orchestrator.ts)

UI integration:

- [src/app/taskTree.ts](/mnt/c/Users/adria/Downloads/gordon-cli-alpha/src/app/taskTree.ts)
- [src/app/components/TaskTree.tsx](/mnt/c/Users/adria/Downloads/gordon-cli-alpha/src/app/components/TaskTree.tsx)
- [src/app/App.tsx](/mnt/c/Users/adria/Downloads/gordon-cli-alpha/src/app/App.tsx)

## Tree Shape

Default hierarchy:

1. Request root
2. Routing
3. Functional family
4. Agent
5. Tool

Example:

```text
✓ Analyze Market — /analyze AAPL
   ├─ ✓ Route request — Workflow routed
   └─ ✓ Market analysis
      └─ ✓ Analyst
         ├─ ✓ Shared Context — symbol: AAPL
         └─ ✓ Analyze Coin — symbol: AAPL · timeframes: 1h, 4h
```

## Functional Families

Tool calls are grouped into functional families so the tree reflects what Gordon is doing at the product level, not just raw tool names.

Current families:

- `Market analysis`
  - scans, analysis, indicators, charts, order book, discovery, regime, liquidation, pair analysis
- `Trade planning and execution`
  - plans, order previews, execution, positions, account, portfolio, history, risk checks
- `Systematic research`
  - backtests, datasets, validation, experiments, lifecycle, runtime, playbooks, protocol, genome, audit
- `Automation and runtime`
  - autonomous mandates, scheduler tasks, monitors, daemon-backed runtime tasks, reconciliation, capital refresh
- `Rails and payments`
  - MoonPay, Polygon, Helius rail flows, funding, wallet rails, payments
- `Onchain protocols`
  - Uniswap, Base, Chainlink, Solana kit, Polkadot kit, DEX/onchain protocol tooling
- `Web automation`
  - Tinyfish research and monitoring

## Current Coverage

The task tree currently covers:

- chat-first streamed requests
- menu-triggered streamed requests
- queued follow-ups and steering updates
- daemon-owned background work as a parallel tree
  - scheduler tasks
  - autonomous swing-trading state

It does not yet fully cover:

- every direct local command that returns synchronously without streaming

Those direct local paths are still represented elsewhere through runtime status and command-specific output.

## Extension Rule

When adding a new task family or tool surface:

1. Register its classification in [src/app/taskTree.ts](/mnt/c/Users/adria/Downloads/gordon-cli-alpha/src/app/taskTree.ts)
2. Prefer mapping by canonical action first
3. Fall back to tool-name pattern matching only when no canonical action exists
4. Keep the family labels product-facing, not implementation-facing

Bad:

- `solanakit-defi-pools`
- `marketAnalysisTools`
- `tool_call_start`

Good:

- `Onchain protocols`
- `Market analysis`
- `Trade planning and execution`

## Product Intent

The task tree is meant to show:

- what Gordon is doing now
- what family of work it belongs to
- which agent is handling it
- which specific tools are active
- whether a follow-up or steering update is queued

It is not meant to mimic a dashboard. It is a compact CLI operator surface.
