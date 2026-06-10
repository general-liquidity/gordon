---
name: learn-commands
description: Complete guide to Gordon's slash commands organized by category. When user asks "what commands exist?", "what can you do?", "list slash commands", or wants a command reference
tags: [learning, commands, reference]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Gordon has many slash commands. Here's how they're organized.

## Command Categories

Explain each category with the most important commands:

### Market Discovery
The commands that help you find trading opportunities:
- `/scan` — broad market scan for setups (crypto-first)
- `/trending` — top gainers/losers in the last 24h
- `/volume` — highest volume pairs right now
- `/analyze <symbol>` — deep technical analysis on one symbol
- `/breakouts` — breakout and breakdown setups
- `/regime` — current market regime (trending/ranging/volatile)
- `/pairs <A> <B>` — correlation and pairs analysis

### Trading
Commands that execute or manage trades:
- `/auto` — auto-execute trades without per-action approval
- `/ask` — approve each trade via dialog (DEFAULT, recommended)
- `/strict` — read-only mode, all trades blocked
- `/plan` — create a structured trade plan
- `/cancel <id>` — cancel an open order
- `/close <symbol>` — close a position
- `/stop-loss <symbol> <price>` — set stop loss
- `/take-profit <symbol> <price>` — set take profit

### Portfolio & Account
- `/portfolio` — full portfolio overview
- `/positions` — open positions
- `/orders` — open orders
- `/history` — trade history

### Strategy & Analysis
- `/backtest <strategy> <symbol>` — run a backtest
- `/predict <symbol>` — AI price prediction
- `/synth <type> <symbol>` — SynthData analysis (volatility, options, LP)
- `/strategy` — strategy management
- `/autonomous` — autonomous trading mandates

### System & Configuration
- `/model` — switch AI model and provider
- `/theme` — change color theme
- `/config` — edit settings
- `/doctor` — diagnostics and health checks
- `/mcp` — manage MCP plugin servers
- `/marketplace` — browse and install trading plugins
- `/cli` — browse trading CLI tools
- `/shortcuts` — keyboard shortcut reference
- `/skills` — list available skills
- `/hooks` — view registered lifecycle hooks
- `/compact` — manually trigger context compaction
- `/clear` — clear conversation
- `/cost` — session cost breakdown
- `/effort` — set reasoning depth

### Skills (Reusable Workflows)
- `/tutorial` — interactive walkthrough for new users
- `/quick-scan` — 30-second market snapshot
- `/dd <symbol>` — full due diligence
- `/risk-check` — portfolio risk assessment
- `/morning-brief` — daily trading brief
- `/close-losers` — review and close losing positions
- `/swing-entry <symbol>` — complete swing entry checklist
- `/scalp <symbol>` — quick scalp workflow
- `/pairs-trade <A> <B>` — full pairs trading workflow
- `/rebalance` — portfolio rebalance
- `/earnings-play <symbol>` — pre-earnings analysis
- `/dca-setup <symbol>` — set up dollar-cost averaging
- `/exit-review` — review all positions
- `/weekend-review` — weekly performance review

## Finding Commands
- Type `/` to see all commands in the typeahead picker
- Use Tab to filter by category
- Type to search by name
- `/help` opens the searchable command browser
- Press Ctrl+P for the command palette

## Pro Tips
- Commands with `<args>` accept arguments: `/analyze BTC`
- Most commands also have aliases: `/m` = `/model`, `/s` = `/scan`
- If a command doesn't exist as a slash command, just type naturally — Gordon will figure it out
