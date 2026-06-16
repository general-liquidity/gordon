#!/usr/bin/env python3
"""
MT5 bridge sidecar — the only programmatic execution path for the Model to Market
competition (Syphonix exposes no REST API; trading is via MetaTrader 5).

Wraps the `MetaTrader5` Python package (Windows-only; talks to a locally-running
MT5 terminal) behind a small localhost JSON HTTP API that Gordon (Bun/TS) calls.
Stdlib only besides MetaTrader5 — no web framework.

Run:
    pip install -r requirements.txt
    set MT5_LOGIN=...      &  set MT5_PASSWORD=...  &  set MT5_SERVER=...
    set MT5_BRIDGE_TOKEN=<shared-secret>           (optional but recommended)
    set MT5_BRIDGE_ALLOW_TRADING=1                 (required to actually send orders)
    python mt5_bridge.py

Safety: binds to 127.0.0.1 only. Order/cancel/close endpoints run a validation
(order_check) and REFUSE to execute unless MT5_BRIDGE_ALLOW_TRADING=1 — so a
misconfigured run can read state and price-check orders but cannot fire them.
"""

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import MetaTrader5 as mt5

HOST = "127.0.0.1"
PORT = int(os.environ.get("MT5_BRIDGE_PORT", "8788"))
TOKEN = os.environ.get("MT5_BRIDGE_TOKEN", "")
ALLOW_TRADING = os.environ.get("MT5_BRIDGE_ALLOW_TRADING", "") == "1"

_TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
}


class BridgeError(Exception):
    """Carries an HTTP status alongside the message."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _last_error():
    code, desc = mt5.last_error()
    return f"mt5 error {code}: {desc}"


def connect():
    """Initialize + log into the MT5 terminal from env. Idempotent enough to call once."""
    path = os.environ.get("MT5_TERMINAL_PATH")
    ok = mt5.initialize(path) if path else mt5.initialize()
    if not ok:
        raise BridgeError(f"initialize() failed — {_last_error()}", 503)
    login = os.environ.get("MT5_LOGIN")
    if login:
        authorized = mt5.login(
            int(login),
            password=os.environ.get("MT5_PASSWORD", ""),
            server=os.environ.get("MT5_SERVER", ""),
        )
        if not authorized:
            raise BridgeError(f"login() failed for {login} — {_last_error()}", 401)


# ---------------------------------------------------------------------------
# Domain reads
# ---------------------------------------------------------------------------

def account():
    info = mt5.account_info()
    if info is None:
        raise BridgeError(f"account_info() returned None — {_last_error()}", 503)
    return info._asdict()


def positions():
    rows = mt5.positions_get()
    if rows is None:
        return []
    out = []
    for p in rows:
        d = p._asdict()
        d["sideLabel"] = "long" if d.get("type") == mt5.POSITION_TYPE_BUY else "short"
        out.append(d)
    return out


def orders():
    rows = mt5.orders_get()
    return [o._asdict() for o in rows] if rows else []


def symbol_one(symbol):
    info = mt5.symbol_info(symbol)
    if info is None:
        raise BridgeError(f"unknown symbol '{symbol}' — {_last_error()}", 404)
    return info._asdict()


def symbols(group):
    rows = mt5.symbols_get(group) if group else mt5.symbols_get()
    if rows is None:
        return []
    # Keep the catalog payload lean — the specs Gordon's sizing actually needs.
    keep = ("name", "description", "currency_base", "currency_profit", "digits",
            "point", "trade_contract_size", "volume_min", "volume_max",
            "volume_step", "trade_tick_size", "trade_tick_value")
    return [{k: getattr(s, k, None) for k in keep} for s in rows]


def quote(symbol):
    if not mt5.symbol_select(symbol, True):
        raise BridgeError(f"symbol_select('{symbol}') failed — {_last_error()}", 404)
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise BridgeError(f"no tick for '{symbol}' — {_last_error()}", 503)
    d = tick._asdict()
    d["symbol"] = symbol
    return d


def depth(symbol):
    if not mt5.market_book_add(symbol):
        raise BridgeError(f"market_book_add('{symbol}') failed — {_last_error()}", 503)
    try:
        book = mt5.market_book_get(symbol)
    finally:
        mt5.market_book_release(symbol)
    bids, asks = [], []
    for e in book or []:
        level = {"price": e.price, "volume": e.volume}
        # BOOK_TYPE_SELL(1)/SELL_MARKET(3) = ask side; BUY(2)/BUY_MARKET(4) = bid side.
        if e.type in (mt5.BOOK_TYPE_BUY, mt5.BOOK_TYPE_BUY_MARKET):
            bids.append(level)
        else:
            asks.append(level)
    bids.sort(key=lambda x: x["price"], reverse=True)
    asks.sort(key=lambda x: x["price"])
    return {"symbol": symbol, "bids": bids, "asks": asks}


def bars(symbol, timeframe, count, frm, to):
    tf = _TIMEFRAMES.get(timeframe.upper())
    if tf is None:
        raise BridgeError(f"unknown timeframe '{timeframe}'", 400)
    if frm and to:
        rates = mt5.copy_rates_range(symbol, tf, datetime.fromtimestamp(frm, timezone.utc),
                                     datetime.fromtimestamp(to, timezone.utc))
    else:
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, int(count or 500))
    if rates is None:
        raise BridgeError(f"no bars for '{symbol}' — {_last_error()}", 503)
    return [
        {"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
         "low": float(r["low"]), "close": float(r["close"]),
         "tickVolume": int(r["tick_volume"]), "spread": int(r["spread"]),
         "realVolume": int(r["real_volume"])}
        for r in rates
    ]


# ---------------------------------------------------------------------------
# Trading (guarded)
# ---------------------------------------------------------------------------

def _filling_mode(name):
    return {"ioc": mt5.ORDER_FILLING_IOC, "fok": mt5.ORDER_FILLING_FOK,
            "return": mt5.ORDER_FILLING_RETURN}.get((name or "ioc").lower(), mt5.ORDER_FILLING_IOC)


def _build_order_request(body):
    symbol = body["symbol"]
    side = body["side"]  # buy | sell
    otype = body.get("type", "market")  # market | limit
    volume = float(body["volume"])
    if not mt5.symbol_select(symbol, True):
        raise BridgeError(f"symbol_select('{symbol}') failed — {_last_error()}", 404)
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise BridgeError(f"no tick for '{symbol}' — {_last_error()}", 503)

    req = {
        "symbol": symbol,
        "volume": volume,
        "deviation": int(body.get("deviation", 20)),
        "magic": int(body.get("magic", 0)),
        "comment": str(body.get("clientOrderId") or body.get("comment") or "gordon"),
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _filling_mode(body.get("filling")),
    }
    if otype == "market":
        req["action"] = mt5.TRADE_ACTION_DEAL
        req["type"] = mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL
        req["price"] = tick.ask if side == "buy" else tick.bid
    elif otype == "limit":
        if "price" not in body:
            raise BridgeError("limit order requires 'price'", 400)
        req["action"] = mt5.TRADE_ACTION_PENDING
        req["type"] = mt5.ORDER_TYPE_BUY_LIMIT if side == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
        req["price"] = float(body["price"])
    else:
        raise BridgeError(f"unsupported order type '{otype}'", 400)
    if body.get("sl") is not None:
        req["sl"] = float(body["sl"])
    if body.get("tp") is not None:
        req["tp"] = float(body["tp"])
    return req


def place_order(body):
    req = _build_order_request(body)
    check = mt5.order_check(req)
    check_d = check._asdict() if check is not None else {"retcode": -1, "comment": _last_error()}
    if not ALLOW_TRADING:
        return {"executed": False, "guard": "trading-disabled",
                "hint": "set MT5_BRIDGE_ALLOW_TRADING=1 to send", "check": check_d}
    result = mt5.order_send(req)
    if result is None:
        raise BridgeError(f"order_send returned None — {_last_error()}", 502)
    rd = result._asdict()
    rd["executed"] = rd.get("retcode") == mt5.TRADE_RETCODE_DONE
    return rd


def cancel_order(body):
    ticket = int(body["ticket"])
    req = {"action": mt5.TRADE_ACTION_REMOVE, "order": ticket}
    if not ALLOW_TRADING:
        return {"executed": False, "guard": "trading-disabled"}
    result = mt5.order_send(req)
    if result is None:
        raise BridgeError(f"cancel returned None — {_last_error()}", 502)
    rd = result._asdict()
    rd["executed"] = rd.get("retcode") == mt5.TRADE_RETCODE_DONE
    return rd


def close_position(body):
    ticket = int(body["ticket"])
    poss = mt5.positions_get(ticket=ticket)
    if not poss:
        raise BridgeError(f"position {ticket} not found", 404)
    p = poss[0]
    tick = mt5.symbol_info_tick(p.symbol)
    is_buy = p.type == mt5.POSITION_TYPE_BUY
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "position": ticket,
        "symbol": p.symbol,
        "volume": float(body.get("volume", p.volume)),
        "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        "price": tick.bid if is_buy else tick.ask,
        "deviation": int(body.get("deviation", 20)),
        "magic": int(body.get("magic", 0)),
        "comment": "gordon-close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _filling_mode(body.get("filling")),
    }
    if not ALLOW_TRADING:
        return {"executed": False, "guard": "trading-disabled"}
    result = mt5.order_send(req)
    if result is None:
        raise BridgeError(f"close returned None — {_last_error()}", 502)
    rd = result._asdict()
    rd["executed"] = rd.get("retcode") == mt5.TRADE_RETCODE_DONE
    return rd


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):  # quiet
        pass

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        return not TOKEN or self.headers.get("X-Bridge-Token") == TOKEN

    def _qs(self):
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def _route(self, method):
        path = urlparse(self.path).path
        q = self._qs()
        if path == "/health":
            try:
                connect()
                return {"ok": True, "tradingEnabled": ALLOW_TRADING, "account": account()}
            except BridgeError as e:
                return {"ok": False, "tradingEnabled": ALLOW_TRADING, "error": str(e)}
        if method == "GET":
            if path == "/account":
                return account()
            if path == "/positions":
                return {"positions": positions()}
            if path == "/orders":
                return {"orders": orders()}
            if path == "/symbols":
                return {"symbols": symbols(q.get("group"))}
            if path == "/symbol":
                return symbol_one(q["symbol"])
            if path == "/quote":
                return quote(q["symbol"])
            if path == "/depth":
                return depth(q["symbol"])
            if path == "/bars":
                return {"bars": bars(q["symbol"], q.get("timeframe", "M15"),
                                     q.get("count"),
                                     int(q["from"]) if "from" in q else None,
                                     int(q["to"]) if "to" in q else None)}
        if method == "POST":
            body = self._read_body()
            if path == "/order":
                return place_order(body)
            if path == "/cancel":
                return cancel_order(body)
            if path == "/close":
                return close_position(body)
        raise BridgeError(f"no route for {method} {path}", 404)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def _handle(self, method):
        if not self._authed():
            return self._send(401, {"error": "bad or missing X-Bridge-Token"})
        try:
            self._send(200, self._route(method))
        except BridgeError as e:
            self._send(e.status, {"error": str(e)})
        except KeyError as e:
            self._send(400, {"error": f"missing parameter {e}"})
        except Exception as e:  # boundary — never leak a stack to the wire
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def main():
    connect()
    acct = account()
    print(f"MT5 bridge on http://{HOST}:{PORT} — account {acct.get('login')} @ "
          f"{acct.get('server')} ({acct.get('currency')}), trading="
          f"{'ENABLED' if ALLOW_TRADING else 'disabled (read/validate only)'}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
