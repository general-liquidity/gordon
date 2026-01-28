```
 ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
 ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
```

<h1 align="center">📈 AI-Powered Vibe Trading for Crypto</h1>

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
export BINANCE_SECRET_KEY="..."
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
│                     📈 GORDON AGENT                                  
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Scanner  │  │ Analyst  │  │ Planner  │  │ Teacher  │         │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │
│        │             │             │             │              │
│        └─────────────┴──────┬──────┴─────────────┘              │
│                             │                                   │
│                    ┌────────▼────────┐                          │
│                    │   Orchestrator  │                          │
│                    └────────┬────────┘                          │
└─────────────────────────────┼───────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Binance  │   │  OpenAI  │   │  SQLite  │
        │   API    │   │ /Dedalus │   │ Storage  │
        └──────────┘   └──────────┘   └──────────┘
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

### Core Platform
- **Agent Orchestrator** — Multi-agent coordination with OpenAI Agents SDK
- **Intent Router** — Natural language → structured trading intent
- **LLM Client** — Multi-provider support (OpenAI, Dedalus Labs)

### Trading Engine
- **Scanner** — Market-wide opportunity detection
- **Analyzer** — Deep technical analysis per coin
- **Planner** — AI-powered trade plan generation
- **Validator** — Risk checks before execution
- **Executor** — Order placement with rollback on failure
- **Monitor** — Position tracking, fill detection, alerts

### Technical Analysis
- **RSI** — Relative Strength Index (oversold/overbought)
- **MACD** — Momentum and trend direction
- **Volume Analysis** — Confirmation signals
- **Level Detection** — Support/resistance identification

### Infrastructure
- **Binance Client** — Full REST API with HMAC signing
- **SQLite Storage** — Local persistence for plans, trades, events
- **Config Management** — JSON config at `~/.gordon/`

### User Experience
- **Ink CLI** — Beautiful terminal UI with React
- **Onboarding Flow** — First-run setup wizard
- **Error Boundaries** — Graceful error handling
- **Setup Wizard** — API key configuration

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
| `OPENAI_API_KEY` | One of these | OpenAI API key |
| `DEDALUS_API_KEY` | required | Dedalus Labs API key |
| `BINANCE_API_KEY` | For trading | Binance API key |
| `BINANCE_SECRET_KEY` | For trading | Binance secret |

---

## Development

```bash
bun install          # Install dependencies
bun run dev          # Development mode (hot reload)
bun test             # Run 90 tests
bun run typecheck    # Type check
bun run build        # Build for npm
bun run build:binary # Build standalone executable
```

### Project Structure

```
gordon/
├── src/
│   ├── app/           # Ink UI (React for terminals)
│   │   ├── App.tsx
│   │   ├── Onboarding.tsx
│   │   ├── SetupWizard.tsx
│   │   └── ...
│   ├── core/          # Business logic
│   │   ├── scanner.ts
│   │   ├── analyzer.ts
│   │   ├── planner.ts
│   │   ├── executor.ts
│   │   └── ...
│   ├── infra/         # External integrations
│   │   ├── agents/    # OpenAI Agents SDK
│   │   ├── binance/   # Exchange client
│   │   ├── llm/       # LLM providers
│   │   └── storage/   # SQLite + JSON
│   ├── indicators/    # Technical analysis
│   └── types/         # TypeScript types
├── prompts/           # LLM prompt templates
├── scripts/           # Install scripts
└── .github/           # CI/CD workflows
```

---

## Roadmap

- [x] Support Bounce strategy
- [x] Binance spot trading
- [x] Multi-provider LLM
- [x] Plan-as-diff approval
- [x] SAFE/ARMED modes
- [ ] More strategies (breakout, mean reversion)
- [ ] More exchanges (Coinbase, Kraken)
- [ ] Portfolio rebalancing
- [ ] Trailing stops
- [ ] Mobile notifications

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

MIT © [General Liquidity, Inc.](https://general-liquidity.com)

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
