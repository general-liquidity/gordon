---
name: learn-mcp
description: Learn how to browse the marketplace and install trading plugins. When user asks "what MCP servers can I add?", "install a plugin", "browse marketplace", or about extending Gordon via Model Context Protocol
tags: [learning, mcp, marketplace, plugins]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Gordon has a curated marketplace of 47 trading plugins. Let me show you how it works.

## What are MCP Plugins?

MCP (Model Context Protocol) plugins are external data providers and tools that Gordon can connect to. They add capabilities beyond Gordon's built-in tools.

## Categories

Explain each category with examples:
- **data-provider** (25 plugins): Market data, on-chain analytics, financial data
  Examples: CoinGecko, Glassnode, Nansen, Alpha Vantage, Twelve Data
- **execution** (10 plugins): Trading, bridges, order management
  Examples: Alpaca, Tradier, Polymarket, deBridge, Solana Agent Kit
- **research** (2 plugins): Deep analytics and research
  Examples: Nansen, Messari
- **infrastructure** (5 plugins): Blockchain nodes, custody, dev platforms
  Examples: QuickNode, Chainstack, Fireblocks
- **analytics** (2 plugins): AI predictions, strategy tools
  Examples: SynthData, Composer

## How to Browse

Tell the user:
1. Type `/marketplace` to open the interactive browser
2. Use Tab to filter by category
3. Type to search by name
4. Press Enter on any plugin to see details + install command
5. Select "Install" to get the command

## How to Install

Show a real example:
```
npm install -g @coingecko/coingecko-mcp@latest
```
Then add to Gordon via `/mcp` → Add new server.

## Free Plugins (No API Key Needed)

Highlight the freebies:
- **Crypto.com** — public market data, zero auth
- **DexPaprika** — DEX data across 33 chains, no key
- **deBridge** — cross-chain bridges, no key
- **Solana Agent Kit** — 60+ Solana actions, open source

## CLI Tools Too

Mention `/cli` for trading CLIs:
- Kraken CLI — 134 commands, paper trading built in
- Jupiter CLI — Solana DEX (spot, perps, lending)
- Boba CLI — multi-chain trading + prediction markets
- OpenBB — all-in-one research terminal

## Try It

"Type `/marketplace` to browse, or tell me what capability you're looking for and I'll recommend the right plugin."
