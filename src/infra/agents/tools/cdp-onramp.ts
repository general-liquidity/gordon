/**
 * CDP Onramp Tools
 *
 * Headless fiat → crypto via Coinbase Onramp. Gordon cannot complete a
 * payment flow end-to-end in a CLI (Apple Pay / card auth needs a browser),
 * but it CAN:
 *   - Look up what assets/networks are supported in a given region
 *   - Get a real-time price quote for an intended purchase
 *   - Generate a session token + hosted URL that the user opens in a browser
 *     to complete the payment
 *   - Return the session URL so Gordon can print "open this link to fund"
 *
 * This unlocks flows like "`/fund 500 USDC on Base`" where Gordon sets up
 * the session and the user confirms in their browser.
 *
 * Endpoints live on api.developer.coinbase.com, not api.cdp.coinbase.com.
 * All calls require CDP_API_KEY_ID + CDP_API_KEY_SECRET.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { cdpRequest, isCdpConfigured, CDP_NOT_CONFIGURED_MSG } from "../../data/providers/cdpRest.ts";

// ============================================================================
// 1. get_onramp_config — supported countries & payment methods
// ============================================================================

export const getOnrampConfigTool = createTool({
  id: "get_onramp_config",
  description:
    "Fetch the list of countries Coinbase Onramp supports and which payment " +
    "methods are available per country (card, Apple Pay, Google Pay, ACH, " +
    "existing Coinbase balance). Zero args — returns the full config. Use " +
    "before attempting to create an onramp session for a user.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    configured: z.boolean(),
    countries: z
      .array(
        z.object({
          id: z.string(),
          subdivisions: z.array(z.string()).optional(),
          paymentMethods: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    if (!isCdpConfigured()) {
      return { configured: false, error: CDP_NOT_CONFIGURED_MSG };
    }
    const res = await cdpRequest<{
      countries?: Array<{
        id?: string;
        subdivisions?: string[];
        payment_methods?: Array<{ id?: string }>;
      }>;
    }>("/onramp/v1/buy/config", { host: "onramp" });
    if (!res.ok || !res.data) {
      return { configured: true, error: res.error };
    }
    return {
      configured: true,
      countries: (res.data.countries ?? []).map((c) => ({
        id: c.id ?? "",
        subdivisions: c.subdivisions ?? [],
        paymentMethods: (c.payment_methods ?? []).map((m) => m.id ?? ""),
      })),
    };
  },
});

// ============================================================================
// 2. get_onramp_options — supported assets for a location
// ============================================================================

export const getOnrampOptionsTool = createTool({
  id: "get_onramp_options",
  description:
    "Fetch the list of cryptocurrencies and networks supported by Coinbase " +
    "Onramp for a specific country (and optional US state). Use after " +
    "get_onramp_config to see what a user can actually buy from their location. " +
    "Returns per-asset network availability (e.g. USDC on Base vs Ethereum).",
  inputSchema: z.object({
    country: z.string().length(2).describe("ISO 3166-1 alpha-2 country code, e.g. 'US', 'GB'."),
    subdivision: z
      .string()
      .optional()
      .describe("ISO 3166-2 subdivision code for US states, e.g. 'CA', 'NY'."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    country: z.string(),
    subdivision: z.string().optional(),
    paymentCurrencies: z.array(z.string()).optional(),
    purchaseCurrencies: z
      .array(
        z.object({
          id: z.string(),
          symbol: z.string(),
          name: z.string(),
          networks: z.array(z.string()),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ country, subdivision }) => {
    if (!isCdpConfigured()) {
      return { configured: false, country, error: CDP_NOT_CONFIGURED_MSG };
    }
    const res = await cdpRequest<{
      payment_currencies?: Array<{ id?: string }>;
      purchase_currencies?: Array<{
        id?: string;
        symbol?: string;
        name?: string;
        networks?: Array<{ name?: string; display_name?: string }>;
      }>;
    }>("/onramp/v1/buy/options", {
      host: "onramp",
      query: { country, subdivision },
    });
    if (!res.ok || !res.data) {
      return { configured: true, country, subdivision, error: res.error };
    }
    return {
      configured: true,
      country,
      subdivision,
      paymentCurrencies: (res.data.payment_currencies ?? []).map((p) => p.id ?? ""),
      purchaseCurrencies: (res.data.purchase_currencies ?? []).map((c) => ({
        id: c.id ?? "",
        symbol: c.symbol ?? "",
        name: c.name ?? "",
        networks: (c.networks ?? []).map((n) => n.display_name ?? n.name ?? ""),
      })),
    };
  },
});

// ============================================================================
// 3. get_onramp_quote — real-time buy quote
// ============================================================================

export const getOnrampQuoteTool = createTool({
  id: "get_onramp_quote",
  description:
    "Get a real-time price quote for a fiat → crypto purchase via Coinbase " +
    "Onramp. Returns gross amount, fees, exchange rate, and total cost. Use " +
    "to preview a purchase before generating a session URL. No commitment — " +
    "this is a read-only quote.",
  inputSchema: z.object({
    purchaseCurrency: z.string().describe("Crypto to buy, e.g. 'USDC', 'ETH'."),
    purchaseNetwork: z.string().optional().describe("Network, e.g. 'base', 'ethereum'. Defaults to token's primary."),
    paymentAmount: z.string().describe("Fiat amount as decimal string, e.g. '100.00'."),
    paymentCurrency: z.string().length(3).default("USD"),
    paymentMethod: z
      .string()
      .default("CARD")
      .describe("Payment method, e.g. 'CARD', 'APPLE_PAY', 'ACH_BANK_ACCOUNT'."),
    country: z.string().length(2).describe("ISO country code, e.g. 'US'."),
    subdivision: z.string().optional().describe("US state code if country is US."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    quote: z
      .object({
        purchaseAmount: z.string(),
        purchaseCurrency: z.string(),
        paymentSubtotal: z.string(),
        paymentTotal: z.string(),
        paymentCurrency: z.string(),
        fees: z.array(
          z.object({
            label: z.string(),
            amount: z.string(),
          }),
        ),
        quoteId: z.string().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({
    purchaseCurrency,
    purchaseNetwork,
    paymentAmount,
    paymentCurrency,
    paymentMethod,
    country,
    subdivision,
  }) => {
    if (!isCdpConfigured()) {
      return { configured: false, error: CDP_NOT_CONFIGURED_MSG };
    }
    const res = await cdpRequest<{
      purchase_amount?: { value?: string; currency?: string };
      payment_subtotal?: { value?: string; currency?: string };
      payment_total?: { value?: string; currency?: string };
      coinbase_fee?: { value?: string; currency?: string };
      network_fee?: { value?: string; currency?: string };
      quote_id?: string;
    }>("/onramp/v1/buy/quote", {
      host: "onramp",
      method: "POST",
      body: {
        purchase_currency: purchaseCurrency,
        purchase_network: purchaseNetwork,
        payment_amount: paymentAmount,
        payment_currency: paymentCurrency,
        payment_method: paymentMethod,
        country,
        subdivision,
      },
    });
    if (!res.ok || !res.data) {
      return { configured: true, error: res.error };
    }
    const d = res.data;
    return {
      configured: true,
      quote: {
        purchaseAmount: d.purchase_amount?.value ?? "0",
        purchaseCurrency: d.purchase_amount?.currency ?? purchaseCurrency,
        paymentSubtotal: d.payment_subtotal?.value ?? "0",
        paymentTotal: d.payment_total?.value ?? "0",
        paymentCurrency: d.payment_total?.currency ?? paymentCurrency,
        fees: [
          ...(d.coinbase_fee ? [{ label: "Coinbase fee", amount: d.coinbase_fee.value ?? "0" }] : []),
          ...(d.network_fee ? [{ label: "Network fee", amount: d.network_fee.value ?? "0" }] : []),
        ],
        quoteId: d.quote_id,
      },
    };
  },
});

// ============================================================================
// 4. create_onramp_session_url — hand-off URL for the user's browser
// ============================================================================

export const createOnrampSessionUrlTool = createTool({
  id: "create_onramp_session_url",
  description:
    "Generate a Coinbase Onramp session URL pre-filled with the destination " +
    "wallet address, asset, network, and amount. The user opens the URL in " +
    "their browser, completes payment (Apple Pay, card, ACH), and the funds " +
    "arrive at the destination address. Use for '/fund N USDC on Base' flows. " +
    "Gordon prints the URL — the user clicks it. The session token expires in " +
    "~30 minutes.",
  inputSchema: z.object({
    destinationAddress: z.string().describe("Recipient wallet address (0x...)."),
    destinationNetwork: z.string().describe("Network, e.g. 'base', 'ethereum'."),
    purchaseCurrency: z.string().describe("Crypto to buy, e.g. 'USDC', 'ETH'."),
    presetFiatAmount: z
      .number()
      .optional()
      .describe("Suggested fiat amount to preload in the UI."),
    fiatCurrency: z.string().length(3).default("USD"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    success: z.boolean(),
    sessionUrl: z.string().optional(),
    sessionToken: z.string().optional(),
    expiresAt: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({
    destinationAddress,
    destinationNetwork,
    purchaseCurrency,
    presetFiatAmount,
    fiatCurrency,
  }) => {
    if (!isCdpConfigured()) {
      return { configured: false, success: false, error: CDP_NOT_CONFIGURED_MSG };
    }
    const res = await cdpRequest<{ token?: string; expires_at?: string }>(
      "/onramp/v1/token",
      {
        host: "onramp",
        method: "POST",
        body: {
          addresses: [
            {
              address: destinationAddress,
              blockchains: [destinationNetwork],
            },
          ],
          assets: [purchaseCurrency],
        },
      },
    );
    if (!res.ok || !res.data) {
      return { configured: true, success: false, error: res.error };
    }
    const token = res.data.token;
    if (!token) {
      return { configured: true, success: false, error: "CDP did not return a session token" };
    }

    // Construct the pre-filled onramp URL
    const params = new URLSearchParams({
      sessionToken: token,
      defaultAsset: purchaseCurrency,
      defaultNetwork: destinationNetwork,
      defaultPaymentMethod: "CARD",
      fiatCurrency,
    });
    if (presetFiatAmount !== undefined) {
      params.set("presetFiatAmount", String(presetFiatAmount));
    }

    return {
      configured: true,
      success: true,
      sessionUrl: `https://pay.coinbase.com/buy/select-asset?${params.toString()}`,
      sessionToken: token,
      expiresAt: res.data.expires_at,
    };
  },
});

// ============================================================================
// 5. get_onramp_transactions — reconciliation / status polling
// ============================================================================

export const getOnrampTransactionsTool = createTool({
  id: "get_onramp_transactions",
  description:
    "List the user's past Coinbase Onramp purchases for reconciliation. Use to " +
    "check whether a session URL Gordon handed off to the user actually " +
    "completed — filter by partner_user_ref to find a specific session, or " +
    "list all recent transactions. Returns status (PENDING, SUCCESS, FAILED), " +
    "fiat amount, crypto amount, destination network and address, and a " +
    "transaction hash when settled.",
  inputSchema: z.object({
    partnerUserRef: z
      .string()
      .optional()
      .describe("Filter to transactions for a specific user reference set during session creation."),
    pageSize: z.number().int().min(1).max(100).optional().default(25),
    nextPageKey: z.string().optional().describe("Pagination cursor from a previous call."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    success: z.boolean(),
    total: z.number(),
    transactions: z
      .array(
        z.object({
          id: z.string(),
          status: z.string(),
          createdAt: z.string(),
          completedAt: z.string().optional(),
          fiatAmount: z.string(),
          fiatCurrency: z.string(),
          purchaseAmount: z.string(),
          purchaseCurrency: z.string(),
          network: z.string(),
          destinationAddress: z.string(),
          txHash: z.string().optional(),
          partnerUserRef: z.string().optional(),
        }),
      )
      .optional(),
    nextPageKey: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ partnerUserRef, pageSize, nextPageKey }) => {
    if (!isCdpConfigured()) {
      return { configured: false, success: false, total: 0, error: CDP_NOT_CONFIGURED_MSG };
    }
    const res = await cdpRequest<{
      transactions?: Array<{
        id?: string;
        status?: string;
        created_at?: string;
        completed_at?: string;
        payment_total?: { value?: string; currency?: string };
        purchase_amount?: { value?: string; currency?: string };
        purchase_network?: string;
        purchase_address?: string;
        tx_hash?: string;
        partner_user_ref?: string;
      }>;
      next_page_key?: string;
    }>("/onramp/v1/buy/user/transactions", {
      host: "onramp",
      query: {
        partner_user_ref: partnerUserRef,
        page_size: pageSize,
        next_page_key: nextPageKey,
      },
    });
    if (!res.ok || !res.data) {
      return { configured: true, success: false, total: 0, error: res.error };
    }
    const txs = res.data.transactions ?? [];
    return {
      configured: true,
      success: true,
      total: txs.length,
      transactions: txs.map((t) => ({
        id: t.id ?? "",
        status: t.status ?? "",
        createdAt: t.created_at ?? "",
        completedAt: t.completed_at,
        fiatAmount: t.payment_total?.value ?? "0",
        fiatCurrency: t.payment_total?.currency ?? "USD",
        purchaseAmount: t.purchase_amount?.value ?? "0",
        purchaseCurrency: t.purchase_amount?.currency ?? "",
        network: t.purchase_network ?? "",
        destinationAddress: t.purchase_address ?? "",
        txHash: t.tx_hash,
        partnerUserRef: t.partner_user_ref,
      })),
      nextPageKey: res.data.next_page_key,
    };
  },
});

// ============================================================================
// Export
// ============================================================================

export const cdpOnrampTools = {
  get_onramp_config: getOnrampConfigTool,
  get_onramp_options: getOnrampOptionsTool,
  get_onramp_quote: getOnrampQuoteTool,
  create_onramp_session_url: createOnrampSessionUrlTool,
  get_onramp_transactions: getOnrampTransactionsTool,
};
