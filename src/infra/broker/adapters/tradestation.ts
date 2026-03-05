import type { BrokerCapabilities, BrokerCredentials } from "../types.ts";
import { RestBrokerAdapter, type RestBrokerAdapterConfig } from "./rest-base.ts";

const TRADESTATION_CAPABILITIES: BrokerCapabilities = {
  supportsMarketOrders: true,
  supportsLimitOrders: true,
  supportsExtendedHours: true,
  supportsFractionalShares: false,
  supportsShortSelling: true,
  supportsOptions: true,
  supportsStreaming: true,
  supportsPaperTrading: true,
};

const TRADESTATION_CONFIG: RestBrokerAdapterConfig = {
  brokerId: "tradestation",
  displayName: "TradeStation",
  capabilities: TRADESTATION_CAPABILITIES,
  authStyle: "bearer",
  defaultLiveBaseUrl: "https://api.tradestation.com",
  defaultPaperBaseUrl: "https://sim-api.tradestation.com",
  accountDiscoveryPaths: [
    "/v3/brokerage/accounts",
    "/v2/brokerage/accounts",
  ],
  clockPaths: [
    "/v3/marketdata/marketclock",
    "/v2/marketdata/marketclock",
  ],
  accountPaths: [
    "/v3/brokerage/accounts/{accountId}/balances",
    "/v2/brokerage/accounts/{accountId}/balances",
  ],
  positionsPaths: [
    "/v3/brokerage/accounts/{accountId}/positions",
    "/v2/brokerage/accounts/{accountId}/positions",
  ],
  openOrdersPaths: [
    "/v3/brokerage/accounts/{accountId}/orders?status=Open&limit={limit}",
    "/v2/brokerage/accounts/{accountId}/orders?status=Open&limit={limit}",
  ],
  listOrdersPaths: [
    "/v3/brokerage/accounts/{accountId}/orders?status={status}&limit={limit}",
    "/v2/brokerage/accounts/{accountId}/orders?status={status}&limit={limit}",
  ],
  getOrderPaths: [
    "/v3/brokerage/accounts/{accountId}/orders/{orderId}",
    "/v2/brokerage/accounts/{accountId}/orders/{orderId}",
  ],
  placeOrderPaths: [
    "/v3/orderexecution/orders",
    "/v2/orderexecution/orders",
  ],
  cancelOrderPaths: [
    "/v3/orderexecution/orders/{orderId}",
    "/v2/orderexecution/orders/{orderId}",
  ],
  quotePaths: [
    "/v3/marketdata/quotes/{symbol}",
    "/v2/data/quote/{symbol}",
  ],
  mapStatusParam: (status) => {
    if (status === "open") return "Open";
    if (status === "closed") return "Closed";
    return "All";
  },
};

export class TradeStationAdapter extends RestBrokerAdapter {
  constructor(credentials: BrokerCredentials) {
    super(credentials, TRADESTATION_CONFIG);
  }
}

