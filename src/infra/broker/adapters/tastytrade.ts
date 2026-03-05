import type { BrokerCapabilities, BrokerCredentials } from "../types.ts";
import { RestBrokerAdapter, type RestBrokerAdapterConfig } from "./rest-base.ts";

const TASTYTRADE_CAPABILITIES: BrokerCapabilities = {
  supportsMarketOrders: true,
  supportsLimitOrders: true,
  supportsExtendedHours: false,
  supportsFractionalShares: false,
  supportsShortSelling: true,
  supportsOptions: true,
  supportsStreaming: true,
  supportsPaperTrading: true,
};

const TASTYTRADE_CONFIG: RestBrokerAdapterConfig = {
  brokerId: "tastytrade",
  displayName: "tastytrade",
  capabilities: TASTYTRADE_CAPABILITIES,
  authStyle: "bearer",
  defaultLiveBaseUrl: "https://api.tastyworks.com",
  defaultPaperBaseUrl: "https://api.cert.tastyworks.com",
  accountDiscoveryPaths: [
    "/customers/me/accounts",
    "/accounts",
  ],
  clockPaths: [
    "/market-sessions",
  ],
  accountPaths: [
    "/accounts/{accountId}/balances",
  ],
  positionsPaths: [
    "/accounts/{accountId}/positions",
  ],
  openOrdersPaths: [
    "/accounts/{accountId}/orders/live",
  ],
  listOrdersPaths: [
    "/accounts/{accountId}/orders?status={status}&per-page={limit}",
    "/accounts/{accountId}/orders",
  ],
  getOrderPaths: [
    "/accounts/{accountId}/orders/{orderId}",
  ],
  placeOrderPaths: [
    "/accounts/{accountId}/orders",
  ],
  cancelOrderPaths: [
    "/accounts/{accountId}/orders/{orderId}",
  ],
  quotePaths: [
    "/market-data/quotes/{symbol}",
    "/market-data/quotes?symbols={symbol}",
  ],
  mapStatusParam: (status) => {
    if (status === "open") return "Live";
    if (status === "closed") return "Filled";
    return "All";
  },
};

export class TastytradeAdapter extends RestBrokerAdapter {
  constructor(credentials: BrokerCredentials) {
    super(credentials, TASTYTRADE_CONFIG);
  }
}

