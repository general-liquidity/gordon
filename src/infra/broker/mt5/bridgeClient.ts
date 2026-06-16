/**
 * Mt5BridgeClient — Gordon's typed client for the MT5 bridge sidecar
 * (`scripts/mt5-bridge/mt5_bridge.py`). The sidecar is the only programmatic
 * execution path for the Model to Market competition (Syphonix has no REST API;
 * trading is via MetaTrader 5, whose Python package is Windows-only).
 *
 * Transport only — no business logic. The `BrokerAdapter` wrapper maps these
 * raw MT5 shapes onto Gordon's normalized broker domain.
 */

export interface Mt5BridgeOptions {
  /** Defaults to http://127.0.0.1:${MT5_BRIDGE_PORT|8788}. */
  baseUrl?: string;
  /** Shared secret sent as X-Bridge-Token; defaults to env MT5_BRIDGE_TOKEN. */
  token?: string;
  /** Per-request timeout (ms). Default 10_000. */
  timeoutMs?: number;
}

export interface Mt5Account {
  login: number;
  server?: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  margin_free: number;
  margin_level: number;
  profit: number;
  leverage: number;
}

export interface Mt5Position {
  ticket: number;
  symbol: string;
  /** MT5 POSITION_TYPE: 0 = buy/long, 1 = sell/short. */
  type: number;
  sideLabel: "long" | "short";
  volume: number;
  price_open: number;
  price_current: number;
  profit: number;
  sl: number;
  tp: number;
}

export interface Mt5Order {
  ticket: number;
  symbol: string;
  /** MT5 ORDER_TYPE enum (2 = buy limit, 3 = sell limit, …). */
  type: number;
  volume_current: number;
  price_open: number;
  sl: number;
  tp: number;
  /** MT5 ORDER_STATE enum. */
  state: number;
}

export interface Mt5Quote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  /** Tick time, epoch seconds. */
  time: number;
  /** False when bid/ask are 0 — the live feed isn't streaming (e.g. pre-competition). */
  live?: boolean;
}

export interface Mt5DepthLevel {
  price: number;
  volume: number;
}

export interface Mt5Depth {
  symbol: string;
  /** Highest-first. */
  bids: Mt5DepthLevel[];
  /** Lowest-first. */
  asks: Mt5DepthLevel[];
}

export interface Mt5Bar {
  /** Epoch seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number;
  realVolume: number;
}

export interface Mt5SymbolSpec {
  name: string;
  description: string | null;
  currency_base: string | null;
  currency_profit: string | null;
  digits: number;
  point: number;
  trade_contract_size: number;
  volume_min: number;
  volume_max: number;
  volume_step: number;
  trade_tick_size: number;
  trade_tick_value: number;
}

export interface Mt5OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  /** Lots (per the symbol's volume_step). */
  volume: number;
  /** Required for limit orders. */
  price?: number;
  sl?: number;
  tp?: number;
  deviation?: number;
  /** Round-trips into the MT5 order comment for idempotency/audit. */
  clientOrderId?: string;
  filling?: "ioc" | "fok" | "return";
}

export interface Mt5OrderResult {
  /** True only when the order actually filled/placed (retcode DONE). */
  executed: boolean;
  /** Present when the trading guard blocked execution ("trading-disabled"). */
  guard?: string;
  hint?: string;
  retcode?: number;
  order?: number;
  deal?: number;
  volume?: number;
  price?: number;
  comment?: string;
  /** order_check result when validating only. */
  check?: Record<string, unknown>;
}

export interface Mt5Health {
  ok: boolean;
  tradingEnabled: boolean;
  account?: Mt5Account;
  error?: string;
}

export class Mt5BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "Mt5BridgeError";
  }
}

export class Mt5BridgeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(opts: Mt5BridgeOptions = {}) {
    const port = process.env.MT5_BRIDGE_PORT ?? "8788";
    this.baseUrl = (opts.baseUrl ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
    this.token = opts.token ?? process.env.MT5_BRIDGE_TOKEN ?? "";
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers["X-Bridge-Token"] = this.token;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Mt5BridgeError(
        `MT5 bridge unreachable at ${this.baseUrl} — is mt5_bridge.py running? (${(err as Error).message})`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      throw new Mt5BridgeError(
        `MT5 bridge returned a non-JSON ${res.status} response: ${text.slice(0, 120)}`,
        res.status || 502,
      );
    }
    if (!res.ok) {
      const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new Mt5BridgeError(msg, res.status);
    }
    return json as T;
  }

  private qs(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined);
    return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
  }

  health(): Promise<Mt5Health> {
    return this.request<Mt5Health>("GET", "/health");
  }

  account(): Promise<Mt5Account> {
    return this.request<Mt5Account>("GET", "/account");
  }

  async positions(): Promise<Mt5Position[]> {
    return (await this.request<{ positions: Mt5Position[] }>("GET", "/positions")).positions;
  }

  async orders(): Promise<Mt5Order[]> {
    return (await this.request<{ orders: Mt5Order[] }>("GET", "/orders")).orders;
  }

  symbols(group?: string): Promise<{ symbols: Mt5SymbolSpec[] }> {
    return this.request("GET", `/symbols${this.qs({ group })}`);
  }

  symbol(name: string): Promise<Mt5SymbolSpec> {
    return this.request("GET", `/symbol${this.qs({ symbol: name })}`);
  }

  quote(symbol: string): Promise<Mt5Quote> {
    return this.request("GET", `/quote${this.qs({ symbol })}`);
  }

  depth(symbol: string): Promise<Mt5Depth> {
    return this.request("GET", `/depth${this.qs({ symbol })}`);
  }

  async bars(params: {
    symbol: string;
    timeframe?: string;
    count?: number;
    from?: number;
    to?: number;
  }): Promise<Mt5Bar[]> {
    const res = await this.request<{ bars: Mt5Bar[] }>(
      "GET",
      `/bars${this.qs({
        symbol: params.symbol,
        timeframe: params.timeframe,
        count: params.count,
        from: params.from,
        to: params.to,
      })}`,
    );
    return res.bars;
  }

  placeOrder(req: Mt5OrderRequest): Promise<Mt5OrderResult> {
    return this.request("POST", "/order", req);
  }

  cancel(ticket: number): Promise<Mt5OrderResult> {
    return this.request("POST", "/cancel", { ticket });
  }

  close(ticket: number, volume?: number): Promise<Mt5OrderResult> {
    return this.request("POST", "/close", { ticket, volume });
  }
}
