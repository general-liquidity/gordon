<!-- prettier-ignore -->
<p align="center">
  <img src="./assets/gordon-banner.gif" alt="Gordon terminal banner" width="520" />
</p>

<h1 align="center">Gordon</h1>

<p align="center"><strong>The Frontier Trading Agent</strong></p>
<p align="center"><em>Talk to it like a desk partner. It can't talk its way past your risk limits.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@general-liquidity/gordon"><img alt="npm version" src="https://img.shields.io/npm/v/@general-liquidity/gordon?style=flat-square&color=34eeb0&label=npm" /></a>
  <a href="https://github.com/general-liquidity/gordon/actions"><img alt="build" src="https://img.shields.io/github/actions/workflow/status/general-liquidity/gordon/release.yml?style=flat-square&label=build" /></a>
  <a href="https://bun.sh"><img alt="Bun 1.0 or newer" src="https://img.shields.io/badge/Bun-%3E%3D1.0-14151a?style=flat-square&logo=bun&logoColor=fbf0df" /></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white" /></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#safety-model">Safety</a> ·
  <a href="#integrations">Integrations</a> ·
  <a href="#capabilities">Capabilities</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="./docs/README.md">Documentation</a>
</p>

Gordon is an open-source AI trading agent for crypto, equities, options, and futures. State an intent in plain language, review the structured plan, and let a deny-first harness decide whether an agent-issued exposure increase may reach a venue.

The model proposes. The harness disposes.

Gordon runs on your machine with your keys and accounts. Local settings, memory, and audit state remain local. Configured model providers, venues, data sources, and MCP servers still receive the requests needed to operate; anonymous Gordon telemetry is disabled until you explicitly enable it.

## At a glance

| | Gordon |
|---|---|
| Product shape | Supervised, plan-first trading agent with deterministic capital controls |
| Markets | Crypto, equities, options, and futures through supported venues |
| Agent boundary | Orchestrator, read-only researcher, execution-only executor |
| Default posture | `ask` mode; every live exposure increase needs approval |
| Safety plane | Permission engine, 16-dimension risk classifier, constitution, kill switches, hooks, audit |
| Interfaces | TUI, headless CLI, daemon and schedules, ACP, MCP |
| Local state | Settings, memory, audit log, telemetry queue, and runtime data under operator control |

> [!WARNING]
> Gordon can place real orders when armed. Trading can lose money, and nothing in this repository is investment advice. Start in `strict` or `paper`, read [DISCLAIMER.md](./DISCLAIMER.md) and [TERMS.md](./TERMS.md), and never arm capital you cannot afford to lose.

## Quick start

Install the published binary wrapper:

```bash
npm install -g @general-liquidity/gordon
gordon
```

The wrapper selects a prebuilt binary for macOS arm64/x64, Linux x64/arm64 with glibc or musl, and Windows x64/arm64. Node.js 18 or newer is required by the wrapper. Building from source requires Bun 1.0 or newer.

First run walks through a model provider, venues, permission mode, and operator preferences. For a shell-based start, configure one model provider and only the venues you use:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."     # or OpenAI, Google, or xAI
export BINANCE_API_KEY="..."
export BINANCE_API_SECRET="..."

gordon
```

Then start with read, analysis, and planning commands:

```text
/strict          keep the session read-only
/doctor          inspect config, credentials, permissions, and connectivity
/scan            find current market movement
/analyze BTC     run a multi-timeframe workup
/plan ETH        draft a structured plan without assuming execution
/backtest        replay a strategy on historical data
/portfolio       inspect positions, cash, and P/L
/killswitch      inspect or change scoped halts
/flags           inspect and persist operator settings
```

> [!TIP]
> Copy the fields you need from [`.env.example`](./.env.example) into `~/.gordon/.env`. Keep credentials out of repository files. The complete first-run guide is [docs/getting-started.md](./docs/getting-started.md).

## From intent to execution

The example below is an illustrative mock-up, not a captured session or performance claim.

```text
you > find me a clean BTC long for the NY session, about 1R risk

gordon > BTC/USDT | $67,420 | 1H consolidation on declining volatility
         Setup: breakout-retest long above 67,650 VWAP reclaim
         Regime: risk-on, DXY soft, funding neutral

         +-------------------------------------------------------+
         | BUY   0.08 BTC @ 67,680  limit, post-only             |
         | STOP  0.08 BTC @ 66,990  stop-market                  |
         | SELL  0.04 BTC @ 68,380  TP1                          |
         | SELL  0.04 BTC @ 68,780  TP2                          |
         +-------------------------------------------------------+
         Risk: $27 on $10k | R:R 1:1.6 | allocation 5.4%
         Risk gate: PASS, 16/16 available dimensions | constitution: clean

         [ approve ]  [ modify ]  [ reject ]  [ backtest ]
```

A discretionary exposure increase becomes a structured plan, receives a content-bound approval when required, and passes the execution chain before dispatch. Change a leg and the approval no longer matches. Verified reductions and protective recovery remain available under separate bounded rules so a new-risk halt cannot trap an existing position.

## Why Gordon

A model that can discuss a chart is not automatically safe to connect to capital. It still needs limits, permissions, approvals, durable state, disciplined execution, and failure modes that do not improvise around missing evidence.

Gordon is built around three convictions:

- **The model proposes, the harness disposes.** Model output is an input to policy, never policy itself.
- **Plan first for new risk.** A discretionary exposure increase becomes an inspectable object before it becomes an order.
- **Deny first, not trust first.** Authority is earned through explicit scopes and deterministic checks, not confident language.

Read [Why Gordon](./docs/why-gordon.md) for the longer argument, comparison with rule-based bots, and product boundaries.

## Safety model

An agent-issued exposure increase must survive every applicable layer:

| Layer | What it owns |
|---|---|
| Paper and live boundary | Verified paper paths where observable; refusal instead of silent live routing on known unsupported venues |
| Permission engine | Deny-first policy and hook decisions on tool calls |
| Risk classifier | Eight base and up to eight conditional dimensions, producing a tier and action |
| Trading constitution | Immutable size, leverage, loss, drawdown, and concentration ceilings |
| Trust deny-list | Money movement and other safety-critical tools never earn trust-based auto-approval |
| Trade halts | Streak, give-back, absorbing-barrier, WIP, rate, thesis, mandate, universe, and clean-state controls |
| Kill switches | Durable firm, gateway, venue, instrument, account, trader, client, and strategy halts |
| Hooks | 14 lifecycle points around tools, approvals, orders, sessions, compaction, and subagents |
| Audit and ledger | HMAC-chained decisions, rationale, portfolio state, orders, and reconciliation |

The risk kernel starts with a `1x` configurable leverage default. The compiled trading constitution caps leverage at `3x`. A separate `5x` CCXT adapter fallback is not the global risk default.

### Permission modes

Every mode keeps deterministic safety controls and audit active. The mode changes how far the agent may act without another approval.

| Mode | Read | Plan | Paper | Live | Meaning |
|---|:---:|:---:|:---:|:---:|---|
| `strict` | Yes | No | No | No | Read-only |
| `observe` | Yes | No | No | No | Read plus suggestions |
| `plan` | Yes | Yes | No | No | Create plans, never dispatch |
| `paper` | Yes | Yes | Requested | No | Request paper execution; verify the selected venue's behavior |
| `ask` | Yes | Yes | Yes | Approval | Default; each live exposure increase needs approval |
| `auto` | Yes | Yes | Yes | Within gates | No per-order prompt, with every deterministic gate intact |

See [Security and safety](./docs/security/README.md) for the full chain, operator checklist, permission profiles, credential boundary, and narrow threat-model documents.

## How Gordon works

Three agents split responsibility along a security boundary:

- **Gordon** routes, supervises, and synthesizes. It never trades directly.
- **Researcher** scans, analyzes, and backtests through a read-only, time-boxed surface.
- **Executor** holds the execution tools and cannot bypass the safety plane that wraps them.

Around them, the runtime supplies:

- A canonical 22-tool surface for data, analytics, planning, execution, memory, and workflow
- 100 indicator operations and 87 advanced-analysis operations behind two typed dispatchers
- Five-stage context compaction at 70, 80, 90, 94, and 99 percent pressure
- Identical-call and alternating-cycle loop detection
- 22 proactive radar producers with health tracking
- Tool-free reasoning, extended thinking, critique, and citation review governed by a cost budget
- Deterministic evaluation scenarios, process checks, and repeated-run `pass^k`

Detailed capability and source maps live in [Capabilities](./docs/capabilities.md) and [Architecture](./docs/architecture.md).

## Run surfaces

| Surface | Start with | Purpose |
|---|---|---|
| TUI | `gordon` | Full Desk, Market, Plan, Lab, and Monitor terminal workspaces |
| Headless | `gordon --headless "prompt"` | One bounded turn for scripts and pipes |
| Daemon | `gordon daemon start` | Authenticated local IPC, schedules, reconciliation, and circuit breakers |
| ACP | `npm run acp` | JSON-RPC over stdio for editors such as Zed and Athas |
| MCP | `npm run mcp` | Gordon tools for compatible external hosts |
| Schedules | `gordon schedule add ...` | Cron-style autonomous mandates through the daemon |

Raw Bun source entry invocation is unsupported because a caller-controlled working directory can preload `bunfig.toml` before Gordon's first instruction. Use the published `gordon` command, `node bin/gordon.cjs`, `npm run acp`, or `npm run mcp`.

See [Operations](./docs/operations.md) for daemon behavior, settings precedence, managed policy, telemetry, hooks, and supported launch paths.

## Integrations

Gordon is model-, venue-, and host-agnostic. The first-class venues below have curated credential names and capability metadata; long-tail CCXT venues are routable but carry narrower Gordon-specific evidence.

### Crypto exchanges

| Exchange | Exchange | Exchange |
|---|---|---|
| <img height="16" align="top" src="./assets/integrations/binance.svg" alt="" /> Binance | <img height="16" align="top" src="./assets/integrations/binance.svg" alt="" /> Binance US | <img height="16" align="top" src="./assets/integrations/coinbase.png" alt="" /> Coinbase |
| <img height="16" align="top" src="./assets/integrations/kraken.png" alt="" /> Kraken | Bitfinex | <img height="16" align="top" src="./assets/integrations/hyperliquid.png" alt="" /> Hyperliquid |
| <img height="16" align="top" src="./assets/integrations/robinhood.svg" alt="" /> Robinhood Crypto | <img height="16" align="top" src="./assets/integrations/okx.svg" alt="" /> OKX | <img height="16" align="top" src="./assets/integrations/gemini-exchange.png" alt="" /> Gemini |

All nine first-class exchange identifiers use the CCXT runtime adapter. The broader `ccxt:<id>` catalog includes Bybit, KuCoin, MEXC, and other exchanges supported by the installed CCXT release.

### Equity and options brokers

| Broker | Coverage | Paper-path status |
|---|---|---|
| <img height="16" align="top" src="./assets/integrations/alpaca.png" alt="" /> Alpaca | US equities, options, crypto | Explicit paper endpoint |
| <img height="16" align="top" src="./assets/integrations/tastytrade.png" alt="" /> tastytrade | Options, equities, futures workflows | Certification environment when configured |
| <img height="16" align="top" src="./assets/integrations/ibkr.png" alt="" /> Interactive Brokers | Global multi-asset execution | Paper versus live is not observable from the local gateway |

### Models and hosts

| Models | Editors and hosts |
|---|---|
| <img height="16" align="top" src="./assets/integrations/anthropic.svg" alt="" /> Anthropic Claude | <img height="16" align="top" src="./assets/integrations/zed.png" alt="" /> Zed through ACP |
| <img height="16" align="top" src="./assets/integrations/openai.png" alt="" /> OpenAI GPT | <img height="16" align="top" src="./assets/integrations/athas.png" alt="" /> Athas through ACP |
| <img height="16" align="top" src="./assets/integrations/google-gemini.svg" alt="" /> Google Gemini | <img height="16" align="top" src="./assets/integrations/cursor.png" alt="" /> Cursor through MCP |
| xAI Grok | <img height="16" align="top" src="./assets/integrations/warp.png" alt="" /> Warp through MCP |
| Frontier labs, gateways, and local OpenAI-compatible hosts | <img height="16" align="top" src="./assets/integrations/claude.png" alt="" /> Claude Desktop and <img height="16" align="top" src="./assets/integrations/devin.png" alt="" /> Devin through MCP |

Finnhub, SEC and EDGAR, Yahoo, X, Nansen, Arkham, Birdeye, DeFiLlama, Glassnode, DexScreener, and external MCP servers extend the data and tool surface. See [Integrations](./docs/integrations.md) for credential boundaries, venue caveats, and the complete catalog.

## Capabilities

| Area | Selected capabilities |
|---|---|
| Analysis | Technical indicators, market structure, regime detection, statistical tests, fundamentals, options, onchain, and portfolio analytics |
| Strategy | Playbooks, pure signal recipes, scenario branches, edge lifecycle, allocation, and signal combination |
| Execution | Structured plans, paper and live adapters, order lifecycle, cancellation, protective exits, and reconciliation |
| Backtesting | Historical replay, walk-forward, Monte Carlo, optimization, impact, fees, and overfitting checks |
| Governance | Permission profiles, approvals, rationale, risk-state lineage, memory controls, and signed audit |
| Evaluation | Generated scenarios, deterministic process rules, repeated-run reliability, review queues, and optional judge panels |
| Autonomy | Schedules, bounded mandates, radar, subagent delegation, recovery, and completion verification |

The [capability guide](./docs/capabilities.md) preserves the detailed inventory that previously lived in nested README disclosures.

## Architecture

```text
surfaces       TUI | headless | daemon/IPC | ACP | MCP | schedules
                                  |
orchestration  Gordon -> Researcher, read-only
                      `-> Executor, execution-only
               cognition | memory | loop detection
                                  |
governance     permission engine | 16-dimension risk classifier
               constitution | trust deny-list | kill switches | hooks | audit
                                  |
tools          canonical 22-tool surface plus integration-specific tools
                                  |
venues/data    CCXT exchanges | brokers | filings | news | onchain
                                  |
state          LibSQL and vector memory | SQLite audit | local event bus
```

The [architecture guide](./docs/architecture.md) explains each boundary and links to the owning source.

## Tech stack

| Technology | Role |
|---|---|
| <img height="16" align="top" src="./assets/stack/bun.png" alt="" /> [Bun](https://bun.sh) | Runtime, bundler, and test runner |
| <img height="16" align="top" src="./assets/stack/typescript.svg" alt="" /> TypeScript | Language in strict mode |
| <img height="16" align="top" src="./assets/stack/node.svg" alt="" /> Node.js | Published npm-wrapper runtime |
| <img height="16" align="top" src="./assets/stack/react.svg" alt="" /> React 19 | TUI component model |
| Ink 6 | Terminal renderer and custom framebuffer |
| <img height="16" align="top" src="./assets/stack/mastra.png" alt="" /> [Mastra](https://mastra.ai) | Multi-agent framework |
| <img height="16" align="top" src="./assets/stack/aisdk.png" alt="" /> AI SDK | Model calls through Mastra's router |
| <img height="16" align="top" src="./assets/stack/libsql.png" alt="" /> [LibSQL / Turso](https://turso.tech/libsql) | SQL and vector memory; SQLite for audit |
| <img height="16" align="top" src="./assets/stack/zod.svg" alt="" /> [Zod](https://zod.dev) | Tool and configuration schemas |
| <img height="16" align="top" src="./assets/stack/ccxt.png" alt="" /> [CCXT](https://ccxt.com) | Crypto exchange connectivity |
| <img height="16" align="top" src="./assets/stack/mcp.png" alt="" /> [MCP](https://modelcontextprotocol.io) | External tool servers |
| <img height="16" align="top" src="./assets/stack/acp.png" alt="" /> [ACP](https://agentclientprotocol.com) | Editor and IDE integration |
| <img height="16" align="top" src="./assets/stack/biome.svg" alt="" /> Biome | Lint and format |
| <img height="16" align="top" src="./assets/stack/opentelemetry.svg" alt="" /> OpenTelemetry | Local tracing and metrics |

## Scope and limitations

- A backtest is not an edge. Robustness checks reduce self-deception; they do not create live alpha.
- Model inference costs money and adds latency. Use `GORDON_COST_BUDGET_USD` and tune reasoning passes for the job.
- Venue coverage is uneven. Account enrollment, entitlements, gateways, and endpoint support differ.
- Paper status is not observable on every venue. IBKR account mode is determined outside the adapter, and long-tail CCXT sandbox behavior must be verified.
- The agent can be wrong. `ask` requires approval for live exposure increases; `auto` deliberately removes that prompt while keeping deterministic gates.
- The Windows arm64 binary is best-effort. Other release targets are built and smoke-tested on every release.
- Gordon is young software, MIT licensed, and provided without warranty. Read the source on paths that touch money.

## Documentation

| Guide | Use it for |
|---|---|
| [Documentation index](./docs/README.md) | Task-based map of maintained and historical documents |
| [Getting started](./docs/getting-started.md) | Installation, first configuration, and a safe first plan |
| [Why Gordon](./docs/why-gordon.md) | Product thesis, design convictions, comparison, and non-goals |
| [Capabilities](./docs/capabilities.md) | Complete feature inventory and source map |
| [Architecture](./docs/architecture.md) | Agents, tools, safety boundaries, memory, radar, and evaluation |
| [Integrations](./docs/integrations.md) | Exchanges, brokers, models, data, editors, and credentials |
| [Operations](./docs/operations.md) | TUI, headless, daemon, ACP, MCP, schedules, settings, and telemetry |
| [Security and safety](./docs/security/README.md) | Permission modes, risk, halts, credentials, and operator checklist |
| [Contributing](./CONTRIBUTING.md) | Development setup and the bar for money-touching changes |
| [Security policy](./SECURITY.md) | Supported versions and private vulnerability reporting |

## Development

```bash
bun install
bun run dev
bun test
bun run typecheck
bun run check
bun run check:docs
bun run quality:brokers
```

CI runs type checking, test shards, lint and formatting, broker conformance, dependency audit, evaluation gates, wrapper smoke tests, and publication guards. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## Sharpe suite

| Project | Purpose |
|---|---|
| [SharpeArena](https://github.com/general-liquidity/sharpearena) | Deterministic trading-agent sandbox and reinforcement-learning environment |
| [SharpeBench](https://github.com/general-liquidity/sharpebench) | Luck-robust benchmark for quantitative trading agents |

Gordon is MIT licensed. Issues and pull requests are welcome; report security problems through [SECURITY.md](./SECURITY.md), not a public issue.

<p align="center"><sub><em>“The most valuable commodity I know of is information.”</em><br />Gordon Gekko</sub></p>
