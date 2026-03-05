import type { BrokerCapabilities, BrokerCredentials } from "../types.ts";
import { RestBrokerAdapter, type RestBrokerAdapterConfig } from "./rest-base.ts";

const SCHWAB_CAPABILITIES: BrokerCapabilities = {
  supportsMarketOrders: true,
  supportsLimitOrders: true,
  supportsExtendedHours: true,
  supportsFractionalShares: false,
  supportsShortSelling: true,
  supportsOptions: true,
  supportsStreaming: false,
  supportsPaperTrading: true,
};

const SCHWAB_CONFIG: RestBrokerAdapterConfig = {
  brokerId: "schwab",
  displayName: "Schwab",
  capabilities: SCHWAB_CAPABILITIES,
  authStyle: "bearer",
  defaultLiveBaseUrl: "https://api.schwabapi.com",
  defaultPaperBaseUrl: "https://api.schwabapi.com",
  accountDiscoveryPaths: [
    "/trader/v1/accounts/accountNumbers",
  ],
  clockPaths: [
    "/marketdata/v1/markets?markets=equity",
    "/marketdata/v1/hours?markets=equity",
  ],
  accountPaths: [
    "/trader/v1/accounts/{accountId}?fields=positions",
  ],
  positionsPaths: [
    "/trader/v1/accounts/{accountId}?fields=positions",
  ],
  openOrdersPaths: [
    "/trader/v1/accounts/{accountId}/orders?maxResults={limit}&status=OPEN",
  ],
  listOrdersPaths: [
    "/trader/v1/accounts/{accountId}/orders?maxResults={limit}&status={status}",
    "/trader/v1/accounts/{accountId}/orders?maxResults={limit}",
  ],
  getOrderPaths: [
    "/trader/v1/accounts/{accountId}/orders/{orderId}",
  ],
  placeOrderPaths: [
    "/trader/v1/accounts/{accountId}/orders",
  ],
  cancelOrderPaths: [
    "/trader/v1/accounts/{accountId}/orders/{orderId}",
  ],
  quotePaths: [
    "/marketdata/v1/quotes?symbols={symbol}",
  ],
  mapStatusParam: (status) => {
    if (status === "open") return "OPEN";
    if (status === "closed") return "FILLED";
    return "ALL";
  },
};

export class SchwabAdapter extends RestBrokerAdapter {
  constructor(credentials: BrokerCredentials) {
    super(credentials, SCHWAB_CONFIG);
  }
}

