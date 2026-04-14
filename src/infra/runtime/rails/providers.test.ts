import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";

import type { PaymentProviderConfig, WalletProviderConfig } from "../../../types/index.ts";
import { MoonPayProvider } from "./providers/moonpay.ts";
import { PolygonX402Provider } from "./providers/polygon.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  MOONPAY_API_KEY: process.env.MOONPAY_API_KEY,
  MOONPAY_SECRET_KEY: process.env.MOONPAY_SECRET_KEY,
  MOONPAY_WEBHOOK_API_KEY: process.env.MOONPAY_WEBHOOK_API_KEY,
  MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY: process.env.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY,
};

beforeEach(() => {
  process.env.MOONPAY_API_KEY = "moonpay-test-public";
  process.env.MOONPAY_SECRET_KEY = "moonpay-test-secret";
  process.env.MOONPAY_WEBHOOK_API_KEY = "moonpay-webhook-secret";
  delete process.env.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("MoonPayProvider", () => {
  const config: WalletProviderConfig = {
    id: "moonpay-main",
    type: "moonpay",
    authMode: "native",
    enabled: true,
    isDefault: true,
    walletAddress: "0xwallet",
    externalCustomerId: "customer-ext-1",
  };

  test("builds signed funding links when sensitive parameters are present", () => {
    const provider = new MoonPayProvider(config);
    const link = provider.buildOnRampLink({
      baseCurrencyCode: "usd",
      quoteCurrencyCode: "sol",
      lockAmount: 50,
      email: "trader@example.com",
    });

    expect(link.provider).toBe("moonpay");
    expect(link.mode).toBe("buy");
    expect(link.url).toContain("buy.moonpay.com");
    expect(link.query.quoteCurrencyCode).toBe("sol");
    expect(link.signed).toBe(true);
    expect(link.signature).toBeTruthy();
    expect(link.query.signature).toBeTruthy();
  });

  test("uses public MoonPay API for buy quotes", async () => {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v3/currencies/sol/buy_quote");
      expect(url.searchParams.get("apiKey")).toBe("moonpay-test-public");
      expect(url.searchParams.get("baseCurrencyAmount")).toBe("100");
      return new Response(JSON.stringify({ quoteCurrencyAmount: 0.5, totalAmount: 101.2 }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const provider = new MoonPayProvider(config);
    const quote = await provider.getQuote({
      mode: "buy",
      currencyCode: "sol",
      baseCurrencyAmount: 100,
      baseCurrencyCode: "usd",
    });

    expect(quote.provider).toBe("moonpay");
    expect(quote.mode).toBe("buy");
    expect(quote.raw.quoteCurrencyAmount).toBe(0.5);
  });

  test("uses authenticated MoonPay API for transaction history", async () => {
    globalThis.fetch = (async (_input, init) => {
      expect(init?.headers).toBeTruthy();
      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get("Authorization")).toBe("moonpay-test-secret");
      return new Response(JSON.stringify({
        transactions: [
          {
            id: "txn_1",
            status: "completed",
            baseCurrencyCode: "usd",
            quoteCurrencyCode: "btc",
          },
        ],
      }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const provider = new MoonPayProvider(config);
    const transactions = await provider.getTransactions({
      mode: "buy",
      customerId: "customer-1",
      limit: 5,
    });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.id).toBe("txn_1");
    expect(transactions[0]?.mode).toBe("buy");
  });

  test("signs MoonPay virtual account requests with RSA headers", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    process.env.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get("x-signature")).toBeTruthy();
      return new Response(JSON.stringify({
        virtualAccounts: [{ id: "va_1", status: "completed", externalCustomerId: "customer-ext-1" }],
      }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const provider = new MoonPayProvider(config);
    const accounts = await provider.getVirtualAccounts({ externalCustomerId: "customer-ext-1" });

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe("va_1");
  });

  test("verifies MoonPay webhook signatures using v2 format", () => {
    const provider = new MoonPayProvider(config);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ id: "txn_1", status: "completed" });
    const signature = createHmac("sha256", "moonpay-webhook-secret")
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const result = provider.verifyWebhookSignature({
      signatureHeader: `t=${timestamp},s=${signature}`,
      payload,
      method: "POST",
    });

    expect(result.valid).toBe(true);
    expect(result.receivedSignature).toBe(signature);
  });
});

describe("PolygonX402Provider", () => {
  test("creates unsigned payment headers without a private key", async () => {
    const config: PaymentProviderConfig = {
      id: "polygon-main",
      type: "polygon",
      authMode: "native",
      enabled: true,
      isDefault: true,
      network: "polygon",
      recipient: "0xrecipient",
    };

    const provider = new PolygonX402Provider(config);
    const intent = await provider.createPaymentIntent({
      resource: "https://api.example.com/premium",
      amountUsd: "0.10",
    });
    const headers = provider.buildPaymentHeaders(intent);

    expect(intent.provider).toBe("polygon");
    expect(headers.headers["x-gordon-payment-resource"]).toBe("https://api.example.com/premium");
    expect(headers.headers["x-gordon-payment-recipient"]).toBe("0xrecipient");
  });
});
