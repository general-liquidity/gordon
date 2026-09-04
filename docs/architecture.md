# Gordon architecture

Gordon is one trading engine with several operator surfaces. A centralized orchestrator delegates research and execution to agents with different tool permissions, while deterministic code owns permission, risk, and venue dispatch.

## System map

```text
surfaces       TUI | headless | daemon over IPC | ACP | MCP | schedules
                                  |
orchestration  Gordon orchestrator
               |-- Researcher, read-only and time-boxed
               `-- Executor, execution tools only
               cognition | memory | loop detection | result offload
                                  |
governance     permission engine | 16-dimension risk classifier
               constitution | trust deny-list | kill switches | hooks | audit
                                  |
tools          canonical 22-tool surface plus integration-specific tools
                                  |
venues/data    CCXT exchanges | native brokers | filings | news | onchain
                                  |
state          LibSQL and vector memory | SQLite audit | local event bus
```

## Agent boundary

Gordon uses three agents because the split is a permission boundary, not a branding device.

| Agent | Responsibility | Authority |
|---|---|---|
| Gordon | Route work, supervise, synthesize, and communicate with the operator | Does not place orders directly |
| Researcher | Scan, analyze, backtest, and investigate in parallel | Read-only and time-boxed |
| Executor | Carry approved plans through the execution path | Sole holder of execution tools, still constrained by deterministic gates |

Collapsing the agents would give research context direct access to execution tools. The centralized topology keeps handoffs inspectable and lets the orchestrator cross-check work without widening authority.

Source: [`src/infra/agents/definitions/`](../src/infra/agents/definitions/) and [`src/infra/agents/orchestrator.ts`](../src/infra/agents/orchestrator.ts).

## Intent-to-order path

An agent-issued exposure increase follows this path:

```text
operator intent
  -> structured plan
  -> plan verification
  -> content-bound approval, when required
  -> approved-plan identity check
  -> kill-switch and constitution gates
  -> WIP, thesis, mandate, and universe checks
  -> permission mode
  -> price and order validation
  -> 16-dimension risk classification
  -> optional explicit risk acknowledgement
  -> PreOrderPlacement hooks
  -> venue dispatch
  -> reconciliation, audit, and ledger updates
```

Verified reductions and recovery actions do not blindly reuse the new-risk policy. They have bounded rules that keep protective exits available when consent for new exposure has been revoked.

## Canonical tool surface

The generalized agent surface contains 22 tools. Integration-specific tools can be added separately, but the core names remain small and stable.

| Domain | Count | Tools |
|---|---:|---|
| Data | 5 | `get_market_data`, `get_account_state`, `get_portfolio`, `get_news`, `get_fundamentals` |
| Analytics | 4 | `compute_indicator`, `compute_regime`, `compute_risk`, `compute_microstructure` |
| Plan and execution | 6 | `create_plan`, `verify_plan`, `approve_plan`, `execute_plan`, `cancel`, `backtest` |
| Memory and audit | 3 | `memory_search`, `memory_write`, `audit_event` |
| Workflow | 4 | `skill`, `delegate_subagent`, `ask_user`, `schedule_task` |

Only `compute_indicator` and `compute_microstructure` are meta-dispatchers. Safety semantics remain in the handlers they call; the surface does not reimplement the permission engine, risk classifier, audit log, or constitution.

Source: [`src/infra/agents/tools/surface/`](../src/infra/agents/tools/surface/).

## Risk classification

The classifier always evaluates eight base dimensions:

1. Position size
2. Concentration
3. Drawdown proximity
4. Daily loss budget
5. Trade frequency
6. Volatility
7. Market hours
8. Asset familiarity

When their inputs exist, it adds eight further dimensions:

1. Vol-adjusted sizing
2. Correlation risk
3. Venue MEV exposure
4. Regime transition risk
5. Fake liquidity
6. Margin of error
7. Tail risk
8. Uncertainty decomposition

The result is a composite score, tier, factor list, and one of `auto_approve`, `prompt_user`, `require_confirmation`, or `block`. The trading constitution and other hard gates remain separate from that score.

Source: [`riskClassifier.ts`](../src/infra/trading/risk/riskClassifier.ts).

## Memory and context control

Working memory contains durable operator preferences, not the whole session. Cold recall is model-requested through memory tools instead of being injected into every prompt.

Context pressure triggers five stages:

```text
70% masking -> 80% pruning -> 90% aggressive reduction -> 94% collapse -> 99% full summary
```

The collapse stage is a reversible read-time projection before any lossy summary. Oversized tool results move to scratch storage, and the agent sees a bounded reference instead of the complete payload.

## Cognition and loop control

The runtime can apply a tool-free thinking pass, extended thinking, adversarial critique, and citation audit. A session cost budget throttles these model-consuming passes.

The runtime harness fingerprints tool calls in a sliding window. It catches repeated identical calls and alternating cycles, then refuses the loop instead of continuing until context or budget is exhausted.

## Proactive radar

The radar has 22 registered producers for trade events, scanning, risk, stops, producer health, kill switches, periodic checks, portfolio drift, position review, regime flips, chart patterns, volatility, funding, news, whale activity, playbooks, edge assessment, earnings, insider flow, analyst changes, and congressional trades.

Candidates are scored before they interrupt the operator. Producer health is itself observable, so a dead signal source can raise an alert instead of disappearing silently.

Source: [`src/infra/proactive/producers/index.ts`](../src/infra/proactive/producers/index.ts).

## Hooks and extensibility

Fourteen lifecycle points cover tool use, compaction, sessions, approvals, orders, and subagents. Production bridge coverage is checked independently so adding a declared hook without a real emit site fails validation.

External hook registries are opt-in. When enabled, an absent, malformed, or empty registry aborts startup instead of quietly disabling the policy.

Source: [`src/infra/hooks/`](../src/infra/hooks/).

## State and audit

- LibSQL provides SQL and vector memory.
- SQLite stores the local audit log.
- The audit chain is HMAC-signed and records rationale on safety-critical actions.
- The event bus connects market, plan, execution, and radar lifecycles.
- OpenTelemetry instrumentation remains local; external export has been removed.

## Evaluation architecture

Gordon's evaluation harness is separate from realized-P/L scoring. It generates scenarios from the trading constitution, risk dimensions, safety-critical deny-list, agent boundaries, and category rubrics.

Deterministic process checks inspect the tool-call sequence for required and forbidden actions. `pass^k` measures reliability across repeated runs, with safety scenarios requiring every run to pass. Optional model judges score final-answer quality, and a cross-family panel can reduce one-model preference effects.

The live-run producer is opt-in because running the orchestrator has stateful side effects. CI covers deterministic scenarios and dry-run trajectories without contacting a model or venue.

## Code map

| Area | Path |
|---|---|
| Agent definitions | [`src/infra/agents/definitions/`](../src/infra/agents/definitions/) |
| Agent tools | [`src/infra/agents/tools/`](../src/infra/agents/tools/) |
| Orchestrator | [`src/infra/agents/orchestrator/`](../src/infra/agents/orchestrator/) |
| Permission engine | [`src/runtime/permissions/`](../src/runtime/permissions/) |
| Risk classifier | [`src/infra/trading/risk/riskClassifier.ts`](../src/infra/trading/risk/riskClassifier.ts) |
| Risk kernel | [`src/core/risk-kernel/`](../src/core/risk-kernel/) |
| Hooks | [`src/infra/hooks/`](../src/infra/hooks/) |
| Proactive radar | [`src/infra/proactive/`](../src/infra/proactive/) |
| Memory | [`src/infra/domain/memory/`](../src/infra/domain/memory/) |
| Gateway and SDK | [`src/gateway/`](../src/gateway/), [`src/core-sdk/`](../src/core-sdk/) |
| TUI | [`src/tui/`](../src/tui/) |
| Backtesting | [`src/backtest/`](../src/backtest/) |

## Related guides

- [Security and safety](./security/README.md)
- [Capabilities](./capabilities.md)
- [Operations](./operations.md)
- [Integrations](./integrations.md)
