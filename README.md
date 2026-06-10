<!-- prettier-ignore -->
<div align="center">

<img src="./assets/gordon_banner.png" alt="Gordon" height="96" />

### The Frontier Trading Agent

*Claude Code for vibe trading — talk naturally, trade confidently, sleep peacefully.*

[![npm version](https://img.shields.io/npm/v/@general-liquidity/gordon-cli?style=flat-square&color=34eeb0&label=npm)](https://www.npmjs.com/package/@general-liquidity/gordon-cli)
[![Build](https://img.shields.io/github/actions/workflow/status/general-liquidity/gordon-cli/release.yml?style=flat-square&label=build)](https://github.com/general-liquidity/gordon-cli/actions)
[![Node.js](https://img.shields.io/badge/Node.js->=18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/Bun->=1.0-14151a?style=flat-square&logo=bun&logoColor=fbf0df)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

[Overview](#overview) • [Features](#features) • [Install](#install) • [Quick start](#quick-start) • [Permission modes](#permission-modes) • [Architecture](#architecture)

</div>

---

## Overview

**Gordon is Claude Code for vibe trading.** Talk to it like you'd talk to a sharp desk partner — describe the setup, the risk, the vibe — and Gordon coordinates the research, the plan, the venue, and the execution. No dashboards, no charts to squint at, no twelve-tab cockpit. Just a terminal, a chat, and an agent that actually knows how markets work.

Gordon is a CLI trading desk — not a chat app with trading bolted on. Every decision in the product serves one goal: **the trader makes better decisions faster.** It adapts to the three speeds of a real desk:

- **Glance** *(0.2s)* — P/L, positions, alerts, regime, in one screen.
- **Read** *(2–5s)* — analysis, plans, risk, backtests, structured and skimmable.
- **Work** *(30s+)* — strategy authoring, backtests, playbooks, full-screen panels.

Under the hood it's a serious piece of kit: a terminal-native agent for discretionary *and* systematic trading across crypto and stocks, with real venue adapters, plan-first execution, six permission modes, and a proper backtesting engine. But you'll mostly just talk to it.

- **Crypto and stocks** in one interface, via real exchange and broker adapters (no mock quotes).
- **Plan-first by default**: nothing hits a venue until you preview and approve it.
- **Six permission modes** let you dial the blast radius from read-only research to fully autonomous.
- **Agent-native**: built on Mastra with handoffs, cross-agent memory, and MCP plugin support.

> [!WARNING]
> Gordon places real orders on real venues when armed. Trading is risky, you can lose money, and nothing in this repo is investment advice. Read the source, start in `paper` or `strict` mode, and never ARM capital you can't afford to lose.

## Example

```
you › find me a clean BTC long for the NY session, ~1R risk

gordon › BTC/USDT · $67,420 · 1H consolidation coiling on declining vol
         Setup: breakout-retest long above 67,650 VWAP reclaim
         Regime: risk-on, DXY soft, funding neutral
         Edge:  recent 20d hit rate 58%, avg 1.4R, expectancy +0.31R

         ┌─ Plan ──────────────────────────────────────────────┐
         │ + BUY   0.08 BTC @ 67,680  limit (post-only)        │
         │ + STOP  0.08 BTC @ 66,990  stop-market (-1.02%)     │
         │ + SELL  0.04 BTC @ 68,380  TP1 (+1.03%)             │
         │ + SELL  0.04 BTC @ 68,780  TP2 (+1.62%)             │
         └─────────────────────────────────────────────────────┘
         Risk: $27 on $10k · R:R 1:1.6 · allocation 5.4%

         [ approve ]  [ modify ]  [ reject ]  [ backtest ]
```

## Features

### Research and discovery
- **Market-wide scanners** — trending, top movers, breakouts, regime classification, whale alerts, new listings.
- **Deep-dive workflows** — `/dd`, `/research`, `/morning-brief`, `/radar`, `/quick-scan` — each wired to a curated tool chain and a domain skill.
- **Multi-timeframe TA** — RSI, MACD, Bollinger, ATR, VWAP, Stochastic RSI, EMA/SMA, volume profile, support/resistance auto-detection.
- **Onchain data (read-only)** — DexScreener, DefiLlama, CoinGecko-onchain, Birdeye, Codex, 1inch price sources plus wallet-intelligence providers (Nansen, Arkham, Covalent, Moralis, Zerion, DeBank).
- **Fundamentals** — Finnhub stocks/ETFs/indices/bonds/crypto/macro, SEC filings, LLM-enriched quotes, news entity extraction.

### Plans and execution
- **Plan-as-diff approval** — every trade is previewed as a structured diff before anything hits a venue.
- **Bracket, grid, DCA, OCO** — multi-leg plans with trailing stops and partial take-profits.
- **Order recovery** — interrupted or failed executions are reconciled and retried idempotently.
- **Risk gates** — Kelly sizing, volatility sizing, exposure caps, drawdown limits, venue-level circuit breakers.

### Systematic and backtesting
- **Strategy library** — tier-1 (support bounce, Bollinger bounce, SMA crossover, volume surge, VWAP) and tier-2 (ADX, EMA-RSI, relative strength, engulfing, consolidation pop), plus a weighted ensemble.
- **Full backtesting engine** — historical simulation, Monte Carlo, walk-forward validation, grid-search optimization, alpha-decay detection.
- **Slot runtime** — run strategies against live data in dedicated slots with per-slot PnL, risk budget, and kill switches.
- **Operator reports** — Sharpe, Sortino, max drawdown, profit factor, hit rate, expectancy, bias diagnostics.

### Venues
| Kind       | Integrations |
|------------|--------------|
| CEX (spot) | Binance, Coinbase, Kraken, Bitfinex, Gemini, OKX |
| CEX (perp) | Hyperliquid |
| Brokers    | Alpaca, Schwab, Interactive Brokers, E*TRADE, Tastytrade, TradeStation, Tradier, Trading 212, Webull |
| Onchain data | DexScreener, DefiLlama, Birdeye, Codex, 1inch, wallet intel (Nansen, Arkham, …) |
| Rails      | MoonPay, Polygon x402 |

Adapters conform to a shared contract and pass an inclusion gate and conformance matrix in CI — broker quality is measured, not assumed.

### Runtime and safety
- **Six permission modes** (`auto`, `ask`, `strict`, `paper`, `observe`, `plan`) with a single truth-table enforced across every tool.
- **Static preflight + runtime approval** — two independent layers decide whether a tool may run.
- **Input guardrails** — prompt-injection detection, dangerous command blocking, output sanitization.
- **Rate limiting** — per-agent, per-tool, per-minute; backoff on venue 429s.
- **Audit log** — every sensitive operation is persisted with the parameters, result, and caller.
- **Telemetry** — OpenTelemetry tracing + metrics, optional Mastra observability export.

### Agent runtime
- **Mastra agent network** — a router (Gordon) plus specialist subagents for research and execution, with validated handoffs and cross-agent shared context.
- **Semantic memory** — LibSQL Vector store for RAG recall of past analyses, plans, and outcomes.
- **Proactive engine** — an observer loop plus producers and an LLM judge that surface suggestions without interrupting you.
- **Hooks** — `PreToolUse`, `PreOrderPlacement`, `PostSession`, and others for deterministic side-channels.
- **MCP plugin support** — install, route, and lazy-load external tool servers through `@mastra/mcp`.
- **Skills** — authored in Markdown (`best-practices`, `dd`, `exit-review`, `morning-brief`, `quick-scan`, `radar`, `rebalance`, `research`, `risk-check`) and composed into prompts on demand.

### Terminal UI
- **Ink 6 + React 19** — streaming chat, agent badges, cost and latency inline, collapsible tool calls, syntax-highlighted code blocks, markdown tables and fenced plans.
- **Workspaces** — Desk, Market, Plan, Lab, Monitor — each with its own quick actions and keybindings.
- **Slash commands** — fuzzy autocomplete, runtime drift detection so the registry can never lie.
- **Theme** — Neon Mint by default, dimmed for long sessions, full 24-bit color where supported.

## Install

> [!NOTE]
> **Requirements:** Node.js ≥ 18 (for the npm wrapper) or [Bun](https://bun.sh) ≥ 1.0 (for from-source). A 64-bit terminal that supports true color is strongly recommended.

```bash
npm install -g @general-liquidity/gordon-cli
```

The npm wrapper downloads the prebuilt binary for your platform on first install (macOS arm64/x64, Linux x64/arm64 glibc + musl, Windows x64/arm64). No global Node process is kept in memory — the installed `gordon` command is the binary itself.

<details>
<summary>Other install methods</summary>

**Bun**
```bash
bun add -g @general-liquidity/gordon-cli
```

**curl (standalone binary)**
```bash
curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon-cli/main/scripts/install.sh | sh
```

**From source**
```bash
git clone https://github.com/general-liquidity/gordon-cli.git
cd gordon-cli
bun install
bun run build
bun start
```
</details>

## Quick start

```bash
gordon
```

On first run Gordon walks you through setup: LLM provider, execution venues, default permission mode, and preferences. Config lives at `~/.gordon/config.json` and never leaves your machine.

Set at least one LLM provider and one venue before you can place real orders:

```bash
# Pick one LLM provider (or more)
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_GENERATIVE_AI_API_KEY="..."
export DEDALUS_API_KEY="dd-..."       # single key, 20+ routed models

# Crypto venue (example: Binance)
export BINANCE_API_KEY="..."
export BINANCE_API_SECRET="..."

# Stocks broker (example: Alpaca)
export ALPACA_API_KEY_ID="..."
export ALPACA_API_SECRET_KEY="..."
```

> [!TIP]
> Start in `paper` or `strict` mode. Use `/doctor` at any time to see which venues are configured, which credentials are missing, and what permissions each is granted.

Useful commands once you're in:

```
/scan            discover what's moving right now
/analyze BTC     multi-timeframe workup on one symbol
/plan ETH        draft a trade plan (no orders placed)
/preview-order   render the next plan as a venue-ready diff
/backtest        run a strategy over historical data
/portfolio       positions, cash, P/L across venues
/runtime-state   what strategies/slots are live
/paper /ask /strict /observe /plan /auto
                 switch permission mode
/doctor          connectivity + config + permissions health check
/help            full command index grouped by workflow
```

## Permission modes

Gordon enforces the same truth table everywhere — in the static preflight, in the runtime approval engine, and in each venue adapter.

| Mode      | Read market | Draft plans | Paper execute | Live execute | Notes |
|-----------|:-----------:|:-----------:|:-------------:|:------------:|-------|
| `strict`  | ✓           | ✗           | ✗             | ✗            | Read-only. Nothing can be written, even scratchpads. |
| `observe` | ✓           | ✗           | ✗             | ✗            | Pure observation. Proactive suggestions may fire, nothing executes. |
| `plan`    | ✓           | ✓           | ✗             | ✗            | Planning-only. Plans are created but never dispatched. |
| `paper`   | ✓           | ✓           | ✓             | ✗            | Paper execution when the engine is wired; real orders blocked. |
| `ask`     | ✓           | ✓           | ✓             | ✓ (per-action) | Default. Every trade-impacting tool requires explicit approval. |
| `auto`    | ✓           | ✓           | ✓             | ✓            | Fully autonomous within risk gates. Reserved for systematic slots. |

> [!IMPORTANT]
> `auto` mode is not "no guardrails" — every order still passes through risk sizing, exposure caps, drawdown checks, and audit logging. It simply removes the per-order human confirmation step.

## Tech stack

| Layer          | Choice                                                                 |
|----------------|------------------------------------------------------------------------|
| Runtime        | [Bun](https://bun.sh) ≥ 1.0 (bundling, standalone binary, test runner) |
| Language       | TypeScript 5, strict mode, `noUncheckedIndexedAccess`                  |
| TUI            | [Ink](https://github.com/vadimdemedes/ink) 6 + React 19                |
| Agents         | [Mastra](https://mastra.ai) (`@mastra/core` + memory + MCP + otel)     |
| Memory         | [LibSQL](https://turso.tech/libsql) (SQL + vector) + SQLite (audit)    |
| LLM providers  | OpenAI, Anthropic, Google Gemini, Dedalus (OpenAI-compatible router)   |
| Venues         | Native clients (Binance, Hyperliquid) + [ccxt](https://ccxt.com) fleet + broker REST adapters |
| Onchain data   | DexScreener, DefiLlama, Birdeye, Codex, 1inch, wallet-intel adapters |
| Schemas        | [Zod](https://zod.dev) 4 for every tool input/output and config        |
| Observability  | OpenTelemetry traces + metrics, Mastra observability export            |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                              you                                   │
└─────────────────────────────────────────────────────────────────────┘
                               │ chat / slash commands
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  TUI  ·  Ink 6  +  React 19                         │
│  workspaces · streaming chat · approvals · workflows · themes       │
└─────────────────────────────────────────────────────────────────────┘
                               │ typed runtime events
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          agent runtime                              │
│   ┌──────────┐    ┌────────────┐    ┌──────────┐                    │
│   │  Gordon  │ ─► │ Researcher │    │ Executor │                    │
│   │ (router) │    └────────────┘    └──────────┘                    │
│   └──────────┘                                                      │
│   handoffs · shared context · semantic memory · hooks · MCP         │
└─────────────────────────────────────────────────────────────────────┘
                               │ tool calls
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       guardrails and policy                         │
│   input guards · access control · rate limit · risk gate · audit    │
└─────────────────────────────────────────────────────────────────────┘
                               │ permitted calls
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          tools  ·  ~90 modules                      │
│  discovery · analysis · plans · execution · backtest · portfolio    │
│  onchain data · wallet intel · Finnhub · MoonPay · ccxt             │
└─────────────────────────────────────────────────────────────────────┘
                               │ adapter contracts
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 venues, rails, and data sources                     │
│  exchanges · brokers · protocols · onchain · market data · news     │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          infrastructure                             │
│  LibSQL (SQL + vector) · SQLite · OpenTelemetry · event bus · cache │
└─────────────────────────────────────────────────────────────────────┘
```

## Development

Prerequisites: [Bun](https://bun.sh) ≥ 1.0 and Node.js ≥ 18.

```bash
bun install         # install deps
bun run dev         # hot-reload TUI
bun test            # run all tests (Bun test runner)
bun run typecheck   # tsc --noEmit
bun run build       # bundle to dist/ (programmatic Bun.build)
bun run build:binary # compile a single standalone executable
```

Useful diagnostics:

```bash
bun run quality:brokers          # broker conformance + latency gate
bun run test:broker-conformance  # adapter contract tests
bun run check:no-sourcemaps      # guard against source map leaks
bun run audit:npm-pack           # audit npm wrapper contents
```

### Testing

Gordon uses Bun's built-in test runner — no Jest, no Vitest, no config. Tests live next to the code they cover (`foo.ts` + `foo.test.ts`).

```bash
bun test                         # run the whole suite
bun test src/infra/agents/       # scope to a directory
bun test -t "execute_plan"       # scope by test name
bun run test:broker-conformance  # adapter contract + matrix tests
```

CI runs the full suite, `tsc --noEmit`, broker conformance, the latency quality gate, and guardrails that block source-map leaks and unexpected files in the npm tarball before any publish step.

### Project layout

```
src/
├── app/             slash commands, command UX, runtime presenters
├── tui/             Ink components, bridge, workspaces, themes
├── core/            trading logic, scheduler, autonomous loop
├── infra/
│   ├── agents/      Mastra agents, tools, middleware, skills, memory
│   ├── venues/      exchange + broker adapter clients
│   ├── broker/      broker adapter contract + conformance
│   ├── exchange/    exchange adapter contract
│   ├── runtime/     actions, rails, routing, providers, action-log
│   ├── ai/          llm + mcp + providers
│   ├── data/        cache, news, filings, quotes, LLM enrichment
│   ├── platform/    telemetry, observability, resilience, hooks
│   ├── proactive/   suggestion engine, producers, LLM judge
│   ├── domain/      markets, systematic, memory, evals, integrations
│   └── storage/     SQLite + config + audit
├── backtest/        engine, Monte Carlo, walk-forward, optimization
├── strategies/      tier-1, tier-2, ensemble
├── runtime/         tool policy, capability registry
├── events/          typed event bus
└── types/           Zod schemas + TypeScript types
```

## Links

- [npm](https://www.npmjs.com/package/@general-liquidity/gordon-cli)
- [Issues](https://github.com/general-liquidity/gordon-cli/issues)
- [Releases](https://github.com/general-liquidity/gordon-cli/releases)

---

<div align="center">
<sub><em>"The most valuable commodity I know of is information."</em> — Gordon Gekko</sub>
</div>
