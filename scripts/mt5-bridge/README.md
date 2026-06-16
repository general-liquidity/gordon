# MT5 Bridge Sidecar

The execution transport for the **Model to Market** competition. Syphonix exposes
no REST API — trading is via **MetaTrader 5**, whose `MetaTrader5` Python package
is **Windows-only** and talks to a locally-running MT5 terminal. This sidecar
wraps it behind a localhost JSON API that Gordon (Bun/TS) calls over HTTP.

```
Gordon (Bun/TS)  ──HTTP──►  mt5_bridge.py  ──IPC──►  MT5 terminal  ──►  Syphonix sim
   Mt5BridgeClient            this sidecar            (your account)
```

## Setup (Windows)

1. Install the **MetaTrader 5 terminal** and log into your competition account once (so it remembers the connection).
2. Python 3.8+ (the `MetaTrader5` package targets Windows Python):
   ```
   pip install -r requirements.txt
   ```
3. Configure via environment variables:

   | Var | Purpose |
   |---|---|
   | `MT5_LOGIN` | account number (optional if the terminal is already logged in) |
   | `MT5_PASSWORD` | account password |
   | `MT5_SERVER` | broker server name (e.g. the Syphonix MT5 server) |
   | `MT5_TERMINAL_PATH` | path to `terminal64.exe` (optional; auto-detected if running) |
   | `MT5_BRIDGE_PORT` | default `8788` |
   | `MT5_BRIDGE_TOKEN` | shared secret; if set, callers must send `X-Bridge-Token` |
   | `MT5_BRIDGE_ALLOW_TRADING` | **must be `1`** to actually send orders; otherwise order endpoints validate only |

4. Run it:
   ```
   python mt5_bridge.py
   ```

## Safety

- Binds to **`127.0.0.1` only** — not reachable off the machine.
- `/order`, `/cancel`, `/close` run `order_check` and **refuse to execute** unless `MT5_BRIDGE_ALLOW_TRADING=1`. A default run can read state and price-check orders but cannot fire them — deny-first, matching Gordon's permission philosophy.
- Never logs request bodies or credentials.

## Endpoints

| Method · Path | Returns |
|---|---|
| `GET /health` | `{ ok, tradingEnabled, account }` |
| `GET /account` | equity / balance / margin / free margin |
| `GET /positions` | open positions (with `sideLabel`) |
| `GET /orders` | active pending orders |
| `GET /symbols?group=*USD*` | instrument catalog + contract specs |
| `GET /symbol?symbol=XAUUSD` | one symbol's full spec |
| `GET /quote?symbol=XAUUSD` | bid / ask / last tick |
| `GET /depth?symbol=XAUUSD` | L2 order book (`bids[]`, `asks[]`) |
| `GET /bars?symbol=XAUUSD&timeframe=M15&count=1000` | OHLC bars (or `&from=&to=` epoch seconds) |
| `POST /order` | `{ symbol, side, type, volume, price?, sl?, tp?, clientOrderId? }` → send/validate |
| `POST /cancel` | `{ ticket }` → cancel a pending order |
| `POST /close` | `{ ticket, volume? }` → close a position |

## Smoke test

With the sidecar running, from the repo root:

```
bun run scripts/dev/mt5-smoke.ts
```

Reads account + a quote + L2 depth for a symbol (default `XAUUSD`); pass `--trade`
to also place and immediately cancel a tiny limit order far from the market (only
fires if the sidecar has `MT5_BRIDGE_ALLOW_TRADING=1`).
