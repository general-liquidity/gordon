/**
 * CDP Webhooks Tools
 *
 * Manage Coinbase Developer Platform webhook subscriptions from Gordon.
 *
 * Gordon runs on the user's machine, which typically has no public URL for
 * webhook delivery. These tools therefore handle the *management* side —
 * listing, creating (with a user-supplied public notification URI), and
 * deleting webhook subscriptions. A running Gordon instance can verify what
 * subscriptions exist, create new ones pointing at a tunnel (ngrok,
 * cloudflared, smee.io), or tear them down.
 *
 * Webhooks are Base-mainnet / Base-sepolia only and currently in beta.
 *
 * REST endpoints (CDP platform v2):
 *   GET/POST/PATCH/DELETE /platform/v2/webhooks
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { cdpRequest, isCdpConfigured, CDP_NOT_CONFIGURED_MSG } from "../../../../data/providers/cdp/cdpRest.ts";

const WEBHOOK_EVENT_TYPES = [
  "erc20_transfer",
  "erc721_transfer",
  "wallet_activity",
  "smart_contract_event_activity",
  "transaction_activity",
] as const;

const NETWORK_IDS = ["base-mainnet", "base-sepolia"] as const;

interface WebhookResource {
  id?: string;
  network_id?: string;
  event_type?: string;
  event_filters?: unknown[];
  notification_uri?: string;
  signing_key?: string;
  signature_secret?: string;
  secret?: string;
  metadata?: { secret?: string; [key: string]: unknown };
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

function shapeWebhook(w: WebhookResource, includeSecret = false) {
  const shaped: {
    id: string;
    networkId: string;
    eventType: string;
    notificationUri: string;
    eventFilters: unknown[];
    createdAt: string;
    signingSecret?: string;
  } = {
    id: w.id ?? "",
    networkId: w.network_id ?? "",
    eventType: w.event_type ?? "",
    notificationUri: w.notification_uri ?? "",
    eventFilters: w.event_filters ?? [],
    createdAt: w.created_at ?? "",
  };
  if (includeSecret) {
    // CDP returns the HMAC signing secret in different shapes across API
    // versions: metadata.secret (Hook0 quickstart format), top-level
    // signing_key / signature_secret / secret (v2 shape variants). Return
    // the first one present so the caller can build a verifier.
    shaped.signingSecret =
      (w.metadata?.secret as string | undefined) ??
      (w.signing_key ?? w.signature_secret ?? w.secret ?? "");
  }
  return shaped;
}

// ============================================================================
// 1. list_cdp_webhooks
// ============================================================================

export const listCdpWebhooksTool = createTool({
  id: "list_cdp_webhooks",
  description:
    "List all CDP webhook subscriptions on the user's account. Use to see what " +
    "on-chain event subscriptions are currently active on Base. Returns id, " +
    "network, event type, and notification URI for each. No args required.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    webhooks: z
      .array(
        z.object({
          id: z.string(),
          networkId: z.string(),
          eventType: z.string(),
          notificationUri: z.string(),
          eventFilters: z.array(z.unknown()),
          createdAt: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    if (!isCdpConfigured()) {
      return { configured: false, total: 0, error: CDP_NOT_CONFIGURED_MSG };
    }
    const res = await cdpRequest<{ data?: WebhookResource[] }>("/platform/v2/webhooks");
    if (!res.ok) {
      return { configured: true, total: 0, error: res.error };
    }
    const list = res.data?.data ?? [];
    return {
      configured: true,
      total: list.length,
      webhooks: list.map((w) => shapeWebhook(w)),
    };
  },
});

// ============================================================================
// 2. create_cdp_webhook
// ============================================================================

export const createCdpWebhookTool = createTool({
  id: "create_cdp_webhook",
  description:
    "Create a new CDP webhook subscription for on-chain events on Base. Gordon " +
    "runs locally with no public URL, so `notificationUri` must point at a " +
    "publicly reachable endpoint the user has set up — ngrok, cloudflared, " +
    "smee.io, or a deployed receiver. Supported event types: erc20_transfer, " +
    "erc721_transfer, wallet_activity, smart_contract_event_activity, " +
    "transaction_activity. Use event_filters to scope to specific addresses " +
    "(e.g. whale wallet list) or contracts (e.g. a specific token).",
  inputSchema: z.object({
    networkId: z.enum(NETWORK_IDS).default("base-mainnet"),
    eventType: z.enum(WEBHOOK_EVENT_TYPES),
    notificationUri: z
      .string()
      .url()
      .describe("Publicly reachable HTTPS URL that will receive POSTed events."),
    eventFilters: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Event-type-specific filter objects. For wallet_activity: [{ addresses: ['0x...'] }]. For erc20_transfer: [{ contract_address: '0x...' }].",
      ),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    created: z.boolean(),
    webhook: z
      .object({
        id: z.string(),
        networkId: z.string(),
        eventType: z.string(),
        notificationUri: z.string(),
        eventFilters: z.array(z.unknown()),
        createdAt: z.string(),
        signingSecret: z.string().optional(),
      })
      .optional(),
    signingSecretNote: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ networkId, eventType, notificationUri, eventFilters }) => {
    if (!isCdpConfigured()) {
      return { configured: false, created: false, error: CDP_NOT_CONFIGURED_MSG };
    }
    const body = {
      network_id: networkId,
      event_type: eventType,
      notification_uri: notificationUri,
      event_filters: eventFilters ?? [],
    };
    const res = await cdpRequest<WebhookResource>("/platform/v2/webhooks", {
      method: "POST",
      body,
    });
    if (!res.ok || !res.data) {
      return { configured: true, created: false, error: res.error };
    }
    return {
      configured: true,
      created: true,
      webhook: shapeWebhook(res.data, true),
      signingSecretNote:
        "Save the signingSecret immediately — CDP only returns it on creation. It's the HMAC-SHA256 key used to verify the X-Hook0-Signature header on incoming webhook POSTs (default 5-minute timestamp window).",
    };
  },
});

// ============================================================================
// 3. delete_cdp_webhook
// ============================================================================

export const deleteCdpWebhookTool = createTool({
  id: "delete_cdp_webhook",
  description:
    "Delete a CDP webhook subscription by ID. Use when a webhook is no longer " +
    "needed (stale tunnel, deprecated monitoring). Requires the webhook ID " +
    "from list_cdp_webhooks.",
  inputSchema: z.object({
    id: z.string().describe("Webhook ID to delete."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    deleted: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    if (!isCdpConfigured()) {
      return { configured: false, deleted: false, error: CDP_NOT_CONFIGURED_MSG };
    }
    const res = await cdpRequest(`/platform/v2/webhooks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return {
      configured: true,
      deleted: res.ok,
      error: res.ok ? undefined : res.error,
    };
  },
});

// ============================================================================
// 4. describe_cdp_webhook_setup — zero-API-call helper
// ============================================================================

export const describeCdpWebhookSetupTool = createTool({
  id: "describe_cdp_webhook_setup",
  description:
    "Return a guide explaining how to set up a public endpoint to receive CDP " +
    "webhook events when Gordon is running locally. Covers ngrok, cloudflared, " +
    "and smee.io tunneling options. Zero-API-call, always safe to invoke when " +
    "the user asks 'how do I listen for whale transfers?' or similar.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    options: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        command: z.string(),
        url: z.string(),
      }),
    ),
    notes: z.array(z.string()),
  }),
  execute: async () => ({
    options: [
      {
        name: "ngrok",
        description: "Easiest for ad-hoc testing. Spins up an HTTPS tunnel to your local machine.",
        command: "ngrok http 8080",
        url: "https://ngrok.com",
      },
      {
        name: "cloudflared",
        description: "Cloudflare Tunnel. Free tier, no signup required for quick tunnels.",
        command: "cloudflared tunnel --url http://localhost:8080",
        url: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
      },
      {
        name: "smee.io",
        description: "Webhook relay service. Subscribe a smee.io URL, forward to local.",
        command: "npx smee --url https://smee.io/abc123 --target http://localhost:8080/webhook",
        url: "https://smee.io",
      },
    ],
    notes: [
      "Point create_cdp_webhook.notificationUri at the public URL from your tunnel.",
      "CDP signs webhook deliveries — verify the X-Webhook-Signature header before trusting payloads.",
      "CDP Webhooks are in beta and currently Base-only (mainnet + sepolia).",
      "Delivery is at-least-once with up to 60 retries and exponential backoff.",
    ],
  }),
});

// ============================================================================
// Export
// ============================================================================

export const cdpWebhookTools = {
  list_cdp_webhooks: listCdpWebhooksTool,
  create_cdp_webhook: createCdpWebhookTool,
  delete_cdp_webhook: deleteCdpWebhookTool,
  describe_cdp_webhook_setup: describeCdpWebhookSetupTool,
};
