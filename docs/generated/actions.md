# Canonical Gordon Actions

Generated on 2026-03-06T19:20:36.591Z.

## Actions

### `market.scan`

Scan the active exchange universe for trading opportunities.

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

Run a single-symbol analysis on the active exchange.

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

Preview a spot market order without placing it.

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

Place a live spot market order on the active exchange.

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

- `alpaca` [broker] supports 1 capability binding(s)
- `etrade` [broker] supports 1 capability binding(s)
- `ibkr` [broker] supports 1 capability binding(s)
- `schwab` [broker] supports 1 capability binding(s)
- `tastytrade` [broker] supports 1 capability binding(s)
- `tradestation` [broker] supports 1 capability binding(s)
- `tradier` [broker] supports 1 capability binding(s)
- `trading212` [broker] supports 1 capability binding(s)
- `webull` [broker] supports 1 capability binding(s)
- `binance` [exchange] supports 6 capability binding(s)
- `binance_us` [exchange] supports 6 capability binding(s)
- `bitfinex` [exchange] supports 6 capability binding(s)
- `coinbase` [exchange] supports 6 capability binding(s)
- `hyperliquid` [exchange] supports 6 capability binding(s)
- `kraken` [exchange] supports 6 capability binding(s)
- `robinhood` [exchange] supports 6 capability binding(s)
- `uniswap` [exchange] supports 6 capability binding(s)
