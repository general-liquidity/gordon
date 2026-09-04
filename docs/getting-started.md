# Getting started with Gordon

This guide takes you from installation to a safe first plan. It does not require a funded account.

## Requirements

- Node.js 18 or newer for the published npm wrapper
- Bun 1.0 or newer when building from source
- A 64-bit, true-color terminal for the full TUI
- One supported model provider for agent reasoning
- Venue credentials only when you want private account data or order execution

## Install the published binary

```bash
npm install -g @general-liquidity/gordon
gordon
```

The npm package selects a prebuilt binary for macOS arm64/x64, Linux x64/arm64 with glibc or musl, and Windows x64/arm64. The `gordon` command runs that binary directly; it does not keep a Node process resident.

You can also install with Bun:

```bash
bun add -g @general-liquidity/gordon
```

## Build from source

```bash
git clone https://github.com/general-liquidity/gordon.git
cd gordon
bun install
bun run build
bun start
```

Relative imports use `.ts` extensions and tests use Bun's built-in runner. See [CONTRIBUTING.md](../CONTRIBUTING.md) before changing a money-touching path.

## Configure a model and venue

First run walks through model selection, venue setup, the default permission mode, and operator preferences. Gordon stores local state under `~/.gordon/`.

For a quick shell setup, provide one model key and only the venue credentials you use:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."     # or OpenAI, Google, or xAI
export BINANCE_API_KEY="..."
export BINANCE_API_SECRET="..."
```

For equities, an Alpaca example is:

```bash
export ALPACA_API_KEY="..."
export ALPACA_API_SECRET="..."
export ALPACA_PAPER="true"
```

The complete variable catalog is [`.env.example`](../.env.example). You can copy the fields you need into `~/.gordon/.env`. Gordon also exposes durable settings through `/flags`; process environment values remain the highest-priority one-run override for most settings.

> [!IMPORTANT]
> Do not commit credentials into a repository-level `.env` or `.gordon/settings.json`. Safety-critical `flags` values from project settings are ignored, but project files are not a credential store.

## Start safely

Launch the TUI:

```bash
gordon
```

Start in `strict` or `paper` mode:

```text
/strict
/doctor
/scan
/analyze BTC
/plan BTC
```

`/plan` creates a structured proposal. It does not place an order in `strict`, `observe`, or `plan` mode. In `paper`, the same execution path requests the configured venue's paper or sandbox route; verify that behavior for the selected venue. In the default `ask` mode, every agent-issued exposure increase requires explicit approval before venue dispatch.

Useful first commands:

| Command | Purpose |
|---|---|
| `/doctor` | Check configuration, credentials, connectivity, permissions, and runtime health |
| `/scan` | Find current market movement and candidates |
| `/analyze BTC` | Run a multi-timeframe analysis on one symbol |
| `/plan ETH` | Draft a structured plan without assuming execution permission |
| `/backtest` | Replay a strategy on historical data |
| `/portfolio` | Review positions, cash, and P/L across configured venues |
| `/strict`, `/paper`, `/ask`, `/auto` | Change how far Gordon may act without another approval |
| `/killswitch` | Trip or inspect a firm, venue, instrument, or strategy halt |
| `/flags` | Inspect and change durable operator settings |

The generated [action catalog](./generated/actions.md) covers the canonical actions shared across Gordon's supported surfaces. Use `/help` in the TUI for the complete live slash-command registry.

## Understand local-first behavior

Gordon keeps its settings, memory, audit state, and local telemetry queues on your machine. That does not mean the process is offline: configured model providers, market-data sources, exchanges, brokers, MCP servers, and other integrations receive the requests required to do their jobs.

Anonymous Gordon usage telemetry is disabled until you explicitly enable it. `DO_NOT_TRACK=1` or `GORDON_TELEMETRY_DISABLED=1` forces it off. Research-data sharing is a separate opt-in. See [Operations](./operations.md#telemetry-and-data-movement) for the exact boundary.

## Before live trading

Read the [security and safety guide](./security/README.md), [DISCLAIMER.md](../DISCLAIMER.md), and [TERMS.md](../TERMS.md). The first live arm asks for a one-time acknowledgment. Live execution still passes through the permission engine, risk classifier, trading constitution, kill switches, hooks, and audit path.

> [!WARNING]
> Gordon can place real orders with your keys. Trading can lose money. Start with paper or sandbox paths, verify each venue's behavior, and never arm capital you cannot afford to lose.

## Next steps

- [Connect integrations](./integrations.md)
- [Choose a run surface](./operations.md#run-surfaces)
- [Understand the safety chain](./security/README.md)
- [Review the architecture](./architecture.md)
- [Explore capabilities](./capabilities.md)
