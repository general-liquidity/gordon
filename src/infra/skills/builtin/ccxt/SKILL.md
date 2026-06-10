---
name: ccxt
description: Use CCXT-routed exchange adapters when the operator picks a `ccxt:<sub-id>` exchange or asks about CCXT-specific capabilities — derivatives (funding rates, positions, leverage, margin mode), margin trading (borrow/repay), inter-account transfers, batch order ops, or any of the 90+ exchanges CCXT covers. Use when symbols are passed as `BTC/USDT` (CCXT format), when the operator mentions Bybit / KuCoin / MEXC / Crypto.com / HTX / Gate / Bitget / BingX or any CCXT venue, or when the operator wants the same unified API across multiple exchanges.
license: MIT
compatibility: Requires `ccxt` npm package (v4.5+) and operator-configured `CCXT_<EXCHANGE_UPPER>_API_KEY` / `_API_SECRET` env vars.
metadata:
  author: Gordon
  version: "1.1"
  upstream: https://docs.ccxt.com/
status: active
last-reviewed: 2026-06-10
---

# CCXT Skill

Gordon routes every crypto exchange through `ccxt:<sub-id>` and the `CcxtAdapter`. First-class venues (binance, coinbase, kraken, okx, …) and the long-tail (bybit, kucoin, mexc, …) all use the same adapter.

## When to use

- Operator picked any crypto exchange (all are `ccxt:<sub-id>`)
- Need derivatives surface: funding rates, positions, leverage configuration, margin-mode switch
- Need margin trading: borrow/repay/add-margin
- Need inter-account transfers (spot ↔ futures, main ↔ subaccount)
- Need batch order placement or editing
- Working with a symbol in `BASE/QUOTE` format (CCXT canonical)

## Prerequisites

- `ccxt` npm package installed (already in Gordon's `package.json`)
- Per-exchange API credentials in env: `CCXT_<UPPER_SUBID>_API_KEY` / `_API_SECRET` / `_PASSPHRASE` (where required) / `_WALLET_PRIVATE_KEY` (for DEX)
- The operator may have already added the exchange via `/exchange setup ccxt:<sub-id>`

## How to call

The `CcxtAdapter` class implements everything:

Base `Exchange` interface (32 methods): `getPrice`, `getCandles`, `getOrderBook`, `placeOrder`, `cancelOrder`, `getAccountInfo`, etc. Returns Gordon-shaped types.

`ExchangeDerivatives` (perps/futures):
- `fetchFundingRate(symbol)` — current funding rate
- `fetchFundingRates(symbols?)` — batch
- `fetchFundingHistory(symbol, since?, limit?)` — accrual history
- `setLeverage(leverage, symbol)`
- `setMarginMode("isolated"|"cross", symbol)`
- `fetchPosition(symbol)` — null if no open position
- `fetchPositions(symbols?)` — all open positions
- `closePosition(symbol)` — atomic close (falls back to opposite-side market order if the exchange lacks closePosition)

`ExchangeMargin`:
- `addMargin(symbol, amount)`
- `borrowCrossMargin(currency, amount)`
- `borrowIsolatedMargin(symbol, currency, amount)`
- `repayMargin(currency, amount, symbol?)`

`ExchangeAccountManagement`:
- `fetchAccounts()` — list sub-accounts
- `transfer(currency, amount, fromAccount, toAccount)` — between wallet types or sub-accounts

`ExchangeOrderManagement`:
- `editOrder(orderId, params)` — modify without cancel+re-place
- `createOrders(orders[])` — batch placement (native or sequential fallback)
- `cancelOrders(orderIds[], symbol)`

Pagination beyond base interface:
- `fetchTradeHistoryPaginated(symbol, since?, limit?, until?)`
- `fetchOrderHistoryPaginated(symbol, since?, limit?, until?)`

Capability introspection (before calling derivatives/margin/etc.):
- `supports("fetchPositions")` — boolean, reads CCXT's `.has`
- `getFeatures()` — full `.features` object

## Quick reference

```typescript
const exchange = ExchangeFactory.create("ccxt:bybit", credentials);

// Spot
const price = await exchange.getPrice("BTCUSDT");  // "BTC/USDT" also accepted
const ob = await exchange.getOrderBook("BTCUSDT", 50);

// Derivatives
if ("fetchPosition" in exchange) {
  const ccxt = exchange as CcxtAdapter;
  if (ccxt.supports("fetchPositions")) {
    const positions = await ccxt.fetchPositions();
    for (const p of positions) {
      if (p.percentage < -5) {
        // Down >5% — consider reducing exposure
      }
    }
  }
}
```

## Pitfalls

1. Symbol format. CCXT canonical is `BTC/USDT` (slash). Gordon's `CcxtAdapter` accepts both `BTCUSDT` and `BTC/USDT` (auto-converts via quote-currency heuristic) but only for the common quotes (USDT, USDC, BTC, ETH, USD, EUR). Exotic quotes need explicit slash.

2. Sandbox is per-exchange. CCXT's `setSandboxMode(true)` works for ~30 exchanges; the others throw `NotSupported`. The adapter catches that silently and runs live. Check `adapter.isSandbox` to confirm.

3. Precision normalization is automatic. `placeOrder` auto-applies `amountToPrecision` / `priceToPrecision` before submission. Don't pre-round — let the adapter handle it.

4. `clientOrderId` is auto-generated. Every `placeOrder` call gets a `gordon-<16hex>` clientOrderId unless the caller passes `newClientOrderId`. This makes retries idempotent at the exchange — duplicate placements get deduped.

5. Not every CCXT exchange supports every method. Before calling derivatives/margin methods, check `adapter.supports("methodName")`. Calling an unsupported method throws `NotSupported`.

6. Implicit methods exist for exchange-specific endpoints CCXT hasn't unified (`exchange.publicGetXxx`, `exchange.privatePostYyy`). These bypass `CcxtAdapter`'s type safety; access via `(exchange as CcxtAdapter).client.publicGetXxx({...})`. Use only when the unified API doesn't expose what you need.

7. CCXT Pro WebSocket is bundled free (73/107 exchanges support it). Get the WebSocket via `await adapter.getWebSocket()`. Subscribes via `subscribeTicker(symbol, cb)` / `subscribeOrderBook(symbol, cb)`.

## Verification

Before recommending CCXT-routed paths, verify:
- The chosen `ccxt:<sub-id>` actually exists in CCXT's exchange list (the adapter throws on construction otherwise)
- The operator has the env vars configured (`CCXT_<UPPER>_API_KEY`, `_API_SECRET`)
- The method you want is in the exchange's `.has` (use `adapter.supports(method)`)
- Sandbox mode is actually engaged when expected (`adapter.isSandbox`)

## When NOT to use

- Equity broker operations (IB, Alpaca, Trading 212) — use broker tools, not CCXT
- Wallet operations on Hyperliquid / Uniswap — use chain-specific tools; CCXT's DEX support is thinner
- Robinhood Crypto — not CCXT-routed; use the dedicated Robinhood integration