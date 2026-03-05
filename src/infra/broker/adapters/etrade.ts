import type { BrokerCapabilities, BrokerCredentials } from "../types.ts";
import { RestBrokerAdapter, type RestBrokerAdapterConfig } from "./rest-base.ts";

const ETRADE_CAPABILITIES: BrokerCapabilities = {
  supportsMarketOrders: true,
  supportsLimitOrders: true,
  supportsExtendedHours: true,
  supportsFractionalShares: false,
  supportsShortSelling: true,
  supportsOptions: true,
  supportsStreaming: false,
  supportsPaperTrading: true,
};

const ETRADE_CONFIG: RestBrokerAdapterConfig = {
  brokerId: "etrade",
  displayName: "E*TRADE",
  capabilities: ETRADE_CAPABILITIES,
  authStyle: "basic",
  defaultLiveBaseUrl: "https://api.etrade.com",
  defaultPaperBaseUrl: "https://apisb.etrade.com",
  accountDiscoveryPaths: [
    "/v1/accounts/list",
  ],
  clockPaths: [
    "/v1/market/clock",
  ],
  accountPaths: [
    "/v1/accounts/{accountId}/balance",
  ],
  positionsPaths: [
    "/v1/accounts/{accountId}/portfolio",
  ],
  openOrdersPaths: [
    "/v1/accounts/{accountId}/orders?status=OPEN&count={limit}",
  ],
  listOrdersPaths: [
    "/v1/accounts/{accountId}/orders?status={status}&count={limit}",
    "/v1/accounts/{accountId}/orders?count={limit}",
  ],
  getOrderPaths: [
    "/v1/accounts/{accountId}/orders/{orderId}",
  ],
  placeOrderPaths: [
    "/v1/accounts/{accountId}/orders/place",
    "/v1/accounts/{accountId}/orders",
  ],
  cancelOrderPaths: [
    "/v1/accounts/{accountId}/orders/{orderId}",
  ],
  quotePaths: [
    "/v1/market/quote/{symbol}",
  ],
  mapStatusParam: (status) => {
    if (status === "open") return "OPEN";
    if (status === "closed") return "EXECUTED";
    return "ALL";
  },
};

export class EtradeAdapter extends RestBrokerAdapter {
  constructor(credentials: BrokerCredentials) {
    super(credentials, ETRADE_CONFIG);
  }
}

