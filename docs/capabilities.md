# Gordon capabilities

Gordon combines model reasoning with deterministic market, portfolio, risk, execution, and evaluation code. This guide groups the full product surface by job rather than listing internal modules in repository order.

## Capability map

| Area | What Gordon provides |
|---|---|
| Market work | Live and historical data, news, filings, fundamentals, onchain data, wallet intelligence, screening, and multi-timeframe analysis |
| Quantitative analysis | 100 indicator operations and 87 advanced-analysis operations behind two typed dispatchers |
| Planning | Structured plans, scenario branches, invalidation, content-bound approval, and plan identity checks |
| Execution | Crypto exchanges, equity and options brokers, order lifecycle, cancellation, protective exits, and reconciliation |
| Safety | Permission modes, 16-dimension risk classification, constitution limits, kill switches, hooks, trade halts, and signed audit |
| Strategy research | Backtests, walk-forward analysis, Monte Carlo, optimization, robustness checks, and realism diagnostics |
| Agent runtime | Three-agent permission split, cognition phases, memory, loop detection, skills, delegation, and proactive radar |
| Evaluation | Generated scenarios, deterministic process checks, repeated-run `pass^k`, review queues, and optional model judges |

## Market data and research

The canonical read surface covers market data, account state, portfolios, news, and fundamentals. Integration-specific modules add:

- Crypto and broker quotes, candles, balances, positions, and order state
- SEC and EDGAR filings, Yahoo stock headlines, earnings, analyst changes, insider flow, and congressional trades
- Funding, open interest, liquidations, whale activity, and cross-venue observations
- Nansen and Arkham wallet intelligence
- Birdeye and DexScreener DEX data
- DeFiLlama TVL and yield data
- Glassnode onchain metrics
- X sentiment and optional MCP data sources

Data availability depends on configured credentials, provider entitlements, and venue APIs. A configured source is not treated as evidence that every endpoint is available for every account.

## Indicators and advanced analytics

`compute_indicator` exposes 100 named operations through a closed enum. They span trend, momentum, volatility, volume, market structure, statistical filters, and smart-money concepts. Examples include RSI, MACD, Bollinger Bands, ATR, Ichimoku, Supertrend, VWAP, MFI, stochastic RSI, Kalman filters, Markov regimes, divergence, order blocks, fair-value gaps, CUSUM, SADF, fractional differentiation, VPIN, Amihud illiquidity, anchored VWAP, GMMA, MAMA, and exhaustion signals.

`compute_microstructure` is the historical name of a broader 87-operation advanced-analysis dispatcher. It includes genuine microstructure work plus portfolio, statistical, options, fundamental, and robustness operations:

- Microprice, queue dynamics, weighted book imbalance, price discovery, footprint imbalance, naked POC, and market-maker inventory controls
- Correlation breakdown, hedge-ratio estimators, OU fitting, ADF, KPSS, ACF/PACF, Johansen cointegration, and codependence
- HRP allocation, portfolio combination, regime policies, signal pools, Kelly sizing, ruin probability, and time under water
- Black-Scholes, payoff analysis, dealer exposure, vanna, charm, and related options measures
- DCF, DuPont, WACC, fundamental quality, earnings signals, filing diffs, token unlocks, and holder concentration
- Fee sensitivity, stress injection, P/L significance, VaR backtests, population stability, and robustness metrics

The dispatcher accepts typed inputs and throws on an unknown operation. Source: [`analytics.ts`](../src/infra/agents/tools/surface/analytics.ts).

## Strategy and signal research

Gordon includes reusable strategy registries and pure recipe primitives rather than promising a universal alpha library. The research surface includes:

- Six-class regime analysis over a multi-metric model
- Follow-Through-Day confirmation and Distribution-Day clustering
- ATR breakout, regime-RSI, bounce-counter, signal-gate, and max-exposure-timeout recipes
- Complex-wide deleveraging vetoes and crowded-equilibrium fragility analysis
- Game-type classification for positive-, zero-, and negative-sum setups
- Regime and breadth based exposure ceilings
- Avellaneda-Lee eigenportfolio residual signals
- Random-Matrix-Theory covariance denoising and Ledoit-Wolf shrinkage
- Hierarchical Risk Parity and Black-Litterman allocation
- Kalman hedge ratios, constant-velocity trend filtering, and adaptive process noise
- CANSLIM composites, parabolic-short exhaustion, PEAD grading, and higher-order event scenarios
- Markdown playbooks and `EDGE.md` specifications that can retire when live evidence no longer matches the backtest

These are research and control primitives. Their presence does not make a strategy profitable.

## Planning and execution

Plans are explicit objects, not prose that happens to mention an order. Gordon supports:

- Entries, exits, stops, take-profit legs, sizing, rationale, and invalidation conditions
- Bull, base, bear, and tail branches with precommitted allocations and triggers
- Deterministic branch resolution without an LLM in the final dispatch decision
- Plan verification before approval
- Content-bound approval that becomes invalid when the plan changes
- Paper and live execution through the same safety spine
- Limit, market, stop, bracket, and OCO paths where the venue supports them
- Partial fills, cancellations, cancel-replace, reconciliation, and durable order state
- Settled-cash and good-faith-violation accounting with a T+1 pending bucket
- Resting-stop liveness checks for expired, cancelled, or rejected protection
- A deterministic continuous double-auction engine and call-auction uncross for simulation

## Capital safety

Every agent-issued exposure increase passes multiple independent controls:

- Six permission modes from read-only `strict` through bounded `auto`
- Named permission profiles for read-only, paper, and live scopes
- A 16-dimension risk classifier
- An immutable trading constitution with hard sizing, leverage, loss, and concentration ceilings
- A safety-critical deny-list that cannot earn trust-based auto-approval
- Firm, gateway, venue, instrument, account, trader, client, and strategy kill-switch scopes
- Streak, give-back, absorbing-barrier, WIP, clean-state, thesis, mandate, universe, and rate controls
- Required rationale on execution and cancellation
- Pre- and post-order hooks
- Live-consent acknowledgement and known-venue sandbox support checks
- HMAC-chained audit records and trade-ledger state

Protective exits and verified reductions keep separate invariants so a new-risk halt does not prevent flattening. See [Security and safety](./security/README.md).

## Memory, governance, and audit

- Durable operator preferences in bounded working memory
- Model-requested semantic recall instead of automatic cold-memory injection
- Five-stage context compaction with a reversible collapse stage
- Thesis lifecycle: `IDEA -> ENTRY_READY -> ACTIVE -> PARTIALLY_CLOSED -> CLOSED`
- Review dates, MAE/MFE records, and postmortems
- Belief-tension tracking for contradicting observations
- Named approval presets and permission scopes
- Risk-state lineage in which tightening applies directly and loosening needs approval
- Approval lifecycle records that remain visible until applied
- Temperament controls bounded by compiled floors
- Lossless handoff payload storage and parent-absorption records
- Optional cross-session lesson distillation through ACE

## Agent runtime and autonomy

Gordon's orchestrator can delegate to a read-only researcher and an execution-only executor. Runtime capabilities include:

- Tool-free pre-action reasoning
- Extended thinking by workflow phase
- Adversarial critique and citation checking at higher depth
- Provider failover and prompt-cache controls
- Loop detection for identical and alternating tool-call cycles
- Bounded tool-result offload to scratch storage
- Skills loaded on demand for specialized workflows
- Bounded autonomous mandates with expiry, symbol caps, and stall detection
- Independent completion verification and per-cycle gap finding
- Structured `report_blocked` feedback before a loop detector trips

Model-consuming passes are governed by the session cost budget. Operators can disable individual passes when latency or cost matters more than additional review.

## Proactive radar

Twenty-two producers cover trade events, scan opportunities, risk, stops, producer health, kill switches, periodic checks, portfolio drift, position review, regime changes, chart patterns, volatility, funding, news, whales, playbooks, edge assessment, earnings, insider flow, analyst changes, and congressional trades.

Candidates are scored before interruption. Health tracking can report a dead producer rather than silently treating its absence as a calm market.

## Backtesting and validation

- Historical replay and event replay
- Walk-forward evaluation
- Monte Carlo paths
- Grid and random optimization
- Fee-sensitivity and market-impact analysis
- Alpha-decay and cross-sectional checks
- Bar-permutation and overfitting guards
- Stylized-fact realism checks for fat tails, volatility clustering, Zumbach asymmetry, gain/loss skew, and aggregational Gaussianity
- Regret review at later horizons for rejected candidates
- Forward-outcome setup cohorts
- Inaction-value and strategy-pivot counterfactuals

A backtest remains evidence about a historical simulation, not proof of a live edge.

## Evaluation and continuous review

The agent-quality harness generates scenarios from runtime sources instead of maintaining a second hand-written policy corpus. It can evaluate:

- Final-answer quality with category-specific rubrics
- Required and forbidden actions in a recorded tool sequence
- Multi-turn clarification behavior
- Reliability across repeated runs through `pass^k`
- Failure classes across unsuccessful runs
- Cross-family judge panels when model scoring is enabled
- Production traces adapted into review and promotion queues
- Baseline-versus-candidate regressions

CI uses deterministic scenarios and process checks without requiring live model inference. Live evaluation remains opt-in because it can touch audit and permission state.

## Opt-in Mastra capabilities

These features add Mastra-native behavior on top of Gordon's own gates:

| Setting | Capability |
|---|---|
| `GORDON_MASTRA_PROCESSORS` | Prompt-injection, PII, and moderation processors on model I/O |
| `GORDON_OBSERVATIONAL_MEMORY` | Background observational-memory compaction |
| `GORDON_NATIVE_SUPERVISOR` | Native supervisor routing for subagent handoff |
| `GORDON_DURABLE_AGENTS` | Snapshot-backed autonomous loops that can resume after restart |
| `GORDON_NATIVE_TOOL_APPROVAL` | Native approval predicates that still defer to Gordon's risk gates |

Core analysis, sizing, risk, and protective-halt primitives are not replaced by these options.

## Source map

| Capability | Source |
|---|---|
| Canonical tool registry | [`src/infra/agents/tools/surface/`](../src/infra/agents/tools/surface/) |
| Indicator implementations | [`src/core/indicators/`](../src/core/indicators/) |
| Strategy implementations | [`src/core/strategies/`](../src/core/strategies/) |
| Backtest engine | [`src/backtest/`](../src/backtest/) |
| Execution tools | [`src/infra/agents/tools/trading/`](../src/infra/agents/tools/trading/) |
| Safety controls | [`src/infra/safety/`](../src/infra/safety/) |
| Risk models | [`src/infra/trading/risk/`](../src/infra/trading/risk/) |
| Memory | [`src/infra/domain/memory/`](../src/infra/domain/memory/) |
| Evaluation harness | [`src/infra/domain/evals/harness/`](../src/infra/domain/evals/harness/) |
| Proactive radar | [`src/infra/proactive/`](../src/infra/proactive/) |

## Related guides

- [Architecture](./architecture.md)
- [Integrations](./integrations.md)
- [Operations](./operations.md)
- [Security and safety](./security/README.md)
