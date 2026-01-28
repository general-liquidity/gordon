# Gordon v1 Design Document

> Claude Code for Vibe Trading

**Created:** 2026-01-28
**Status:** Approved

---

## Overview

Gordon is a conversational trading assistant that helps users find opportunities, plan trades, and execute them safely on Binance. It targets casual users first, with progressive disclosure for advanced features.

**Core philosophy:** "Vibe trading" — users talk naturally, Gordon interprets intent, shows plans as diffs, and executes only with explicit approval.

---

## Branding

### Name Origin
Gordon Gekko — the iconic trader from Wall Street.

### Color Palette
```typescript
const COLORS = {
  TAN: "#d4a27f",        // Primary accent
  TAN_DIM: "#b8896a",    // Dimmed accent
  WHITE: "#e8e4de",      // Primary text
  DIM: "#a39e93",        // Muted text
};
```

### ASCII Banner
```
   ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
  ██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
  ██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
  ██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
  ╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
```

Fallback for terminals without Unicode:
```
   ____   ___  ____  ____   ___  _   _
  / ___| / _ \|  _ \|  _ \ / _ \| \ | |
 | |  _ | | | | |_) | | | | | | |  \| |
 | |_| || |_| |  _ <| |_| | |_| | |\  |
  \____| \___/|_| \_\____/ \___/|_| \_|
```

### Gekko Quotes (rotating on startup)
```typescript
const QUOTES = [
  "The most valuable commodity I know of is information.",
  "Greed, for lack of a better word, is good.",
  "Money never sleeps.",
  "I don't throw darts at a board. I bet on sure things.",
  "What's worth doing is worth doing for money.",
];
```

### Taglines
- "Claude Code for Vibe Trading"
- Street tape + signal desk: orderbooks, scanners, overlays
- Strategy war room: backtests, optimizers, multi-agent reads
- Execution floor: algo orders, risk gates, multi-exchange routing

---

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Bun |
| Language | TypeScript |
| CLI Framework | Ink (React for CLIs) |
| Agent SDK | OpenAI Agents SDK |
| LLM Gateway | Dedalus Labs API |
| Database | SQLite (Bun built-in) + JSON config |
| Exchange | Binance (spot only) |

---

## Target Users

**Primary:** Casual/curious users who are new to trading
**Approach:** Progressive disclosure — start simple, reveal complexity as users grow

| Level | User sees |
|-------|-----------|
| Casual | Conversation only, choices, plain English |
| Semi-informed | More detail in plans, can adjust parameters |
| Experienced | Power mode, commands, raw indicators |

---

## Trading Constraints (v1)

| Constraint | Value |
|------------|-------|
| Exchange | Binance only |
| Market type | Spot only (no futures/perps) |
| Direction | Long only (no shorts) |
| Leverage | None (1x only) |
| Default cash reserve | 20% always untouched |
| Max per trade | 10% of portfolio |
| Strategy | Support Bounce only |
| Trailing stops | No (v1.1) |

---

## Safety Modes

| Mode | What Gordon can do | Entry |
|------|-------------------|-------|
| **SAFE** (default) | Scan, analyze, create plans. Cannot place orders. | Default on start |
| **ARMED** | Can execute approved plans. Orders go to Binance. | User says "arm trading" |

- ARMED auto-disarms after **24 hours**
- User can manually disarm anytime
- LIVE mode (full autonomy) planned for v1.1+

---

## Intent Categories

Gordon understands these user intents:

```typescript
type Intent =
  | { type: "EXPLORE" }    // "What's happening in the market?"
  | { type: "ANALYZE" }    // "What do you think about DOT?"
  | { type: "PLAN" }       // "Find me a low-risk trade"
  | { type: "EXECUTE" }    // "Do it" / "Execute the plan"
  | { type: "MONITOR" }    // "How's my trade doing?"
  | { type: "PROTECT" }    // "Close everything"
  | { type: "LEARN" }      // "Why did you pick that?"
  | { type: "SETTINGS" }   // Configuration changes
  | { type: "UNCLEAR" }    // Fallback
```

---

## AI vs Deterministic Split

**AI (Dedalus Labs / OpenAI):**
- Intent parsing (understanding user messages)
- Plan drafting (reasoning about risk/reward)
- Ranking opportunities (synthesizing signals)
- Explanations (natural language)

**Deterministic (pure code):**
- Market data fetching
- Indicator calculation (RSI, MACD, volume)
- Support/resistance detection
- Plan validation
- Order execution
- Position monitoring
- Anomaly detection (simple rules)

---

## Data Models

### Config (`~/.gordon/config.json`)

```typescript
interface GordonConfig {
  version: string;

  exchange: {
    name: "binance";
    apiKey: string;
    apiSecret: string;
    permissions: {
      read: boolean;
      spotTrade: boolean;
      withdraw: boolean;  // must be false
    };
  };

  preferences: {
    cashReservePercent: number;       // default: 0.20
    maxAllocationPerTrade: number;    // default: 0.10
    defaultTimeframes: string[];      // default: ["1h", "4h"]
    topNCoins: number;                // default: 50
  };

  mode: "SAFE" | "ARMED";
  armedUntil: string | null;
}
```

### Plan (`plans` table in SQLite)

```typescript
interface Plan {
  id: string;                         // "pln_abc123"
  createdAt: string;

  symbol: string;                     // "DOTUSDT"
  direction: "long";
  strategy: "support_bounce";

  allocation: {
    currency: "USDT";
    amount: number;
    percentOfPortfolio: number;
  };

  entry: {
    type: "limit" | "market";
    price: number | null;
  };

  dca: Array<{
    price: number;
    percentOfAllocation: number;
  }> | null;

  stopLoss: {
    price: number;
  };

  takeProfit: Array<{
    price: number;
    percentToSell: number;
  }>;

  reasoning: string;

  status: "DRAFT" | "APPROVED" | "EXECUTING" | "CLOSED" | "CANCELLED";
}
```

### Trade (`trades` table in SQLite)

```typescript
interface Trade {
  id: string;
  planId: string;

  openedAt: string;
  closedAt: string | null;

  symbol: string;

  entries: Array<{
    orderId: string;
    price: number;
    quantity: number;
    filledAt: string;
  }>;

  exits: Array<{
    orderId: string;
    price: number;
    quantity: number;
    filledAt: string;
    reason: "TP1" | "TP2" | "TP3" | "STOP" | "MANUAL";
  }>;

  averageEntry: number;
  realizedPnl: number;
  realizedPnlPercent: number;

  status: "OPEN" | "PARTIAL" | "CLOSED";
}
```

### Event Log (`events` table in SQLite)

```typescript
interface Event {
  id: string;
  timestamp: string;

  type: "INTENT" | "SCAN" | "ANALYZE" | "PLAN_CREATED" | "PLAN_APPROVED"
      | "ORDER_PLACED" | "ORDER_FILLED" | "ALERT" | "ERROR";

  data: Record<string, any>;

  planId?: string;
  tradeId?: string;
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GORDON CLI (Ink + Bun)                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Conversation│  │   Display   │  │     Input Loop      │  │
│  │   Engine    │  │   (TUI)     │  │  (chat interface)   │  │
│  └──────┬──────┘  └─────────────┘  └─────────────────────┘  │
│         │                                                    │
│  ┌──────▼──────────────────────────────────────────────────┐ │
│  │                   INTENT ROUTER                          │ │
│  │  (AI: parse user message → intent + params)              │ │
│  └──────┬───────────────────────────────────────────────────┘ │
│         │                                                    │
│  ┌──────▼──────────────────────────────────────────────────┐ │
│  │                 CORE MODULES                             │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐      │ │
│  │  │ Scanner │ │Analyzer │ │ Planner │ │ Executor  │      │ │
│  │  │(determ.)│ │(determ.)│ │  (AI)   │ │(determ.)  │      │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └───────────┘      │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐                    │ │
│  │  │ Monitor │ │Protector│ │Explainer│                    │ │
│  │  │(determ.)│ │(determ.)│ │  (AI)   │                    │ │
│  │  └─────────┘ └─────────┘ └─────────┘                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│         │                                                    │
│  ┌──────▼──────────────────────────────────────────────────┐ │
│  │              INFRASTRUCTURE LAYER                        │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────┐       │ │
│  │  │ Binance  │ │ Storage  │ │   LLM Gateway      │       │ │
│  │  │ Adapter  │ │(SQLite+  │ │ (Dedalus Labs API) │       │ │
│  │  │          │ │ JSON)    │ │                    │       │ │
│  │  └──────────┘ └──────────┘ └────────────────────┘       │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Module Responsibilities

### Scanner (Deterministic)
- Fetch candles from Binance (1h, 4h)
- Calculate indicators (RSI, MACD, volume MA)
- Detect support/resistance levels
- Score and rank coins
- Categorize: Strong / Neutral / Risky

### Analyzer (Deterministic)
- Deep dive on single coin
- Identify key levels (S1-S3, R1-R3)
- Determine trend and volume state
- Support Bounce setup detection

### Planner (AI)
- Receive analysis + user preferences
- Determine entry, DCA, stop, take-profits
- Calculate position sizing
- Generate reasoning

### Validator (Deterministic)
- Check plan completeness
- Verify allocation limits
- Ensure stop/TP logic is valid
- Pre-execution checks

### Executor (Deterministic)
- Verify ARMED mode
- Place orders on Binance
- Create Trade records
- Log all events

### Monitor (Deterministic)
- Poll every 15 minutes while CLI open
- Sync positions with Binance
- Update PnL calculations
- Detect anomalies (volume spikes, flash crashes)

### Explainer (AI)
- Answer "why" questions
- Explain plan decisions
- Teach trading concepts

---

## Project Structure

```
gordon-cli/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── README.md
│
├── src/
│   ├── index.tsx                 # Entry point
│   │
│   ├── app/
│   │   ├── App.tsx               # Main Ink component
│   │   ├── ChatView.tsx          # Conversation interface
│   │   ├── StatusBar.tsx         # Mode, portfolio, connection
│   │   ├── PlanDiff.tsx          # Plan display component
│   │   ├── WelcomeBanner.tsx     # ASCII art + quotes
│   │   └── QuickStartMenu.tsx    # Initial menu
│   │
│   ├── core/
│   │   ├── intent-router.ts      # AI: parse → intent
│   │   ├── scanner.ts            # Deterministic: scanning
│   │   ├── analyzer.ts           # Deterministic: analysis
│   │   ├── planner.ts            # AI: draft plans
│   │   ├── validator.ts          # Deterministic: validation
│   │   ├── executor.ts           # Deterministic: execution
│   │   ├── monitor.ts            # Deterministic: monitoring
│   │   └── explainer.ts          # AI: explanations
│   │
│   ├── infra/
│   │   ├── binance/
│   │   │   ├── client.ts
│   │   │   ├── types.ts
│   │   │   └── permissions.ts
│   │   │
│   │   ├── llm/
│   │   │   ├── client.ts         # Dedalus Labs client
│   │   │   ├── prompts.ts
│   │   │   └── types.ts
│   │   │
│   │   └── storage/
│   │       ├── config.ts
│   │       ├── database.ts
│   │       ├── plans.ts
│   │       ├── trades.ts
│   │       └── events.ts
│   │
│   ├── indicators/
│   │   ├── rsi.ts
│   │   ├── macd.ts
│   │   ├── volume.ts
│   │   └── levels.ts
│   │
│   └── types/
│       ├── config.ts
│       ├── plan.ts
│       ├── trade.ts
│       ├── intent.ts
│       └── market.ts
│
├── prompts/
│   ├── intent-router.md
│   ├── planner.md
│   └── explainer.md
│
└── tests/
    ├── scanner.test.ts
    ├── analyzer.test.ts
    ├── validator.test.ts
    └── indicators.test.ts
```

---

## Onboarding Flow

1. **Welcome** — ASCII banner, Gekko quote, feature highlights
2. **Quick Start Menu** — Options for new/returning users
3. **Connect Exchange** — Open browser to Binance API Management, paste keys
4. **Verify Permissions** — Ensure read + spot trade, reject if withdrawals enabled
5. **Risk Preferences** — Multiple choice: cash reserve %, max per trade %
6. **Ready** — Show portfolio, enter conversation mode in SAFE

---

## Conversation Examples

**Explore:**
```
User: "what's happening in the market?"
Gordon: [Scans top 50, ranks, categorizes]
        "Here's what I see: DOT and LINK look strong near support..."
```

**Plan:**
```
User: "I want to buy some DOT, low risk"
Gordon: [Analyzes DOT, drafts plan]
        "Here's my plan: Buy $10 at $5.30, stop at $4.95, targets at $5.80 and $6.20..."
```

**Execute:**
```
User: "arm trading"
Gordon: "Trading armed for 24 hours."

User: "execute"
Gordon: [Validates, places orders]
        "Done. Limit buy placed, stop-loss set, take-profits ready."
```

**Monitor:**
```
User: "how's my trade?"
Gordon: "DOT is up 4.2%. Stop is safe. Next target 5% away."
```

---

## Implementation Phases

### Phase 1: Foundation
- Project setup (Bun + Ink)
- Storage layer (JSON config + SQLite)
- Binance adapter (read-only)
- Onboarding flow

### Phase 2: Analysis Engine
- Indicators (RSI, MACD, volume)
- Support/resistance detection
- Scanner module
- Analyzer module

### Phase 3: AI Integration
- Dedalus Labs client
- OpenAI Agents SDK setup
- Intent Router
- Planner module
- Explainer module

### Phase 4: Execution
- Validator module
- Binance write operations
- Executor module
- Safety modes (SAFE/ARMED)

### Phase 5: Polish
- Monitor module (15-min polling)
- Full conversation UI
- Testing & hardening
- Error handling

---

## Future (v1.1+)

- Trailing stops
- Background daemon (always-on monitoring)
- Multiple strategies
- LIVE mode (full autonomy)
- Portfolio-level thinking
- Multi-exchange support
- Web/mobile interface

---

## Success Criteria

Gordon v1 is successful when:
1. A casual user can connect Binance and find an opportunity in < 5 minutes
2. Plan-as-diff feels natural and builds trust
3. Execution is reliable with zero unexpected trades
4. Users learn trading concepts through conversation
5. AI costs stay under $3k/year with active use
