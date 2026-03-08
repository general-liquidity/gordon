# Capability Truth Matrix

This file is the prompt and copy source of truth for Gordon's current product surface.

## Product Positioning

- Gordon is a chat-first trading agent for crypto and stocks.
- Crypto currently has the broadest market-wide discovery, onchain, DEX, and venue coverage.
- Stocks currently support broker-linked quotes, analysis, plans, positions, orders, portfolio checks, and backtests.
- Some workflows are cross-market, while others remain market-specific by capability.

## Copy Rules

- Use `execution venue` as the generic term when copy can span exchanges, brokers, and protocols.
- Use `exchange`, `broker`, or `protocol` only when the venue type matters.
- Prefer `symbol`, `ticker`, `market`, or `instrument` over `coin` when the workflow spans crypto and stocks.
- Keep `coin` or `token` language for crypto-native discovery, DEX, onchain, liquidation, and wallet-rail flows.
- Do not hard-assume `USDT` or a default exchange in shared prompts or working-memory templates.

## Capability Matrix

| Capability | Scope | Supported Markets | Copy Guidance |
| --- | --- | --- | --- |
| Broad discovery, trending, movers | Crypto-only | Crypto | Describe as crypto-first. Do not imply stock-universe scanning. |
| Single-symbol analysis and charts | Cross-market | Crypto, stocks | Describe as available for crypto symbols and supported stock tickers. |
| Trade planning and order preview | Cross-market | Crypto, stocks | Use symbol/market wording, not coin-only phrasing. |
| Live execution | Cross-market | Crypto, stocks | Anchor copy in the active execution venue. |
| Portfolio, positions, orders, balances | Cross-market | Crypto, stocks | Present as one operator surface with market-specific capability differences. |
| Systematic research and backtesting | Cross-market | Crypto, stocks | Be explicit that data breadth still depends on the connected venue and history support. |
| Onchain protocols, Base, DEX, chain tooling | Crypto-only | Crypto | Keep explicitly onchain and crypto-specific. |
| Wallet rails, funding, payments | Crypto-only | Crypto | Treat as rails or wallet workflows, not generic trading features. |
| Broker-linked stock workflows | Stocks-only | Stocks | Anchor copy in broker-linked quotes, analysis, orders, positions, and backtests. |
