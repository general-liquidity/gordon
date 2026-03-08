import type { BrokerCapabilities, BrokerCredentials } from "../types.ts";
import { RestBrokerAdapter, type RestBrokerAdapterConfig } from "./rest-base.ts";

const TRADIER_CAPABILITIES: BrokerCapabilities = {
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

const TRADIER_CONFIG: RestBrokerAdapterConfig = {
  brokerId: "tradier",
  displayName: "Tradier",
  capabilities: TRADIER_CAPABILITIES,
  authStyle: "bearer",
  defaultLiveBaseUrl: "https://api.tradier.com",
  defaultPaperBaseUrl: "https://sandbox.tradier.com",
  accountDiscoveryPaths: [
    "/v1/user/profile",
  ],
  clockPaths: [
    "/v1/markets/clock",
  ],
  accountPaths: [
    "/v1/accounts/{accountId}/balances",
  ],
  positionsPaths: [
    "/v1/accounts/{accountId}/positions",
  ],
  openOrdersPaths: [
    "/v1/accounts/{accountId}/orders?status=open&limit={limit}",
  ],
  listOrdersPaths: [
    "/v1/accounts/{accountId}/orders?status={status}&limit={limit}",
  ],
  getOrderPaths: [
    "/v1/accounts/{accountId}/orders/{orderId}",
    "/v1/accounts/{accountId}/orders?id={orderId}",
  ],
  placeOrderPaths: [
    "/v1/accounts/{accountId}/orders",
  ],
  cancelOrderPaths: [
    "/v1/accounts/{accountId}/orders/{orderId}",
  ],
  quotePaths: [
    "/v1/markets/quotes?symbols={symbol}",
  ],
  mapStatusParam: (status) => status,
  buildPlaceOrderBody: ({ params }) => {
    const form = new URLSearchParams();
    form.set("class", "equity");
    form.set("symbol", params.symbol.toUpperCase());
    form.set("side", params.side);
    form.set("type", params.type);
    form.set("duration", params.timeInForce);
    if (params.qty !== undefined) form.set("quantity", String(params.qty));
    if (params.limitPrice !== undefined) form.set("price", String(params.limitPrice));
    if (params.stopPrice !== undefined) form.set("stop", String(params.stopPrice));
    if (params.clientOrderId) form.set("tag", params.clientOrderId);
    return {
      body: form.toString(),
      contentType: "application/x-www-form-urlencoded",
    };
  },
};

export class TradierAdapter extends RestBrokerAdapter {
  constructor(credentials: BrokerCredentials) {
    super(credentials, TRADIER_CONFIG);
  }
}
