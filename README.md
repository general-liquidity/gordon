<!-- prettier-ignore -->
<div align="center">

<img src="./assets/gordon-banner.gif" alt="GORDON" width="520" />

### The Frontier Trading Agent

*Talk to it like a desk partner. It can't talk its way past your risk limits.*

[![npm version](https://img.shields.io/npm/v/@general-liquidity/gordon?style=flat-square&color=34eeb0&label=npm)](https://www.npmjs.com/package/@general-liquidity/gordon)
[![Build](https://img.shields.io/github/actions/workflow/status/general-liquidity/gordon/release.yml?style=flat-square&label=build)](https://github.com/general-liquidity/gordon/actions)
[![Bun](https://img.shields.io/badge/Bun->=1.0-14151a?style=flat-square&logo=bun&logoColor=fbf0df)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

**[Why Gordon](#why-gordon) · [Install](#install) · [Quick start](#quick-start) · [Safety](#how-gordon-keeps-you-safe) · [How it works](#how-it-works) · [Integrations](#integrations) · [Architecture](#architecture) · [Tech stack](#tech-stack)**

</div>

---

**Gordon is an open-source (MIT) AI trading agent for crypto and equities that runs in your terminal.** You state the intent in plain language, it drafts a structured plan, you approve it, and a deny-first risk harness gates every order before it reaches a venue.

The model proposes. The harness disposes.

Local-first: your keys, your machine, no account, no phone-home, every feature free.

<!-- demo: a terminal cast (asciinema/GIF) of a real /plan → approve → fill cycle belongs here once recorded; the block below is a hand-written mock-up, not a capture. -->

*Illustrative output (a mock-up of a plan cycle, not a recorded session):*

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

> [!WARNING]
> Gordon places real orders on real venues when armed. Trading is risky, you can lose money, and nothing in this repo is investment advice. Read the source, start in `paper` or `strict` mode, and never arm capital you can't afford to lose. See [DISCLAIMER.md](./DISCLAIMER.md) and [TERMS.md](./TERMS.md); the first live arm asks you to acknowledge them once.

## Why Gordon

**In markets, AI does not have a capabilities problem. It has a trust problem.** A model that reads a chart fluently still cannot be trusted to size a position, respect a limit, or recover from a failed order. Gordon is the missing harness: permissions, approvals, durable memory, disciplined execution, and clear failure modes. Capital safety is not bolted on at the end; it is the architecture.

<details>
<summary><strong>The longer argument</strong></summary>

Since late 2022 we have watched AI get unnervingly good at *talking* about markets. A model will explain a setup, narrate a chart, and argue a thesis as fluently as a senior trader. Almost none of it is something you would actually hand your money to.

A model that can read a chart is not therefore able to size a position, respect a limit, recover from a failed order, or preserve capital through a drawdown. In most software, being slightly wrong is survivable. In markets, being *nearly* right is often just being wrong, with a settlement attached. The hard part was never the intelligence. It is the reasoning under uncertainty, the permissions, the approvals, the durable memory, the disciplined execution, and the clear failure modes that let a human safely delegate capital to software.

Gordon turns a plain-language intent, *"find me a clean BTC long for the NY session, ~1R"*, into a previewed, risk-checked, fully-audited trade.
</details>

## Philosophy

Three convictions the whole codebase is built around.

**The model proposes, the harness disposes.** Intelligence and authority are separated by design. The agent that *reasons* about a trade is not the agent that *places* it, and neither can reach a venue without clearing a wall of deterministic checks. Capability is necessary. It is nowhere near sufficient.

**Plan-first, always.** Nothing touches a venue until you have seen it as a structured diff and approved it. Gordon's job is to make you a *better decision-maker, faster*, not to fire orders and explain itself afterward. Approvals are content-bound: change a single leg of a plan and it has to be approved again.

**Deny-first, not trust-first.** The default answer to "may this run?" is no. Every order earns its way to a venue through a permission engine, a 15-dimension risk classifier, a hard deny-list, and scoped kill switches. An agent cannot talk, charm, or hallucinate its way past a limit it is structurally forbidden to cross.

### How that compares

Gordon is not a faster bot. It is a different shape: a supervised agent, where the classic bots are rule engines and the DIY route is an LLM you wire to a broker yourself.

| | Gordon | Freqtrade | Hummingbot | LLM + broker API by hand |
|:--|:--:|:--:|:--:|:--:|
| Driven by natural-language intent | ✓ | Rule/strategy code | Rule/strategy config | ✓ |
| Plan shown as a diff and approved before any order | ✓ | ✗ | ✗ | You build it |
| Deny-first permission gate on every tool call | ✓ | ✗ | ✗ | You build it |
| Multi-dimension pre-trade risk classifier | ✓ (15 dims) | Strategy-level limits | Strategy-level limits | You build it |
| Tamper-evident (HMAC-chained) audit trail | ✓ | Logs | Logs | You build it |
| Venue coverage | Crypto + equities/options | Crypto | Crypto | Whatever you wire |
| Terminal front end | Full TUI | CLI + web UI | CLI client | Your own |
| Open source | ✓ MIT | ✓ | ✓ | n/a |

<sub>Competitor cells state only well-established, publicly documented facts about those projects. Where a project solves a problem differently rather than not at all, the cell says so instead of a cross.</sub>

## Install

> [!NOTE]
> **Requirements:** Node.js ≥ 18 (for the npm wrapper) or [Bun](https://bun.sh) ≥ 1.0 (from source). A 64-bit, true-color terminal is strongly recommended.

```bash
npm install -g @general-liquidity/gordon
```

The wrapper fetches the prebuilt binary for your platform (macOS arm64/x64, Linux x64/arm64 glibc + musl, Windows x64/arm64). The `gordon` command *is* the binary; no resident Node process.

<details>
<summary>Bun, or from source</summary>

```bash
bun add -g @general-liquidity/gordon      # Bun global

git clone https://github.com/general-liquidity/gordon.git
cd gordon && bun install && bun run build && bun start   # from source
```
</details>

## Quick start

```bash
gordon
```

First run walks you through setup: an LLM provider, your venues, a default permission mode, and preferences. Everything lives under `~/.gordon/` and never leaves your machine. Gordon is local-first: no license key, no account, no phone-home, and every feature is free. Set at least one model provider and one venue before placing real orders:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."     # or OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / XAI_API_KEY
export BINANCE_API_KEY="..."  BINANCE_API_SECRET="..."     # a crypto venue
export ALPACA_API_KEY="..."   ALPACA_API_SECRET="..."      # or a stocks broker
```

Every supported provider, exchange, broker, and data feed is documented in [`.env.example`](./.env.example). Copy it to `~/.gordon/.env` and fill in only what you use.

Managed deployments may also provide a signed highest-precedence
`policy.json`. Set `GORDON_POLICY_KEY` in the process environment to its HMAC
key; this secret is intentionally not exposed through `/flags` or persisted in
the settings layers. If a policy file exists but is unsigned, malformed, or
cannot be verified, Gordon refuses the entire policy layer.

Then talk to it, or drive it with slash commands:

```
/scan            what's moving right now
/analyze BTC     multi-timeframe workup on one symbol
/plan ETH        draft a trade plan (no orders placed)
/backtest        run a strategy over historical data
/portfolio       positions, cash, P/L across venues
/strict /paper /ask /auto    switch how far it may act on its own
/killswitch      freeze a venue, instrument, or strategy
/flags           see and toggle opt-in capabilities and settings
/doctor          connectivity + config + permissions health check
```

> [!TIP]
> Start in `paper` or `strict`. Run `/doctor` any time to see which venues are wired, which credentials are missing, and what each is allowed to do.

## How Gordon keeps you safe

This is the part most trading bots don't have, and the reason Gordon exists. An order is defended in depth: it has to survive every layer before it reaches a venue.

| Layer | What it does |
|-------|--------------|
| **Safe defaults** | Brokers default to paper; crypto defaults to a venue's sandbox, or an explicit live opt-in when it has none (never a silent live route); leverage is capped at 5x by default (`GORDON_RISK_MAX_LEVERAGE`). |
| **Live-trading consent** | The first live (non-paper) arm requires a one-time acknowledgment, your keys, your account, not investment advice, you can lose money, persisted so it shows exactly once. Paper and sandbox are never gated. |
| **Permission engine** | Deny-first. Nothing runs without an explicit policy allow or a hook decision. Rejecting a parent trade cascade-denies its pending siblings. |
| **Risk classifier** | 15 dimensions (size, concentration, drawdown, loss budget, frequency, volatility, hours, familiarity + correlation, MEV, regime-transition, fake-liquidity, tail risk, …) → `auto_approve` / `prompt_user` / `require_confirmation` / `block`. |
| **Trust trajectory** | Consistently-approved tools can earn auto-approval, but a hard deny-list (`execute_plan`, `place_*_order`, `cancel_*`, `wallet_transfer`, `withdraw`, `exec_shell`, …) *always* bypasses trust. One rejection wipes accumulated trust. |
| **Kill switches** | A `firm → venue → instrument → strategy` scope hierarchy. Freeze one venue without touching the rest; state persists across restarts; resets need a logged rationale. |
| **Hooks** | 14 lifecycle points (`PreToolUse`, `PreOrderPlacement`, `PreApproval`, …) with parallel compliance calls and live TUI status. |
| **Audit + ledger** | Every gate decision is persisted with the full order, the risk decision, a portfolio snapshot, and the agent's reasoning trace. |

And `execute_plan` itself is a gauntlet. Before a single order fills, it clears (abridged):

> connection check → plan is `APPROVED` and unmutated → kill-switch gate → constitution halt → WIP limit → explain-before-execute → anti-rot gates (universe, thesis, mandate) → permission-mode check → price + trade validation → constitution violations → **15-dim risk classifier** → risk acknowledgement → `PreOrderPlacement` hooks → execute → post-trade reconciliation.

Rationale is structural, not advisory: `execute_plan` and every `cancel_*` demand a concrete, ≥10-character reason that is written to the audit trail, not just logged.

## How it works

Gordon is **three agents split along a security boundary**, not one model wearing many hats:

- **Gordon:** the orchestrator. Routes, supervises, and reasons, but never trades directly.
- **Executor:** holds the *only* execution tools, behind the full risk gate.
- **Researcher:** a read-only, time-boxed parallel clone for scans, backtests, and deep dives. It cannot place an order even if it tries to.

Around them sits the runtime that makes a long session trustworthy:

- **Cognition in phases:** a tool-free thinking pass, in-band extended thinking, an adversarial self-critique at high depth, and a citation audit. These reasoning passes are on by default and throttled by the session cost budget (`GORDON_COST_BUDGET_USD`); set any of them to `0` for a cheaper run.
- **Protective halts on by default:** the streak circuit breaker, revenge-trade guard, give-back stop, WIP limit, and absorbing barrier all arm themselves out of the box, with their thresholds left tunable. Only the WIP limit hard-blocks an execution; the rest report.
- **A canonical 22-tool surface:** 5 data, 4 analytics (two of them meta-dispatchers over ~94 indicator and 9 microstructure ops), 6 plan/exec, 3 memory/audit, 4 workflow. Integration feeds (Finnhub, X, MCP, onchain) spread on top.
- **A doom-loop harness:** dual-layer fingerprinting catches both identical-call loops and A-B-A-B cycles; oversized tool results are offloaded to scratch.
- **5-stage memory compaction:** masking → pruning → aggressive → collapse → full, triggered by context pressure, with a reversible read-time collapse before any lossy summary.
- **A proactive radar:** 21 producers (regime flips, vol spikes, funding, whale alerts, news/earnings/insider flow, stop/TP alerts) scored by a tri-judge panel before they ever interrupt you.

## Integrations

Real adapters, not mock quotes. Gordon is model-, venue-, and editor-agnostic: it talks to the exchanges, brokers, data feeds, models, and editors you already use, and every market adapter passes an **inclusion gate** and a **conformance matrix** in CI, so broker quality is measured, not assumed.

#### Crypto exchanges

| Exchange | Markets | Connection |
|:--|:--|:--|
| <img height="16" align="top" src="./assets/integrations/binance.svg" alt="" /> &nbsp;Binance | Spot | ccxt |
| <img height="16" align="top" src="./assets/integrations/hyperliquid.png" alt="" /> &nbsp;Hyperliquid | Perpetuals | ccxt · wallet |
| <img height="16" align="top" src="./assets/integrations/coinbase.png" alt="" /> &nbsp;Coinbase | Spot | ccxt |
| <img height="16" align="top" src="./assets/integrations/kraken.png" alt="" /> &nbsp;Kraken | Spot | ccxt |
| <img height="16" align="top" src="./assets/integrations/okx.svg" alt="" /> &nbsp;OKX | Spot | ccxt |
| <img height="16" align="top" src="./assets/integrations/gemini-exchange.png" alt="" /> &nbsp;Gemini | Spot | ccxt |
| <img height="16" align="top" src="./assets/integrations/robinhood.svg" alt="" /> &nbsp;Robinhood | Crypto | adapter |

<sub>Plus the wider [ccxt](https://ccxt.com) fleet (Bybit, KuCoin, MEXC, and more).</sub>

#### Equity &amp; options brokers

| Broker | Coverage |
|:--|:--|
| <img height="16" align="top" src="./assets/integrations/alpaca.png" alt="" /> &nbsp;Alpaca | US equities · options · crypto |
| <img height="16" align="top" src="./assets/integrations/ibkr.png" alt="" /> &nbsp;Interactive Brokers | Global equities · options · futures |
| <img height="16" align="top" src="./assets/integrations/tastytrade.png" alt="" /> &nbsp;tastytrade | Options · futures |

<sub>Curated to the brokers with a maintained native TypeScript SDK. Each still passes the same inclusion gate and conformance matrix, and defaults to paper, live needs an explicit opt-in.</sub>

<details>
<summary><strong>Onchain data &amp; intelligence</strong></summary>

| Source | Provides |
|:--|:--|
| <img height="16" align="top" src="./assets/integrations/nansen.png" alt="" /> &nbsp;Nansen | Wallet intelligence |
| <img height="16" align="top" src="./assets/integrations/arkham.png" alt="" /> &nbsp;Arkham | Wallet intelligence |
| <img height="16" align="top" src="./assets/integrations/birdeye.png" alt="" /> &nbsp;Birdeye | Solana DEX data |
| <img height="16" align="top" src="./assets/integrations/defillama.png" alt="" /> &nbsp;DeFiLlama | TVL · yields |
| <img height="16" align="top" src="./assets/integrations/glassnode.png" alt="" /> &nbsp;Glassnode | On-chain metrics |
| <img height="16" align="top" src="./assets/integrations/dexscreener.png" alt="" /> &nbsp;DexScreener | DEX pairs |
</details>

#### Models &nbsp;<sub>provider-agnostic, via Mastra's native model router</sub>

| Provider | Models |
|:--|:--|
| <img height="16" align="top" src="./assets/integrations/anthropic.svg" alt="" /> &nbsp;Anthropic | Claude |
| <img height="16" align="top" src="./assets/integrations/openai.png" alt="" /> &nbsp;OpenAI | GPT |
| <img height="16" align="top" src="./assets/integrations/google-gemini.svg" alt="" /> &nbsp;Google | Gemini |
| &nbsp;xAI | Grok |

<sub>These four first-party families have native tool-calling and drive the default agent roles. Pick any `provider/model` and Gordon routes it: frontier labs native in the catalogue (DeepSeek, Qwen/Alibaba, Kimi/Moonshot, z.ai and Zhipu GLM, MiniMax, StepFun, Mistral), gateways for one-key multi-model access (OpenRouter, Hugging Face, Together, Fireworks, SiliconFlow, DeepInfra), and local OpenAI-compatible hosts (Ollama, LM Studio). Defaults: orchestrator and executor on `claude-opus-4-8`, researcher on `claude-haiku-4-5`. Override per role with `GORDON_MODEL_ORCHESTRATOR` / `_EXECUTOR` / `_RESEARCHER` (`provider:model`), or globally with `GORDON_PROVIDER` / `GORDON_MODEL`. The trade-driving executor stays pinned to a first-party provider by default for tool-calling reliability; frontier and gateway models are freely selectable for research and analysis roles.</sub>

<details>
<summary><strong>Editors &amp; hosts</strong> &nbsp;<sub>run Gordon from</sub></summary>

| Editor / host | Connection |
|:--|:--|
| <img height="16" align="top" src="./assets/integrations/zed.png" alt="" /> &nbsp;Zed | Editor panel · ACP |
| <img height="16" align="top" src="./assets/integrations/athas.png" alt="" /> &nbsp;Athas | Editor panel · ACP |
| <img height="16" align="top" src="./assets/integrations/cursor.png" alt="" /> &nbsp;Cursor | MCP |
| <img height="16" align="top" src="./assets/integrations/warp.png" alt="" /> &nbsp;Warp | MCP |
| <img height="16" align="top" src="./assets/integrations/claude.png" alt="" /> &nbsp;Claude Desktop | MCP |
| <img height="16" align="top" src="./assets/integrations/devin.png" alt="" /> &nbsp;Devin | MCP |

<sub>Also wired: Finnhub fundamentals, SEC/EDGAR filings, X sentiment, MoonPay on-ramp, and Polygon x402 rails.</sub>
</details>

## What's in the box

<details>
<summary><strong>Analysis & strategy</strong></summary>

- **~94 indicator ops:** RSI, MACD, Ichimoku, Supertrend, ATR, ADX, VWAP, plus exotics (SADF, frac-diff, Hurst, RSRS, Amihud).
- **Microstructure ops:** VPIN, footprint imbalance, order blocks, naked POC, displacement breaks.
- **Triangular-arbitrage parity:** a 3-leg no-arbitrage-breakdown dislocation signal.
- **Six-class regime classifier** over a 10-metric model, generalizing from equity indices to crypto majors.
- **Market-timing pair:** an O'Neil Follow-Through-Day confirmation and a Distribution-Day cluster counter.
- **41-strategy library:** 5 tier-1, 22 tier-2, a weighted ensemble, and a condition DSL.
- **Playbooks and Edge-Driven Development:** markdown `EDGE.md` specs that auto-retire when live metrics stop matching the backtest.
- **Complex-wide deleveraging veto:** one broad risk-off flush vetoes the whole oversold set, not N independent dips.
- **Crowded-equilibrium fragility index:** forward-looking pre-flush cascade setup, distinct from the reactive veto.
- **Game-type classifier:** positive / zero / negative-sum, answering who funds this edge.
- **Exposure-ceiling coach:** regime plus breadth resolved into a deployable-capital cap.
- **Avellaneda-Lee stat-arb:** eigenportfolio-residual signal.
- **Covariance denoising:** Random-Matrix-Theory (Marchenko-Pastur) and optimal-intensity Ledoit-Wolf shrinkage.
- **Allocation:** HRP and Black-Litterman.
- **Kalman family:** hedge-ratio with confidence-gated sizing, constant-velocity trend filter, vol-scaled adaptive process noise.
- **Options:** full Greeks including vanna, charm, vomma, and dealer GEX.
- **Drawdown-cause classifier:** delta- / theta- / IV-driven attribution on held positions, with a deterministic rebuy verdict.
- **Equity methodologies:** CANSLIM 7-factor composite with bear-market gating, parabolic-short exhaustion scorer.
- **Event grading:** a PEAD gap-up grader and an N-th-order scenario-impact analyzer.
</details>

<details>
<summary><strong>Planning, execution & market microstructure</strong></summary>

- **Contingency planning:** bull / base / bear / tail branches authored once, each with a pre-committed allocation and trigger levels.
- **Deterministic branch resolver:** picks the live branch each cycle, with no LLM in the execution loop.
- **Settled-cash / GFV ledger:** buys clear only against settled cash with a T+1 pending bucket.
- **Resting-stop liveness watchdog:** flags positions whose protective stop lapsed via expiry, cancel, or reject.
- **Matching engine:** deterministic continuous double auction with price-time priority, partial fills, and cancels.
- **Call-auction uncross:** open and close equilibrium pricing.
</details>

<details>
<summary><strong>Autonomy & completion discipline</strong></summary>

- **Verified-completion gate:** no goal seals on the agent's say-so; an independent verifier must fail to invalidate "done".
- **Per-cycle gap-finding:** each cycle re-derives the unmet-requirement set from current state, not a fixed upfront plan.
- **Just-in-time replanning:** the work list regenerates each cycle; falling short seals an honest *achieved-with-acknowledged-gaps*.
- **Rotating self-audit:** a per-run deep pass over script health, discovery coverage, dead weight, guardrail integrity, API budgets.
- **Bounded autonomous-loop driver:** mandate breach and expiry hard-stops, per-symbol caps, goal-stall detection.
</details>

<details>
<summary><strong>Memory, governance & audit</strong></summary>

- **Thesis-lifecycle FSM:** IDEA → ENTRY_READY → ACTIVE → PARTIALLY_CLOSED → CLOSED, with review-due dates and MAE / MFE postmortems.
- **Belief-tension counter:** contradicting observations open a for / against tally that flips or reconfirms a stored belief.
- **Approval presets:** named, reusable permission bundles.
- **Risk-state undo-lineage:** tightening auto-applies; loosening is staged for approval and can never breach the compiled safety floor.
- **Approval lifecycle ledger:** approvals re-surface until they are actually applied.
- **Temperament dials:** tune decision thresholds within hard caps they can never loosen.
- **Boundary-durable audit:** handoff payloads stored lossless with a parent-absorption record, outside the signed content hash.
- **5-stage compaction:** masking → pruning → aggressive → collapse → full, reversible before any lossy summary.
- **ACE lesson distillation** across sessions.
</details>

<details>
<summary><strong>Backtesting, evaluation & learning</strong></summary>

- **Backtest engine:** historical replay, walk-forward, Monte Carlo, grid and random optimization.
- **Overfitting guards:** alpha-decay detection, fee-sensitivity sweeps, market-impact modeling, cross-sectional guards.
- **Scenario-realism validator:** the Cont stylized-facts battery (fat tails, vol clustering, Zumbach asymmetry, gain/loss skew, aggregational Gaussianity).
- **Event-replay** with a `pass^k` verdict store for reliability across runs.
- **Generated eval scenarios:** derived from the trading constitution, risk dimensions, deny-list, and category rubrics.
- **Deterministic process checks:** per-scenario required and forbidden-action assertions over the recorded tool sequence.
- **Multi-turn scenarios:** score a session spanning real clarification turns.
- **Failure-mode taxonomy** over failed runs, plus a tri-judge panel to wash out self-preference, gated in CI.
- **Regret ledger:** rejected candidates reviewed at T+5 / T+20, scoring whether the gate saved a loss or cost a gain.
- **Setup model-book:** forward-outcome cohort stats per setup.
- **Counterfactual analysis:** inaction value, plus a strategy-pivot stagnation detector.
</details>

<details>
<summary><strong>Opt-in Mastra-native capabilities</strong></summary>

Off by default; enable one flag at a time. Each layers a native Mastra feature on top of Gordon's own gates, never in place of them.

- **Guardrail processors** (`GORDON_MASTRA_PROCESSORS`): native prompt-injection / PII / moderation detection on the model I/O stream.
- **Observational Memory** (`GORDON_OBSERVATIONAL_MEMORY`): native background memory compaction.
- **Native supervisor delegation** (`GORDON_NATIVE_SUPERVISOR`): Mastra's supervisor routing for sub-agent hand-off.
- **Durable / resumable agents** (`GORDON_DURABLE_AGENTS`): snapshot-backed autonomous loops that survive a restart.
- **Native tool-approval** (`GORDON_NATIVE_TOOL_APPROVAL`): marks `execute_plan` + `cancel_*` with a native approval predicate that defers to Gordon's existing risk gate.

Core capability primitives (indicators, microstructure detectors, portfolio analytics, sizing, edge analysis, reasoning/quality passes, protective trade-halt gates) are always-on and cost-throttled, not flags. Tunable settings surface via `/flags` and the settings layer, with env vars as override.
</details>

## Permission modes

The same truth table is enforced in the preflight, the runtime engine, and every adapter. **Every mode still runs the risk classifier, kill switches, and audit.** The mode only sets how far the agent may act alone.

| Mode | Read | Plan | Paper | Live | |
|------|:----:|:----:|:-----:|:----:|--|
| `strict` | ✓ | ✗ | ✗ | ✗ | Read-only; nothing is written. |
| `observe` | ✓ | ✗ | ✗ | ✗ | Suggestions may fire; nothing executes. |
| `plan` | ✓ | ✓ | ✗ | ✗ | Plans created, never dispatched. |
| `paper` | ✓ | ✓ | ✓ | ✗ | Paper fills; real orders blocked. |
| `ask` | ✓ | ✓ | ✓ | ✓\* | **Default.** Every trade needs explicit approval. |
| `auto` | ✓ | ✓ | ✓ | ✓ | Autonomous within risk gates. For systematic slots. |

> [!IMPORTANT]
> `auto` is not "no guardrails." Every order still clears the full `execute_plan` gauntlet; it only drops the per-order human confirmation.

## What Gordon is not

- **Not an HFT or low-latency engine.** It reasons in seconds, not microseconds, and is built for discretionary and swing timeframes.
- **Not a signal service or alpha-in-a-box.** It ships analysis, strategy scaffolding, and gates. The edge is still yours to find.
- **Not a hosted product.** It runs on your machine, with your keys, against your accounts. There is nothing to log into.
- **Not a substitute for your own risk judgement.** The harness blocks known-bad actions; it cannot know what you can afford to lose.
- **Not financial advice, and not audited.** Read [DISCLAIMER.md](./DISCLAIMER.md) and [TERMS.md](./TERMS.md) before arming capital.

## Run surfaces

One engine, several front ends:

| Surface | Start with | What it is |
|---------|-----------|------------|
| TUI | `gordon` | The full Ink terminal desk (Desk / Market / Plan / Lab / Monitor workspaces, vim mode). |
| Headless | `gordon --headless "prompt"` | One prompt in, response out, for scripts and pipes. |
| Daemon | `gordon daemon start` | A long-running gateway over IPC: scheduled slots, circuit breakers, reconciliation. |
| ACP / IDE | `bun acp` | A JSON-RPC server over stdio implementing the [Agent Client Protocol](https://agentclientprotocol.com) for editors like Zed. |
| Schedules | `gordon schedule add …` | Cron-style autonomous mandates. |

## Architecture

```
surfaces      TUI · headless · daemon (IPC) · ACP/IDE · schedules
                                 │
orchestration   Gordon ─► Researcher (read-only)   ·   Executor (exec-only)
                cognition · memory · doom-loop harness
                                 │
governance      deny-first permission engine · 15-dim risk classifier
                trust trajectory + deny-list · kill switches · hooks · audit
                                 │
tools           canonical 22-tool surface + Finnhub / X / MCP / onchain
                                 │
venues & data   exchanges · brokers · onchain · wallet intel · news
                                 │
infrastructure  LibSQL (SQL + vector) · SQLite · local OTEL tracing · event bus
```

## Tech stack

| Technology | Role |
|:--|:--|
| <img height="16" align="top" src="./assets/stack/bun.png" alt="" /> &nbsp;[Bun](https://bun.sh) | Runtime, bundler, test runner |
| <img height="16" align="top" src="./assets/stack/typescript.svg" alt="" /> &nbsp;TypeScript | Language, strict mode |
| <img height="16" align="top" src="./assets/stack/node.svg" alt="" /> &nbsp;Node.js | npm-wrapper runtime (>= 18) |
| <img height="16" align="top" src="./assets/stack/react.svg" alt="" /> &nbsp;React 19 | TUI component model |
| Ink 6 | Terminal renderer + custom framebuffer |
| <img height="16" align="top" src="./assets/stack/mastra.png" alt="" /> &nbsp;[Mastra](https://mastra.ai) | Multi-agent framework |
| <img height="16" align="top" src="./assets/stack/aisdk.png" alt="" /> &nbsp;AI SDK | Model calls via Mastra's native router (Anthropic, OpenAI, Google, xAI, frontier labs, gateways, local) |
| <img height="16" align="top" src="./assets/stack/libsql.png" alt="" /> &nbsp;[LibSQL / Turso](https://turso.tech/libsql) | SQL + vector memory; SQLite for the audit log |
| <img height="16" align="top" src="./assets/stack/zod.svg" alt="" /> &nbsp;[Zod](https://zod.dev) | Schema validation on every tool I/O and config |
| <img height="16" align="top" src="./assets/stack/ccxt.png" alt="" /> &nbsp;[ccxt](https://ccxt.com) | Crypto exchange connectivity |
| <img height="16" align="top" src="./assets/stack/mcp.png" alt="" /> &nbsp;[MCP](https://modelcontextprotocol.io) | External tool servers |
| <img height="16" align="top" src="./assets/stack/acp.png" alt="" /> &nbsp;[ACP](https://agentclientprotocol.com) | Editor / IDE integration |
| <img height="16" align="top" src="./assets/stack/biome.svg" alt="" /> &nbsp;Biome | Lint + format |
| <img height="16" align="top" src="./assets/stack/opentelemetry.svg" alt="" /> &nbsp;OpenTelemetry | Local tracing + metrics (no external export) |

## Development

```bash
bun install          # deps (postinstall patches Mastra + Ink)
bun run dev          # hot-reload TUI
bun test             # Bun's built-in runner (no Jest/Vitest), co-located *.test.ts
bun run typecheck    # tsc --noEmit
bun run build        # bundle to dist/  (--binary for a standalone executable)
bun run check        # Biome lint + format
bun run quality:brokers   # broker conformance + latency gate
```

CI runs the suite, `tsc --noEmit`, Biome, broker conformance, the eval-harness regression gate, and guardrails that block source-map leaks and stray files before publish.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions before opening a PR.

## Ecosystem

Open-source projects from the same team, meant to be used together.

| Project | What it is |
|:--|:--|
| **[Gordon](https://github.com/general-liquidity/gordon)** | The trading agent itself: plan-first, deny-first, terminal-native. |
| **[SharpeArena](https://github.com/general-liquidity/sharpearena)** | A reinforcement-learning environment for trading agents. |
| **[SharpeBench](https://github.com/general-liquidity/sharpebench)** | A reliability benchmark for trading agents: deflated Sharpe, `pass^k`, deterministic process checks. |

## Honest limitations

- **A backtest is not an edge.** Walk-forward, Monte Carlo, and the overfitting guards reduce self-deception; they do not create live alpha.
- **LLM inference costs real money** and scales with session length. Cap it with `GORDON_COST_BUDGET_USD` and disable reasoning passes for cheaper runs.
- **Venue coverage is uneven.** Some brokers need account enrollment, market-data entitlements, or a running gateway before anything works.
- **The agent can be wrong.** That is why every order needs your approval by default. Do not run `auto` on capital you have not sized for being wrong.
- **The windows-arm64 prebuilt binary is best-effort.** Other platforms are built and smoke-tested on every release.
- **This is young software.** v0.1.0, MIT, no warranty. Start in `paper` or `strict` and read the source on the paths that touch money.

## Community & contributing

Issues and pull requests are welcome, especially from people who actually trade.

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** covers setup, conventions, and the bar for money-touching changes.
- **[Open an issue](https://github.com/general-liquidity/gordon/issues)** for bugs, venue gaps, or ideas. Security issues go through [SECURITY.md](./SECURITY.md) instead.
- **Good first contributions:** a new venue adapter, an indicator or microstructure op, a playbook, an eval scenario, or docs fixes.
- If Gordon is useful to you, a star on the repo genuinely helps other traders find it.

## License & safety docs

Gordon is licensed under the [MIT License](./LICENSE). It is built and open-sourced by the team behind General Liquidity.

Before you arm live trading, read [DISCLAIMER.md](./DISCLAIMER.md) and [TERMS.md](./TERMS.md): Gordon can place real orders on real venues with your keys, none of its output is financial advice, and you trade at your own risk. To report a security issue, see [SECURITY.md](./SECURITY.md).

---

<div align="center">
<sub><em>"The most valuable commodity I know of is information."</em><br />Gordon Gekko</sub>
</div>
