/**
 * MT5 broker adapter — the Model to Market competition execution path.
 *
 * Implements Gordon's `BrokerAdapter` over the MT5 bridge sidecar
 * (`scripts/mt5-bridge/mt5_bridge.py`) via `Mt5BridgeClient`. Syphonix exposes no
 * REST API; trading is via MetaTrader 5, so the venue's account/positions/orders
 * map cleanly onto the broker contract.
 *
 * `BrokerCredentials` here describe the BRIDGE, not the MT5 account (those live in
 * the sidecar's env): `baseUrl` = bridge URL, `apiKey` = bridge token. Quantities
 * are MT5 **lots** (per the symbol's volume_step), passed through `qty`.
 */

import type { Candle } from "../../../types/index.ts";
import { isKillSwitchesEnabled, isExecutionAllowed } from "../../safety/killSwitches.ts";
import { Mt5BridgeClient, type Mt5OrderResult } from "../mt5/bridgeClient.ts";
import type {
  BrokerAccount,
  BrokerAdapter,
  BrokerCapabilities,
  BrokerClock,
  BrokerCredentials,
  BrokerHistoricalBarsParams,
  BrokerId,
  BrokerOrder,
  BrokerOrderListParams,
  BrokerOrderRequest,
  BrokerOrderSide,
  BrokerPosition,
  BrokerQuote,
} from "../types.ts";

/** Map common timeframe spellings onto the bridge's MT5 timeframe codes. */
const TIMEFRAME_MAP: Record<string, string> = {
  "1m": "M1", "5m": "M5", "15m": "M15", "30m": "M30",
  "1h": "H1", "4h": "H4", "1d": "D1", "1w": "W1",
};
const toMt5Timeframe = (tf: string): string => TIMEFRAME_MAP[tf.toLowerCase()] ?? tf.toUpperCase();

export class Mt5Adapter implements BrokerAdapter {
  readonly brokerId: BrokerId = "mt5";
  readonly displayName = "MetaTrader 5";
  readonly isPaper: boolean;
  readonly capabilities: BrokerCapabilities = {
    supportsMarketOrders: true,
    supportsLimitOrders: true,
    supportsExtendedHours: false, // FX/metals/crypto — session concept N/A
    supportsFractionalShares: true, // lots are fractional
    supportsShortSelling: true,
    supportsOptions: false,
    supportsStreaming: false, // polled via the bridge
    supportsPaperTrading: true,
    supportsHistoricalBars: true,
  };

  private readonly client: Mt5BridgeClient;

  constructor(credentials: BrokerCredentials) {
    this.isPaper = credentials.paper ?? true;
    this.client = new Mt5BridgeClient({
      baseUrl: credentials.baseUrl,
      token: credentials.apiKey || undefined,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      return (await this.client.health()).ok;
    } catch {
      return false;
    }
  }

  async getClock(): Promise<BrokerClock> {
    // FX/metals/crypto trade ~around the clock; MT5 has no session-clock endpoint.
    return { timestamp: new Date().toISOString(), isOpen: true, nextOpen: "", nextClose: "" };
  }

  async getAccount(): Promise<BrokerAccount> {
    const a = await this.client.account();
    return {
      id: String(a.login),
      status: "ACTIVE",
      currency: a.currency,
      cash: a.balance,
      buyingPower: a.margin_free,
      portfolioValue: a.equity,
      patternDayTrader: false,
      shortingEnabled: true,
      tradingBlocked: false,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const positions = await this.client.positions();
    return positions.map((p) => {
      const cost = p.volume * p.price_open;
      return {
        symbol: p.symbol,
        qty: p.volume,
        side: p.sideLabel,
        marketValue: p.volume * p.price_current,
        avgEntryPrice: p.price_open,
        unrealizedPl: p.profit,
        unrealizedPlPercent: cost > 0 ? (p.profit / cost) * 100 : 0,
      };
    });
  }

  async getOpenOrders(limit?: number): Promise<BrokerOrder[]> {
    const orders = await this.client.orders();
    const mapped = orders.map((o) => this.mapPendingOrder(o));
    return limit ? mapped.slice(0, limit) : mapped;
  }

  async listOrders(params?: BrokerOrderListParams): Promise<BrokerOrder[]> {
    // The bridge surfaces active (pending) orders; "closed" history isn't mapped here.
    if (params?.status === "closed") return [];
    return this.getOpenOrders(params?.limit);
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const order = (await this.client.orders()).find((o) => String(o.ticket) === orderId);
    if (!order) throw new Error(`MT5 order ${orderId} not found among active orders`);
    return this.mapPendingOrder(order);
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrder> {
    // Kill-switch chokepoint — read-only, idempotent. Mt5Adapter implements
    // BrokerAdapter directly (not RestBrokerAdapter), so it needs the same
    // adapter-level guard the REST adapters get.
    if (isKillSwitchesEnabled()) {
      const decision = isExecutionAllowed({ venue: this.brokerId, instrument: params.symbol });
      if (!decision.allowed) {
        throw new Error(`${decision.reason}. Reset the relevant kill switch before placing this order.`);
      }
    }
    if (params.qty === undefined) {
      throw new Error("MT5 orders require an explicit qty (lots); notional sizing is not supported");
    }
    if (params.type !== "market" && params.type !== "limit") {
      throw new Error(`MT5 adapter supports market and limit orders only (got '${params.type}')`);
    }
    const result = await this.client.placeOrder({
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      volume: params.qty,
      price: params.limitPrice,
      clientOrderId: params.clientOrderId,
    });
    return this.mapOrderResult(params, result);
  }

  async cancelOrder(orderId: string): Promise<void> {
    const res = await this.client.cancel(Number(orderId));
    if (!res.executed && res.guard) {
      throw new Error(`MT5 cancel blocked: sidecar trading guard active (${res.guard})`);
    }
  }

  async cancelAllOrders(): Promise<void> {
    const orders = await this.client.orders();
    for (const o of orders) await this.cancelOrder(String(o.ticket));
  }

  async getLatestQuote(symbol: string): Promise<BrokerQuote> {
    const q = await this.client.quote(symbol);
    return {
      symbol,
      bidPrice: q.bid,
      bidSize: 0,
      askPrice: q.ask,
      askSize: 0,
      timestamp: new Date(q.time * 1000).toISOString(),
    };
  }

  async getHistoricalBars(params: BrokerHistoricalBarsParams): Promise<Candle[]> {
    const bars = await this.client.bars({
      symbol: params.symbol,
      timeframe: toMt5Timeframe(params.timeframe),
      from: Math.floor(params.startTime / 1000),
      to: Math.floor(params.endTime / 1000),
      count: params.limit,
    });
    return bars.map((b) => ({
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.tickVolume,
      openTime: b.time * 1000,
      closeTime: b.time * 1000,
    }));
  }

  // --- mapping helpers ---

  private mapOrderResult(req: BrokerOrderRequest, result: Mt5OrderResult): BrokerOrder {
    if (!result.executed) {
      const why = result.guard
        ? `sidecar trading guard active (${result.guard}) — set MT5_BRIDGE_ALLOW_TRADING=1`
        : `retcode ${result.retcode ?? "?"}: ${result.comment ?? "rejected"}`;
      throw new Error(`MT5 order not placed: ${why}`);
    }
    const filled = req.type === "market";
    return {
      id: String(result.order ?? result.deal ?? ""),
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      timeInForce: req.timeInForce ?? "gtc",
      status: filled ? "filled" : "new",
      qty: req.qty ?? result.volume ?? 0,
      filledQty: filled ? (req.qty ?? result.volume ?? 0) : 0,
      limitPrice: req.limitPrice,
      extendedHours: false,
      submittedAt: new Date().toISOString(),
    };
  }

  private mapPendingOrder(o: { ticket: number; symbol: string; type: number; volume_current: number; price_open: number }): BrokerOrder {
    // MT5 ORDER_TYPE: even (0,2,4,6) = buy side, odd (1,3,5,7) = sell side.
    const side: BrokerOrderSide = o.type % 2 === 0 ? "buy" : "sell";
    return {
      id: String(o.ticket),
      symbol: o.symbol,
      side,
      type: "limit",
      timeInForce: "gtc",
      status: "new",
      qty: o.volume_current,
      filledQty: 0,
      limitPrice: o.price_open,
      extendedHours: false,
    };
  }
}
