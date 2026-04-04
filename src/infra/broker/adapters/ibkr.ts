import type { BrokerCapabilities, BrokerCredentials } from "../types.ts";
import { RestBrokerAdapter, type RestBrokerAdapterConfig } from "./rest-base.ts";

const IBKR_CAPABILITIES: BrokerCapabilities = {
  supportsMarketOrders: true,
  supportsLimitOrders: true,
  supportsExtendedHours: true,
  supportsFractionalShares: false,
  supportsShortSelling: true,
  supportsOptions: true,
  supportsStreaming: true,
  supportsPaperTrading: true,
  supportsHistoricalBars: false,
};

const IBKR_DEFAULT_URL = "http://127.0.0.1:5000";

const IBKR_CONFIG: RestBrokerAdapterConfig = {
  brokerId: "ibkr",
  displayName: "Interactive Brokers",
  capabilities: IBKR_CAPABILITIES,
  authStyle: "none",
  defaultLiveBaseUrl: process.env.IBKR_GATEWAY_URL ?? IBKR_DEFAULT_URL,
  defaultPaperBaseUrl: process.env.IBKR_GATEWAY_URL ?? IBKR_DEFAULT_URL,
  accountDiscoveryPaths: [
    "/v1/api/iserver/accounts",
  ],
  clockPaths: [
    "/v1/api/iserver/auth/status",
  ],
  accountPaths: [
    "/v1/api/portfolio/{accountId}/summary",
  ],
  positionsPaths: [
    "/v1/api/portfolio/{accountId}/positions/0",
    "/v1/api/portfolio/{accountId}/positions",
  ],
  openOrdersPaths: [
    "/v1/api/iserver/account/orders",
  ],
  listOrdersPaths: [
    "/v1/api/iserver/account/orders",
  ],
  getOrderPaths: [
    "/v1/api/iserver/account/order/status/{orderId}",
    "/v1/api/iserver/account/orders",
  ],
  placeOrderPaths: [
    "/v1/api/iserver/account/{accountId}/orders",
  ],
  cancelOrderPaths: [
    "/v1/api/iserver/account/{accountId}/order/{orderId}",
  ],
  quotePaths: [
    "/v1/api/iserver/marketdata/snapshot?symbols={symbol}",
    "/v1/api/iserver/marketdata/snapshot?conids={symbol}",
  ],
  mapStatusParam: () => "open",
  buildPlaceOrderBody: ({ params, accountId }) => {
    const order: Record<string, unknown> = {
      acctId: accountId,
      ticker: params.symbol.toUpperCase(),
      side: params.side.toUpperCase(),
      orderType: params.type.toUpperCase(),
      tif: params.timeInForce.toUpperCase(),
      quantity: params.qty ?? 0,
      cOID: params.clientOrderId,
      outsideRTH: params.extendedHours ?? false,
    };

    if (params.limitPrice !== undefined) order.price = params.limitPrice;
    if (params.stopPrice !== undefined) order.auxPrice = params.stopPrice;

    return {
      body: JSON.stringify({ orders: [order] }),
      contentType: "application/json",
    };
  },
};

export class IbkrAdapter extends RestBrokerAdapter {
  constructor(credentials: BrokerCredentials) {
    super(credentials, IBKR_CONFIG);
  }
}
