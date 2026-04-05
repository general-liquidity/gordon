# Canonical Gordon Actions

Generated on 2026-03-08T17:41:15.486Z.

## Actions

### `market.scan`

Scan the active crypto venue universe for trading opportunities.

- Domain: `market`
- Capability: `read`
- Task scope: `scan`
- Side effects: `none`
- Approval: `none`
- Dry run: `false`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/scan`
- Workflow: `discover`
- Audience: `core`
- Tool: `scan_market`
- Example: `/scan`

### `market.analyze`

Run a single-symbol analysis on the active crypto venue or stock broker.

- Domain: `market`
- Capability: `read`
- Task scope: `analysis`
- Side effects: `none`
- Approval: `none`
- Dry run: `false`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/analyze`
- Workflow: `analyze`
- Audience: `core`
- Tool: `analyze_coin`
- Example: `/analyze <symbol>`

### `trading.plan`

Create a structured trading plan before execution.

- Domain: `trading`
- Capability: `plan`
- Task scope: `planning`
- Side effects: `preview`
- Approval: `confirm`
- Dry run: `true`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/plan`
- Workflow: `trade`
- Audience: `core`
- Tool: `create_plan`
- Example: `/plan <symbol>`

### `trading.preview_market_order`

Preview a crypto or stock market order without placing it.

- Domain: `trading`
- Capability: `plan`
- Task scope: `execution`
- Side effects: `preview`
- Approval: `confirm`
- Dry run: `true`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/preview-order`
- Workflow: `trade`
- Audience: `advanced`
- Tool: `preview_market_order`
- Example: `/preview-order <symbol> <buy|sell> <amount> [quote]`

### `trading.market_order`

Place a live crypto or stock market order on the active execution venue.

- Domain: `trading`
- Capability: `execute`
- Task scope: `execution`
- Side effects: `funds`
- Approval: `armed_mode`
- Dry run: `true`
- Visibility: `agent`
- Tool: `place_market_order`

### `account.portfolio`

Show portfolio or broker account balances.

- Domain: `account`
- Capability: `read`
- Task scope: `ops`
- Side effects: `none`
- Approval: `none`
- Dry run: `false`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/portfolio`
- Workflow: `accounts`
- Audience: `core`
- Example: `/portfolio`

### `wallet.fund`

Fund wallets or fetch MoonPay funding flows and quotes.

- Domain: `wallet`
- Capability: `plan`
- Task scope: `funding`
- Side effects: `preview`
- Approval: `external`
- Dry run: `true`
- Visibility: `interactive`, `json`, `agent`, `mcp`
- Slash: `/fund`
- Workflow: `trade`
- Audience: `advanced`
- Example: `/fund [buy|sell|swap|quote|limits|history] ...`

### `payments.intent`

Prepare a Polygon x402 payment intent for a paid API or agent payment.

- Domain: `payments`
- Capability: `plan`
- Task scope: `funding`
- Side effects: `preview`
- Approval: `external`
- Dry run: `true`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/pay`
- Workflow: `trade`
- Audience: `advanced`
- Example: `/pay <resource> <amount>`

### `system.arm`

Switch Gordon into ARMED mode for live execution.

- Domain: `system`
- Capability: `configure`
- Task scope: `system`
- Side effects: `state`
- Approval: `confirm`
- Dry run: `false`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/arm`
- Workflow: `operate`
- Audience: `advanced`
- Example: `/arm`

### `system.disarm`

Return Gordon to SAFE mode.

- Domain: `system`
- Capability: `configure`
- Task scope: `system`
- Side effects: `state`
- Approval: `none`
- Dry run: `false`
- Visibility: `interactive`, `json`, `agent`
- Slash: `/disarm`
- Workflow: `operate`
- Audience: `advanced`
- Example: `/disarm`

## Derived Tool Metadata

- `scan_market` -> `market.scan` (scan, none)
- `analyze_coin` -> `market.analyze` (analysis, none)
- `create_plan` -> `trading.plan` (planning, preview)
- `preview_market_order` -> `trading.preview_market_order` (execution, preview)
- `place_market_order` -> `trading.market_order` (execution, funds)

## Provider Capability Discovery

- `Alpaca` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `E*TRADE` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `Interactive Brokers` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `Schwab` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `tastytrade` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `TradeStation` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `Tradier` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `Trading 212` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `Webull` [execution_venue / broker / retail_broker] supports 4 capability binding(s)
- `Base Flashblocks` [chain_infrastructure / chain_ecosystem] supports 0 capability binding(s)
- `Base RPC` [chain_infrastructure / chain_ecosystem] supports 0 capability binding(s)
- `Base Registry API` [market_data_source / registry] supports 0 capability binding(s)
- `Basescan` [market_data_source / explorer] supports 0 capability binding(s)
- `Chainlink Data Feeds` [market_data_source / oracle] supports 0 capability binding(s)
- `Chainlink Data Streams` [market_data_source / oracle] supports 0 capability binding(s)
- `DefiLlama` [market_data_source / aggregator] supports 0 capability binding(s)
- `DexScreener` [market_data_source / analytics_vendor] supports 0 capability binding(s)
- `SynthData` [research_analytics_provider] supports 0 capability binding(s)
- `The Graph` [market_data_source / indexer] supports 0 capability binding(s)
- `Binance` [execution_venue / cex / spot_cex] supports 6 capability binding(s)
- `Binance US` [execution_venue / cex / spot_cex] supports 6 capability binding(s)
- `Bitfinex` [execution_venue / cex / spot_cex] supports 6 capability binding(s)
- `Coinbase Advanced Trade` [execution_venue / cex / spot_cex] supports 6 capability binding(s)
- `Hyperliquid` [execution_venue / dex / perps_dex] supports 6 capability binding(s)
- `Kraken` [execution_venue / cex / spot_cex] supports 6 capability binding(s)
- `Robinhood Crypto` [execution_venue / broker / crypto_broker] supports 6 capability binding(s)
- `Uniswap Protocol` [execution_venue / dex / amm_dex] supports 6 capability binding(s)
- `Anthropic` [model_provider / native / native] supports 0 capability binding(s)
- `Dedalus` [model_gateway / gateway / native] supports 0 capability binding(s)
- `Anthropic via Dedalus` [model_provider / native / routed] supports 0 capability binding(s)
- `Google via Dedalus` [model_provider / native / routed] supports 0 capability binding(s)
- `Moonshot via Dedalus` [model_provider / native / routed] supports 0 capability binding(s)
- `OpenAI via Dedalus` [model_provider / native / routed] supports 0 capability binding(s)
- `xAI via Dedalus` [model_provider / native / routed] supports 0 capability binding(s)
- `Google` [model_provider / native / native] supports 0 capability binding(s)
- `Inception Labs` [model_provider / native / direct_openai_compatible] supports 0 capability binding(s)
- `OpenAI` [model_provider / native / native] supports 0 capability binding(s)
- `Axiom` [observability_provider] supports 0 capability binding(s)
- `OpenTelemetry` [observability_provider] supports 0 capability binding(s)
- `Coinbase CDP AgentKit` [agent_toolkit] supports 0 capability binding(s)
- `Drift` [execution_venue / dex / perps_dex / nested_dependency / parent:solanakit] supports 0 capability binding(s)
- `Jupiter` [execution_venue / dex / dex_aggregator / nested_dependency / parent:solanakit] supports 0 capability binding(s)
- `Polkadot Agent Kit` [agent_toolkit] supports 0 capability binding(s)
- `Pump.fun` [execution_venue / dex / launchpad_protocol / nested_dependency / parent:solanakit] supports 0 capability binding(s)
- `Solana Agent Kit` [agent_toolkit] supports 0 capability binding(s)
- `Supabase License Backend` [service_backend] supports 0 capability binding(s)
