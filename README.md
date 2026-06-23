<!-- prettier-ignore -->
<div align="center">

<img src="./assets/gordon_banner.png" alt="Gordon" height="96" />

### The Frontier Trading Agent

*A terminal-native AI trading agent for crypto and stocks. Talk to it like a desk partner — and it can't talk its way past your risk limits.*

[![npm version](https://img.shields.io/npm/v/@general-liquidity/gordon-cli?style=flat-square&color=34eeb0&label=npm)](https://www.npmjs.com/package/@general-liquidity/gordon-cli)
[![Build](https://img.shields.io/github/actions/workflow/status/general-liquidity/gordon-cli/release.yml?style=flat-square&label=build)](https://github.com/general-liquidity/gordon-cli/actions)
[![Node.js](https://img.shields.io/badge/Node.js->=18-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/Bun->=1.0-14151a?style=flat-square&logo=bun&logoColor=fbf0df)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

[Overview](#overview) • [Features](#features) • [Safety](#safety--governance) • [Install](#install) • [Quick start](#quick-start) • [Permission modes](#permission-modes) • [Architecture](#architecture)

</div>

---

## Overview

**Gordon is a frontier trading agent that runs in your terminal.** Describe the setup, the risk, and the intent in plain language, and Gordon coordinates the research, the plan, the venue, and the execution. No dashboards, no twelve-tab cockpit. Just a terminal, a chat, and an agent that knows how markets work — wrapped in a capital-safety layer it cannot override.

It is a CLI trading desk, not a chat app with trading bolted on. The hard part of putting AI to work in markets is not intelligence, it is trust: reasoning under uncertainty, permissions, approvals, durable memory, disciplined execution, and clear failure modes. In Gordon, capital safety is not a feature added at the end. It is the architecture.

The interface adapts to the three speeds of a real desk:

- **Glance** *(0.2s)* — P/L, positions, alerts, regime, in one screen.
- **Read** *(2–5s)* — analysis, plans, risk, backtests, structured and skimmable.
- **Work** *(30s+)* — strategy authoring, backtests, playbooks, full-screen panels.

What's under the hood:

- **Crypto and stocks** in one interface, via real exchange and broker adapters — no mock quotes.
- **Plan-first by default** — nothing reaches a venue until you preview and approve it as a structured diff.
- **Deny-first governance** — a permission engine, a 15-dimension pre-trade risk classifier, a hard deny-list, and scoped kill switches gate every order.
- **Three real agents** — an orchestrator that routes, an executor with the only execution permissions, and a read-only researcher, split along a security boundary.
- **Agent-native** — built on [Mastra](https://mastra.ai) with handoffs, cross-agent memory, MCP plugins, and an Anthropic / OpenAI / Google / Dedalus model layer.

> [!WARNING]
> Gordon places real orders on real venues when armed. Trading is risky, you can lose money, and nothing in this repo is investment advice. Read the source, start in `paper` or `strict` mode, and never arm capital you can't afford to lose.

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
         Risk gate: PASS (15/15 dims) · constitution: clean

         [ approve ]  [ modify ]  [ reject ]  [ backtest ]
```

## Features

### Research and discovery
- **Market-wide scanners** — trending, top movers, breakouts, regime classification, whale alerts, multi-symbol parallel scans.
- **Workflow slash commands** — `/scan`, `/analyze`, `/deep`, `/research`, `/radar`, `/mtf`, `/ensemble`, each wired to a curated tool chain and a domain skill.
- **~94 indicator ops** via the `compute_indicator` dispatcher — RSI, MACD, EMA/SMA, Bollinger, ATR, ADX, VWAP, Ichimoku, Supertrend, Stochastic RSI, MFI, CCI, plus exotics (SADF, frac-diff, Hurst, LMW, RSRS, Amihud illiquidity).
- **Market microstructure** via `compute_microstructure` — VPIN toxicity, footprint imbalance, order-block detection, naked POC, displacement breaks, information bars, rotational bars.
- **Regime classification** — six classes (trending up/down, ranging, volatile, quiet, breakout) from a 10-metric model (ADX, EMA alignment, ATR percentile, Bollinger width, volume trend, MACD histogram).
- **Onchain data (read-only)** — DexScreener, DefiLlama, CoinGecko-Onchain, Birdeye, Codex, 1inch, plus wallet intelligence (Nansen, Arkham, Covalent, Moralis, Zerion, DeBank).
- **Fundamentals and news** — Finnhub equities/ETFs/indices/bonds/macro, SEC/EDGAR filings, insider and analyst flow, 12 crypto RSS feeds + Yahoo, with lexicon + LLM sentiment and entity extraction.

### Plans and execution
- **Plan-as-diff approval** — every trade is previewed as a structured diff before anything hits a venue.
- **Bracket, grid, DCA, OCO** — multi-leg plans with trailing stops and partial take-profits.
- **Approval content-binding** — a plan's approval is hashed over its symbol, side, entry, size, stop, and TPs; mutate any of them and it must be re-approved.
- **Order recovery** — interrupted or failed executions are reconciled and retried idempotently; plans never re-execute from an `EXECUTING`/`CLOSED` state.
- **Rationale-required** — `execute_plan` and every `cancel_*` tool require a concrete, ≥10-character rationale that is written to the audit trail, not just logged.

### Systematic and backtesting
- **41-strategy library** — 5 tier-1 (SMA crossover, Bollinger bounce, support bounce, volume surge, VWAP), 22 tier-2 (order blocks, FVG, smart money, stat arb, ICT kill zones, squeeze breakout, …), plus a weighted ensemble and a condition-based strategy DSL.
- **Backtesting engine** — historical replay, walk-forward validation, Monte Carlo, grid/random optimization, alpha-decay detection, fee-sensitivity sweeps, market-impact modeling, and cross-sectional overfitting guards.
- **Event-replay** — a high-fidelity, catalog-driven replay engine with a verdict store that tracks `pass^k` reliability across runs.
- **Playbooks & Edge-Driven Development** — markdown-native playbooks compiled to a formal protocol, and `EDGE.md` specs (a falsifiable edge = test + backtest gate + live monitor) that auto-retire when live metrics stop matching the backtest.
- **Operator reports** — Sharpe, Sortino, max drawdown, profit factor, hit rate, expectancy, plus bias diagnostics.

### Venues
| Kind | Integrations |
|------|--------------|
| CEX (native) | Binance (spot), Hyperliquid (perps) |
| CEX (ccxt) | Coinbase, Kraken, Bitfinex, Gemini, OKX, + the wider ccxt fleet |
| Brokers | Alpaca, Schwab, Interactive Brokers, E*TRADE, tastytrade, TradeStation, Tradier, Trading 212, Webull |
| Onchain data | DexScreener, DefiLlama, CoinGecko-Onchain, Birdeye, Codex, 1inch |
| Wallet intel | Nansen, Arkham, Covalent, Moralis, Zerion, DeBank |
| Rails | MoonPay (on-ramp), Polygon x402 |

Every adapter conforms to a shared contract and passes an **inclusion gate** and a **conformance matrix** in CI — broker quality is measured, not assumed.

## Safety & Governance

This is the part most trading bots don't have, and it's the reason Gordon exists. Execution is defended in depth: an order has to survive every layer below before it reaches a venue.

- **Deny-first permission engine** (`runtime/permissions/PermissionEngine.ts`) — nothing runs unless a policy rule or a hook chain explicitly allows it. Rejecting a parent trade-impacting tool cascade-denies its pending siblings.
- **15-dimension pre-trade risk classifier** (`infra/trading/risk/riskClassifier.ts`) — 8 always-on dimensions (size, concentration, drawdown proximity, daily loss budget, frequency, volatility, market hours, asset familiarity) + 7 optional (vol-adjusted sizing, correlation, venue MEV exposure, regime-transition, fake-liquidity, environment-fit, tail risk). Returns one of `auto_approve` / `prompt_user` / `require_confirmation` / `block`.
- **Trust trajectory with a hard deny-list** (`runtime/permissions/trustTrajectory.ts`) — consistently approved tools can earn auto-approval, but a safety-critical deny-list (`execute_plan`, `place_*_order`, `cancel_*`, `wallet_transfer`, `withdraw`, `approve_token`, `exec_shell`, …) **always** bypasses trust scoring. One recent rejection wipes accumulated trust.
- **Scoped kill switches** (`infra/safety/killSwitches.ts`) — a `firm → gateway → venue → instrument → client → account → trader → strategy` hierarchy. Trip `venue:kraken` and only Kraken freezes; state persists across restarts and a reset requires a logged rationale.
- **14 lifecycle hooks** (`infra/hooks/`) — `PreToolUse`, `PreOrderPlacement`, `PreApproval`, `SessionStart/End`, `SubagentStart/Stop`, and more, with `asyncRewake` (parallel compliance calls), `statusMessage` (live TUI status), glob tool-filtering, and payload threading.
- **Signed audit + trade ledger** (`core/risk-kernel/audit.ts`, `infra/safety/tradeLedger.ts`) — every gate decision is persisted with the full order, the risk decision, a portfolio snapshot, and the agent's reasoning trace.

<details>
<summary><strong>The <code>execute_plan</code> gate stack (abridged) — what an order passes through before it fills</strong></summary>

1. Exchange connection check
2. Plan exists and is `APPROVED` (never re-execute from `EXECUTING`/`CLOSED`/`CANCELLED`)
3. Approval content-binding (re-approve if the plan was mutated)
4. Kill-switch gate (venue / instrument / strategy scope)
5. Trading-constitution halt check
6. WIP limit (session plan registry)
7. Explain-before-execute (user thesis requirement)
8. Anti-rot gates (universe scope, thesis coherence, strategy mandate)
9. Permission-mode check (`strict`/`observe`/`plan` block live execution)
10. Price validation (finite, usable quotes)
11. Trade validation (allocation cap + quantity/price sanity)
12. Constitution violation check (position size, drawdown, daily loss budget)
13. Risk classifier (15 dimensions → verdict)
14. Risk-acknowledgement gate (substantive ack per warning)
15. `PreOrderPlacement` hooks (fat-finger / price-deviation guards, MCP plugins)
16. Termination layer L1 (pre-trade) → **execute** → L2/L3 (post-trade reconciliation)

</details>

### Agent runtime
- **Three agents, one boundary** — **Gordon** (orchestrator) routes and supervises but never trades directly; **Executor** holds the only execution tools (`execute_plan`, `place_*_order`) behind the risk gate; **Researcher** is a read-only, time-boxed parallel clone for scans, backtests, and deep dives. The split is a security boundary, not an optimization.
- **Canonical 22-tool surface** (`infra/agents/tools/surface/`) — 5 data, 4 analytics (incl. the two meta-dispatchers), 6 plan/exec, 3 memory/audit, 4 workflow. Gordon layers ~80 tools total once Finnhub, X-social, MCP, and onchain-read spreads are included.
- **Cognition phases** (`infra/agents/cognition/`) — a tool-free `thinkingPhase`, an in-band `extendedThinking` (Claude 4.x budget tokens), and a `critiquePhase` that runs a Reflexion-style self-review (with an optional adversarial mode) at high depth.
- **Runtime harness** (`infra/agents/harness/runtimeHarness.ts`) — dual-layer doom-loop detection (identical-fingerprint counting + coherent-amplification cycle detection), per-tool-family result offloading, and planning-handoff injection.
- **5-stage memory compaction** (`infra/domain/memory/`) — masking → pruning → aggressive → collapse → full, triggered at 70/80/90/94/99% context pressure, with a non-destructive read-time collapse before any lossy summary, and a strict working-memory hot tier.
- **Proactive radar** (`infra/proactive/`) — 21 producers (regime flips, vol spikes, funding, chart patterns, edge assessment, whale alerts, news/EDGAR/earnings/insider flow, stop/TP alerts) scored by a single or **tri-judge panel** (Anthropic + OpenAI + Google) before they ever interrupt you.
- **MCP plugins** — install, route, and lazy-load external tool servers via `@mastra/mcp`.

### Evaluation
- **Generated scenario suite** (`infra/domain/evals/harness/`) — scenarios are derived from the trading constitution, the risk-classifier dimensions, the safety deny-list, and category rubrics, so the suite tracks the specs instead of drifting from them.
- **Process checks + pass^k** — deterministic assertions over the recorded tool-call sequence (`risk_gate_before_order`, `denylist_without_approval`) plus k-run reliability aggregation, scored safe-on-every-run.
- **Tri-judge panel + regression gate** — cross-family LLM-as-judge to wash out self-preference, with a CI gate that blocks PRs on blocking regressions.

### Terminal UI
- **Ink 6 + React 19** over a custom framebuffer — streaming chat, agent badges, inline cost/latency, collapsible tool calls, syntax-highlighted code, markdown tables, and fenced plan diffs.
- **Five workspaces** — Desk, Market, Plan, Lab, Monitor, each with its own quick actions and keybindings.
- **Vim mode** — motions, text objects, registers, and a selection overlay.
- **Slash commands** with fuzzy autocomplete and runtime drift detection, so the registry can never lie.
- **Neon Mint** theme by default, dimmed for long sessions, full 24-bit color where supported.

## Install

> [!NOTE]
> **Requirements:** Node.js ≥ 18 (for the npm wrapper) or [Bun](https://bun.sh) ≥ 1.0 (from source). A 64-bit terminal with true-color support is strongly recommended.

```bash
npm install -g @general-liquidity/gordon-cli
```

The npm wrapper downloads the prebuilt binary for your platform on first install (macOS arm64/x64, Linux x64/arm64 glibc + musl, Windows x64/arm64). The installed `gordon` command is the binary itself — no global Node process is kept in memory.

<details>
<summary>Other install methods</summary>

**Bun**
```bash
bun add -g @general-liquidity/gordon-cli
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

On first run Gordon walks you through setup — LLM provider, execution venues, default permission mode, and preferences. Re-run any section later with `gordon configure [llm|exchange|broker|chains|mcp|preferences|quickstart]`. Config lives under `~/.gordon/` and never leaves your machine:

| Path | Purpose |
|------|---------|
| `~/.gordon/config.json` | Exchanges, brokers, model settings, onboarding state |
| `~/.gordon/.env` | API keys (LLM, exchange, broker) |
| `~/.gordon/profiles/` | Named profiles |
| `~/.gordon/gordon.db` | SQLite: trades, history, sessions, audit trail |
| `.gordonrc` | Optional per-project overrides |

Set at least one LLM provider and one venue before placing real orders:

```bash
# Pick one or more LLM providers
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_GENERATIVE_AI_API_KEY="..."
export DEDALUS_API_KEY="dd-..."       # single key, many routed models

# Crypto venue (example: Binance)
export BINANCE_API_KEY="..."
export BINANCE_API_SECRET="..."

# Stocks broker (example: Alpaca)
export ALPACA_API_KEY="..."
export ALPACA_API_SECRET="..."
```

> [!TIP]
> Start in `paper` or `strict` mode. Run `/doctor` (or `gordon doctor`) at any time to see which venues are configured, which credentials are missing, and what each is permitted to do.

Useful commands once you're in:

```
/scan            discover what's moving right now
/analyze BTC     multi-timeframe workup on one symbol
/plan ETH        draft a trade plan (no orders placed)
/backtest        run a strategy over historical data
/portfolio       positions, cash, P/L across venues
/strategy        list / deploy / pause systematic strategies
/radar           proactive suggestions on/off/tune
/strict /observe /plan /paper /ask /auto   switch permission mode
/killswitch      freeze a venue / instrument / strategy
/doctor          connectivity + config + permissions health check
/help            full command index grouped by workflow
```

## Permission modes

Gordon enforces the same truth table everywhere — in the static preflight, in the runtime permission engine, and in each venue adapter. **Every mode still runs the risk classifier, kill switches, and audit logging.** The mode only governs how far the agent may act on its own.

| Mode | Read market | Draft plans | Paper execute | Live execute | Notes |
|------|:-----------:|:-----------:|:-------------:|:------------:|-------|
| `strict` | ✓ | ✗ | ✗ | ✗ | Read-only. Nothing is written, even scratchpads. |
| `observe` | ✓ | ✗ | ✗ | ✗ | Pure observation. Proactive suggestions may fire; nothing executes. |
| `plan` | ✓ | ✓ | ✗ | ✗ | Planning-only. Plans are created but never dispatched. |
| `paper` | ✓ | ✓ | ✓ | ✗ | Paper execution; real orders blocked. |
| `ask` | ✓ | ✓ | ✓ | ✓ (per-action) | Default. Every trade-impacting tool requires explicit approval. |
| `auto` | ✓ | ✓ | ✓ | ✓ | Autonomous within risk gates. Reserved for systematic slots. |

> [!IMPORTANT]
> `auto` is not "no guardrails" — every order still passes the full `execute_plan` gate stack (risk sizing, exposure caps, drawdown checks, kill switches, audit). It only removes the per-order human confirmation step.

## Run surfaces

Gordon is one engine behind several front ends:

| Surface | Start with | What it is |
|---------|-----------|------------|
| **Interactive TUI** | `gordon` | The full Ink terminal desk (default). |
| **Headless** | `gordon --headless "prompt"` | One prompt in, response to stdout — for scripts and pipes. |
| **Daemon** | `gordon daemon <start\|run\|stop\|status>` | A long-running gateway over IPC: scheduled autonomous slots, circuit breakers, reconciliation. |
| **ACP / IDE** | `bun acp` | A JSON-RPC server over stdio implementing the [Agent Client Protocol](https://agentclientprotocol.com), for editors like Zed. |
| **Schedules** | `gordon schedule <add\|remove\|list>` | Cron-style autonomous mandates. |

## Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | [Bun](https://bun.sh) ≥ 1.0 (bundler, standalone binary, test runner) |
| Language | TypeScript 5, strict, `noUncheckedIndexedAccess` |
| TUI | [Ink](https://github.com/vadimdemedes/ink) 6 + React 19 over a custom framebuffer |
| Agents | [Mastra](https://mastra.ai) — `@mastra/core` + memory + MCP + otel |
| Memory | [LibSQL](https://turso.tech/libsql) (SQL + vector) + SQLite (audit) |
| LLM providers | OpenAI, Anthropic, Google Gemini, Dedalus (multi-model router) |
| Venues | Native (Binance, Hyperliquid) + [ccxt](https://ccxt.com) fleet + broker REST adapters |
| Stats | `@stdlib/*` (erf, gamma, normal/t/chi-square dists), `simple-statistics`, `ml-matrix`/`ml-pca`/`ml-hclust` |
| Schemas | [Zod](https://zod.dev) 4 on every tool I/O and config |
| Protocols | [Agent Client Protocol](https://agentclientprotocol.com) (ACP), [MCP](https://modelcontextprotocol.io) |
| Observability | OpenTelemetry traces + metrics, Mastra observability export |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  surfaces   TUI (Ink) · headless · daemon (IPC) · ACP/IDE · schedules  │
└──────────────────────────────────────────────────────────────────────┘
                               │ chat / slash / RPC
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  orchestration              Gordon  (router / supervisor)             │
│              ┌────────────┐                    ┌────────────┐          │
│              │ Researcher │  read-only         │  Executor  │ exec-only│
│              └────────────┘  parallel clone    └────────────┘ boundary │
│   handoffs · cognition (think → extend → critique) · memory · harness  │
└──────────────────────────────────────────────────────────────────────┘
                               │ tool calls
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  governance   deny-first permission engine · 15-dim risk classifier   │
│   trust trajectory + hard deny-list · scoped kill switches · 14 hooks  │
│                       signed audit · trade ledger                      │
└──────────────────────────────────────────────────────────────────────┘
                               │ permitted calls
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  tools   canonical 22-tool surface  +  Finnhub / X / MCP / onchain     │
│  data · analytics (94 indicator + 9 microstructure ops) · plan/exec    │
│  memory/audit · workflow/delegation · backtest · proactive radar       │
└──────────────────────────────────────────────────────────────────────┘
                               │ adapter contracts
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  venues & data   exchanges · brokers · onchain · wallet intel · news   │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  infrastructure   LibSQL (SQL + vector) · SQLite · OTel · event bus    │
└──────────────────────────────────────────────────────────────────────┘
```

## Development

Prerequisites: [Bun](https://bun.sh) ≥ 1.0 and Node.js ≥ 18.

```bash
bun install          # install deps (postinstall patches Mastra + Ink)
bun run dev          # hot-reload TUI
bun test             # Bun's built-in test runner (no Jest/Vitest)
bun run typecheck    # tsc --noEmit
bun run build        # bundle to dist/
bun run build:binary # compile a single standalone executable
bun run check        # Biome lint + format
bun run slop         # AI-slop ratchet scan
```

Diagnostics and gates:

```bash
bun run quality:brokers          # broker conformance + latency gate
bun run test:broker-conformance  # adapter contract + matrix tests
bun run audit:npm-pack           # audit the published npm tarball
```

CI runs the full suite, `tsc --noEmit`, Biome, broker conformance + the latency gate, the eval-harness regression gate, and guardrails that block source-map leaks and unexpected files before any publish step. Tests are co-located (`foo.ts` + `foo.test.ts`); imports use `.ts` extensions (Bun convention).

### Project layout

```
src/
├── app/             slash commands, setup flows, presenters, ACP entry
├── tui/             Ink components, framebuffer, workspaces, vim mode, themes
├── core/            indicators, regime, edge (EDD), playbooks, strategies, risk-kernel
├── backtest/        engine, walk-forward, Monte Carlo, optimization, event-replay
├── strategies/      tier-1, tier-2, ensemble, DSL
├── infra/
│   ├── agents/      definitions, orchestrator, tools (22-surface), cognition, harness
│   ├── broker/      broker adapter contract + conformance + inclusion gate
│   ├── data/        sources, onchain, wallet intel, cache
│   ├── trading/     risk classifier, sizing
│   ├── hooks/       hook engine + 14 lifecycle types
│   ├── proactive/   observer + 21 producers + LLM judge
│   ├── news/        RSS + Yahoo + EDGAR + sentiment
│   ├── domain/      memory (compaction), evals (harness), markets, systematic
│   └── safety/      kill switches, trade ledger, sprint contracts
├── runtime/         permissions (engine + trust trajectory), capability registry
├── gateway/         daemon, IPC, scheduler, protocol envelopes
├── core-sdk/        protocol types + agent scaffold
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
