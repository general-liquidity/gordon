/**
 * Binance market-stream client (websocket only).
 * Signed REST/SAPI lives in the CCXT adapter.
 */

export {
  BinanceWebSocket,
  createBinanceWebSocket,
  DEFAULT_WS_CONFIG,
  type WSConfig,
  type ConnectionState,
  type ConnectionStatus,
  type WSEventMap,
  type TickerUpdate,
  type TradeUpdate,
  type KlineUpdate,
  type DepthUpdate,
} from "./websocket.ts";