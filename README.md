<p align="center">
<pre>
   e$$~~\                       \$$$
░ d$$$      e$$~-_  $$$-~\  e$$~\$$$  e$$~-_  $$$-~$$e ░
░ $$$$  __ d$$$   i $$$    d$$$  $$$ d$$$   i $$$  $$$ ░
░ $$$$   | $$$$   | $$$    $$$$  $$$ $$$$   | $$$  $$$ ░
░ Y$$$   | Y$$$   | $$$    Y$$$  $$$ Y$$$   | $$$  $$$ ░
░  "$$__/   "$$_-~  $$$     "$$_/$$$  "$$_-~  $$$  $$$ ░
 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
</pre>
</p>

<h1 align="center">Claude Code for Vibe Trading</h1>

<p align="center">
  <em>Talk naturally. Trade confidently. Sleep peacefully.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@general-liquidity/gordon-cli"><img src="https://img.shields.io/npm/v/@general-liquidity/gordon-cli.svg?style=flat-square&color=d4a27f" alt="npm version"></a>
  <a href="https://github.com/general-liquidity/gordon-cli/actions"><img src="https://img.shields.io/github/actions/workflow/status/general-liquidity/gordon-cli/release.yml?style=flat-square&label=build" alt="build status"></a>
  <a href="https://github.com/general-liquidity/gordon-cli/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@general-liquidity/gordon-cli.svg?style=flat-square" alt="license"></a>
  <a href="https://discord.gg/general-liquidity"><img src="https://img.shields.io/discord/XXXXXXXXX?style=flat-square&logo=discord&logoColor=white&label=discord" alt="Discord"></a>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#safety">Safety</a> •
  <a href="https://docs.gordon.trade">Docs</a>
</p>

---

## What is Gordon?

Gordon is **Claude Code for vibe trading**. Describe what you want to trade in plain English, and Gordon handles the technical analysis, risk management, and order execution—with your approval at every step.

```
You: I think ETH is gonna bounce here

Gordon: ETH/USDT @ $3,421. RSI oversold at 28, price 1.2% above the
        $3,380 support (tested 4x). Looks like a textbook bounce setup.

        Entry:  $3,400 (limit, near support)
        Stop:   $3,290 (3.2% below entry)
        TP1:    $3,580 (50% position, +5.3%)
        TP2:    $3,720 (50% position, +9.4%)

        Risk/Reward: 1:2.8 — Want me to create this plan?
```

No dashboards. No charts. No complexity. Just vibes. 📈

---

## Installation

**npm** (recommended)
```bash
npm install -g @general-liquidity/gordon-cli
```

**bun**
```bash
bun add -g @general-liquidity/gordon-cli
```

**curl** (standalone binary)
```bash
curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon-cli/main/scripts/install.sh | sh
```

**from source**
```bash
git clone https://github.com/general-liquidity/gordon-cli.git
cd gordon && bun install && bun run build
```

Then run:
```bash
gordon
```

---

## Quick Start

### 1. First Run

Gordon walks you through setup on first launch—API keys, preferences, safety modes.

### 2. Set Environment Variables

```bash
# LLM Provider (pick one)
export OPENAI_API_KEY="sk-..."
export DEDALUS_API_KEY="dd-..."

# Exchange (Binance for now)
export BINANCE_API_KEY="..."
export BINANCE_API_SECRET="..."
```

### 3. Start Talking

```bash
gordon
```

That's it. No config files needed. Just talk.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                           YOU                                   │
│                    "buy BTC near support"                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    🛡️ MIDDLEWARE LAYER                          
│         Input Guardrails │ Access Control │ Rate Limiting       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 📈 GORDON (Mastra Agent Network)                
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Scanner  │ │ Analyst  │ │ Planner  │ │ Executor │            │
│  │ ──────── │ │ ──────── │ │ ──────── │ │ ──────── │            │
│  │ Find     │ │ Deep     │ │ Create   │ │ Execute  │            │
│  │ setups   │ │ analysis │ │ plans    │ │ orders   │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Monitor  │ │ Teacher  │ │Backtester│ │  Gordon  │            │
│  │ ──────── │ │ ──────── │ │ ──────── │ │ ──────── │            │
│  │ Track    │ │ Explain  │ │ Test     │ │ Route &  │            │
│  │ positions│ │ concepts │ │ strategy │ │ orchestrate│          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                 │
│        Handoff Validation │ Fallback Chains │ Error Recovery    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       🔧 TOOLS LAYER (29 modules)               
│                                                                 │
│  Trading: create_plan, execute_plan, close_trade, grid_plan     │
│  Analysis: indicators, orderbook, market_analysis, charts       │ 
│  Discovery: scan_market, trending, new_listings, top_movers     │
│  Risk: kelly_size, volatility_size, exit_conditions, drawdown   │
│  Portfolio: positions, wallet, earn, history, account           │
│  Backtest: run_backtest, optimize, monte_carlo, walk_forward    │
│  System: arm/disarm, scheduler, explain, shared_context         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    💾 INFRASTRUCTURE LAYER                     
│                                                                 │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐     │
│  │  Binance  │  │    LLM    │  │  SQLite   │  │  LibSQL   │     │
│  │  REST+WS  │  │ Providers │  │  Storage  │  │  Vector   │     │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘     │
│       │               │              │              │           │
│   Orders &        OpenAI         Plans &       Semantic         │
│   Market Data    Anthropic       Trades        Memory           │
│   Real-time       Google         Events        RAG              │
│   WebSocket       Dedalus        Audit         Recall           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TRADE PLAN                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ + BUY  0.15 ETH @ $3,400  (limit)                          │ │
│  │ + STOP 0.15 ETH @ $3,290  (stop-limit)                     │ │
│  │ + SELL 0.075 ETH @ $3,580 (TP1)                            │ │
│  │ + SELL 0.075 ETH @ $3,720 (TP2)                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│              [ APPROVE ]  [ MODIFY ]  [ REJECT ]                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (only if you approve + ARM)
┌─────────────────────────────────────────────────────────────────┐
│                       EXECUTION                                 │
│         Orders placed on Binance. Gordon monitors.              │
│         Auto-disarms after 24h. You stay in control.            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Safety

Gordon is paranoid about your money. Here's how:

| Protection | Description |
|------------|-------------|
| 🔒 **SAFE Mode Default** | Gordon starts in SAFE mode. Can analyze, cannot trade. |
| ⏰ **24h Auto-Disarm** | ARMED mode expires automatically. No forgotten bots. |
| ✋ **Human Approval** | Every order requires explicit "yes". No exceptions. |
| 📊 **Risk Disclosure** | See exact $ at risk before every trade. |
| 🛡️ **Position Limits** | Configurable max allocation per trade (default 10%). |
| 💰 **Cash Reserve** | Always keeps 20% cash. Never goes all-in. |

```
SAFE MODE (default)           ARMED MODE (you enable)
─────────────────────         ─────────────────────────
✓ Scan markets                ✓ Everything in SAFE, plus:
✓ Analyze coins               ✓ Execute approved plans
✓ Create plans                ✓ Place real orders
✓ Explain concepts            ✓ Monitor positions
✗ Execute trades              ⏰ Auto-expires in 24h
```

---

## Everything We Built

~200 TypeScript files implementing a production-grade trading platform.

### Core Platform

- **8-Agent Network** — Mastra-based orchestration: Scanner, Analyst, Planner, Executor, Monitor, Teacher, Backtester, Gordon (coordinator)
- **Agent Handoffs** — Validated transitions between agents with fallback chains and error recovery
- **Cross-Agent Memory** — Shared context allowing agents to pass analysis, plans, and backtest results
- **Semantic Memory** — LibSQL Vector for RAG-based recall of past trades and analyses
- **LLM Client** — Multi-provider support (OpenAI, Anthropic Claude, Google Gemini, Dedalus Labs)

### Security & Middleware

- **Input Guardrails** — Prompt injection detection, dangerous command blocking
- **Output Sanitization** — Sensitive data filtering in responses
- **Access Control** — ARMED mode enforcement for trading tools
- **Rate Limiting** — Per-agent, per-tool rate limits to prevent abuse
- **Audit Logging** — Comprehensive trail of all sensitive operations

### Observability

- **OpenTelemetry Tracing** — Distributed tracing for agent calls and tool execution
- **Metrics Collection** — Tool invocation counts, success/failure rates, latency tracking
- **Request Monitoring** — Per-request performance metrics and error classification

### Trading Engine

- **Scanner** — Market-wide opportunity detection across top 50 cryptos
- **Analyzer** — Deep technical analysis per coin with multiple timeframes
- **Planner** — AI-powered trade plan generation with entry/SL/TP levels
- **Validator** — Risk checks, position limits, allocation validation
- **Executor** — Order placement with OCO orders and rollback on failure
- **Monitor** — Real-time position tracking via WebSocket, fill detection, alerts
- **Trailing Stops** — Automatic trailing stop-loss management
- **Order Recovery** — Automatic recovery mechanism for failed/interrupted orders
- **Grid Calculator** — DCA and grid entry calculations

### Trading Strategies

- **Tier 1 (Beginner):** Support Bounce, Bollinger Bounce, SMA Crossover, Volume Surge, VWAP Bounce
- **Tier 2 (Intermediate):** Consolidation Pop, ADX Trend, EMA-RSI Crossover, Relative Strength, Engulfing Pattern
- **Strategy Ensemble** — Combine multiple strategies with configurable weights

### Backtesting Engine

- **Historical Simulation** — Full backtesting against historical data
- **Monte Carlo Analysis** — Statistical confidence intervals
- **Walk-Forward Validation** — Out-of-sample testing
- **Grid Search Optimization** — Hyperparameter tuning
- **Alpha Decay Analysis** — Strategy degradation detection
- **Performance Metrics** — Sharpe ratio, max drawdown, profit factor, win rate

### Technical Analysis

- **RSI** — Relative Strength Index (oversold/overbought)
- **MACD** — Momentum and trend direction
- **Bollinger Bands** — Volatility and mean reversion
- **ATR** — Average True Range for stop placement
- **VWAP** — Volume Weighted Average Price
- **Stochastic RSI** — Momentum oscillator
- **EMA/SMA** — Trend following indicators
- **Volume Analysis** — Confirmation signals and whale detection
- **Support/Resistance** — Automatic level detection

### Infrastructure

- **Binance Client** — Full REST API with HMAC signing, rate limiting, circuit breaker
- **Binance WebSocket** — Real-time price feeds and order updates
- **SQLite Storage** — Plans, trades, events, audit logs with WAL mode
- **LibSQL Vector** — Semantic memory and RAG for conversation recall
- **Service Container** — Dependency injection for clean architecture
- **Repository Pattern** — Data access layer for trades and plans
- **Event Bus** — Event-driven architecture for system coordination
- **Caching Layer** — Price and result caching with TTL
- **Resilience** — Retry logic, exponential backoff, circuit breakers, fallback chains

### User Experience

- **Ink CLI** — React-based terminal UI with theme support
- **Real-time Chat** — Streaming responses with agent attribution
- **Onboarding Flow** — First-run setup wizard
- **Model Selector** — Choose your preferred LLM
- **Keyboard Shortcuts** — Power user navigation
- **Command Autocomplete** — Slash command suggestions
- **Status Bar** — Mode, portfolio value, BTC price, connection status

---

## Configuration

Gordon stores config at `~/.gordon/config.json`:

```json
{
  "version": "1.0.0",
  "mode": "SAFE",
  "preferences": {
    "cashReservePercent": 0.2,
    "maxAllocationPerTrade": 0.1,
    "defaultTimeframes": ["1h", "4h"],
    "topNCoins": 50
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | One LLM | OpenAI API key |
| `ANTHROPIC_API_KEY` | provider | Anthropic Claude API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | required | Google Gemini API key |
| `DEDALUS_API_KEY` | | Dedalus Labs API key (20+ models) |
| `BINANCE_API_KEY` | For trading | Binance API key |
| `BINANCE_API_SECRET` | For trading | Binance secret |

---

## Development

```bash
bun install          # Install dependencies
bun run dev          # Development mode (hot reload)
bun test             # Run tests
bun run typecheck    # Type check
bun run build        # Build for npm
bun run build:binary # Build standalone executable
```

### Project Structure

```
gordon/
├── src/
│   ├── app/           # Terminal UI (React + Ink)
│   │   ├── App.tsx
│   │   ├── ChatView.tsx
│   │   ├── ChatInput.tsx
│   │   ├── components/    # Reusable UI components
│   │   └── ...
│   ├── core/          # Trading logic
│   │   ├── scanner.ts
│   │   ├── analyzer.ts
│   │   ├── planner.ts
│   │   ├── executor.ts
│   │   ├── monitor.ts
│   │   ├── trailing-stop.ts
│   │   ├── indicators/    # Technical indicators
│   │   └── risk-management/
│   ├── backtest/      # Backtesting engine
│   │   ├── engine.ts
│   │   ├── monte-carlo.ts
│   │   ├── walk-forward.ts
│   │   └── optimization/
│   ├── strategies/    # Trading strategies
│   │   ├── tier-1/        # Beginner strategies
│   │   ├── tier-2/        # Intermediate strategies
│   │   └── ensemble.ts
│   ├── services/      # Business services
│   │   ├── trading.service.ts
│   │   ├── portfolio.service.ts
│   │   └── container.ts   # Dependency injection
│   ├── repositories/  # Data access layer
│   ├── infra/         # Infrastructure
│   │   ├── agents/        # Mastra multi-agent system
│   │   │   ├── tools/         # 29 tool modules
│   │   │   └── middleware/    # Guardrails, access control
│   │   ├── binance/       # Exchange client + WebSocket
│   │   ├── llm/           # LLM providers
│   │   ├── storage/       # SQLite + config
│   │   ├── observability/ # OpenTelemetry tracing + metrics
│   │   ├── audit/         # Audit logging
│   │   └── cache/         # Caching layer
│   ├── events/        # Event-driven architecture
│   └── types/         # TypeScript definitions
├── prompts/           # LLM prompt templates
├── scripts/           # Install scripts
└── .github/           # CI/CD workflows
```

---

## Roadmap

- [x] Support Bounce strategy
- [x] Binance spot trading
- [x] Multi-provider LLM (OpenAI, Anthropic, Google, Dedalus)
- [x] Plan-as-diff approval UI
- [x] SAFE/ARMED modes with 24h auto-expiry
- [x] Trailing stops
- [x] 10+ trading strategies (tier 1 & tier 2)
- [x] Backtesting engine with Monte Carlo & walk-forward
- [x] Real-time WebSocket monitoring
- [x] Order recovery mechanism
- [x] Audit logging & security guardrails
- [ ] More exchanges (Coinbase, Kraken)
- [ ] Portfolio rebalancing
- [ ] Mobile notifications
- [ ] Paper trading mode

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Fork, clone, then:
bun install
bun test
# Make changes, add tests, submit PR
```

---

## License

MIT © [General Liquidity, Inc.](https://generalliquidity.com)

---

<p align="center">
  <sub>
    <em>"The most valuable commodity I know of is information."</em>
    <br>
    — Gordon Gekko (the other one)
  </sub>
</p>

<p align="center">
  <a href="https://github.com/general-liquidity/gordon-cli">GitHub</a> •
  <a href="https://www.npmjs.com/package/@general-liquidity/gordon-cli">npm</a> •
  <a href="https://discord.gg/general-liquidity">Discord</a> •
  <a href="https://docs.gordon.trade">Docs</a>
</p>
