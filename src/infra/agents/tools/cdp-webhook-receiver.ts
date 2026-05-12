/**
 * CDP Webhook Receiver Tools
 *
 * Agent-facing wrappers over the singleton CdpWebhookReceiver. Start and stop
 * the local HTTP listener, query buffered events, and inspect receiver status.
 *
 * Typical flow:
 *   1. User runs a tunnel (ngrok, cloudflared, smee.io) pointing at localhost.
 *   2. Agent calls start_cdp_webhook_listener with the signing secret from
 *      create_cdp_webhook's response.
 *   3. Agent calls create_cdp_webhook with notification_uri = tunnel URL.
 *   4. Events stream in; agent calls get_recent_cdp_webhook_events periodically
 *      (or surfaces them via the TradeEventMessage path later).
 *   5. Agent calls stop_cdp_webhook_listener when done.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getCdpWebhookReceiver } from "../../data/providers/cdpWebhookReceiver.ts";

// ============================================================================
// 1. start_cdp_webhook_listener
// ============================================================================

export const startCdpWebhookListenerTool = createTool({
  id: "start_cdp_webhook_listener",
  description:
    "Start a local HTTP listener that receives incoming CDP webhook POSTs, " +
    "verifies X-Hook0-Signature HMACs, and buffers events in memory (500-event " +
    "ring buffer) so the agent can query them. Pair with create_cdp_webhook + a " +
    "public tunnel (ngrok/cloudflared/smee.io) to set up real-time on-chain " +
    "alerting. Signing secret should be the `webhook.signingSecret` from a " +
    "create_cdp_webhook response — without it, events are stored but marked " +
    "unverified.",
  inputSchema: z.object({
    port: z
      .number()
      .int()
      .min(0)
      .max(65535)
      .optional()
      .describe("Port to bind to. Pass 0 (default) to let the OS pick an available port."),
    path: z
      .string()
      .optional()
      .describe("URL path prefix for the webhook endpoint. Defaults to /cdp-webhook."),
    signingSecret: z
      .string()
      .optional()
      .describe("HMAC secret from create_cdp_webhook response for signature verification."),
  }),
  outputSchema: z.object({
    started: z.boolean(),
    port: z.number().optional(),
    url: z.string().optional(),
    healthUrl: z.string().optional(),
    alreadyRunning: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ port, path, signingSecret }) => {
    const r = getCdpWebhookReceiver();
    if (r.isRunning()) {
      const status = r.getStatus();
      return {
        started: false,
        alreadyRunning: true,
        port: status.port ?? undefined,
        url: status.port ? `http://localhost:${status.port}${status.path}` : undefined,
        healthUrl: status.port ? `http://localhost:${status.port}${status.path}/health` : undefined,
      };
    }
    try {
      const { port: assigned, url } = r.start({ port, path, signingSecret });
      return {
        started: true,
        port: assigned,
        url,
        healthUrl: `${url}/health`,
      };
    } catch (err) {
      return { started: false, error: (err as Error).message };
    }
  },
});

// ============================================================================
// 2. stop_cdp_webhook_listener
// ============================================================================

export const stopCdpWebhookListenerTool = createTool({
  id: "stop_cdp_webhook_listener",
  description:
    "Stop the local CDP webhook listener. Buffered events are discarded. Use " +
    "when the user is done monitoring or when switching to a new subscription " +
    "set with a different signing secret.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    stopped: z.boolean(),
    wasRunning: z.boolean(),
  }),
  execute: async () => {
    const r = getCdpWebhookReceiver();
    const wasRunning = r.isRunning();
    const stopped = r.stop();
    return { stopped, wasRunning };
  },
});

// ============================================================================
// 3. get_cdp_webhook_listener_status
// ============================================================================

export const getCdpWebhookListenerStatusTool = createTool({
  id: "get_cdp_webhook_listener_status",
  description:
    "Get the current status of the local CDP webhook listener: running state, " +
    "port, URL path, total events received, verified count, rejected count, " +
    "and whether a signing secret is configured. Use to verify the listener " +
    "is healthy before telling the user to create a subscription.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    running: z.boolean(),
    port: z.number().nullable(),
    url: z.string().optional(),
    path: z.string(),
    eventCount: z.number(),
    totalReceived: z.number(),
    verifiedCount: z.number(),
    rejectedCount: z.number(),
    startedAt: z.string().nullable(),
    secretConfigured: z.boolean(),
  }),
  execute: async () => {
    const r = getCdpWebhookReceiver();
    const status = r.getStatus();
    return {
      ...status,
      url: status.port ? `http://localhost:${status.port}${status.path}` : undefined,
    };
  },
});

// ============================================================================
// 4. get_recent_cdp_webhook_events
// ============================================================================

export const getRecentCdpWebhookEventsTool = createTool({
  id: "get_recent_cdp_webhook_events",
  description:
    "Fetch the most recent CDP webhook events received by the local listener " +
    "(newest first). Each event includes id, receive time, HMAC verification " +
    "status, and the decoded JSON payload. Use for polling — surface whale " +
    "transfers, wallet activity, or DEX events to the user. Events are stored " +
    "in a 500-event ring buffer; older events roll off.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).optional().default(20),
    onlyVerified: z
      .boolean()
      .optional()
      .default(false)
      .describe("Only return events whose HMAC signature verified."),
  }),
  outputSchema: z.object({
    running: z.boolean(),
    returned: z.number(),
    bufferSize: z.number(),
    events: z
      .array(
        z.object({
          id: z.number(),
          eventId: z.string().optional(),
          receivedAt: z.string(),
          verified: z.boolean(),
          verificationError: z.string().optional(),
          payload: z.unknown().optional(),
          rawBody: z.string().optional(),
        }),
      )
      .optional(),
  }),
  execute: async ({ limit, onlyVerified }) => {
    const r = getCdpWebhookReceiver();
    if (!r.isRunning()) {
      return { running: false, returned: 0, bufferSize: 0, events: [] };
    }
    const status = r.getStatus();
    const events = r.getRecentEvents(limit, onlyVerified);
    return {
      running: true,
      returned: events.length,
      bufferSize: status.eventCount,
      events: events.map((e) => ({
        id: e.id,
        eventId: e.eventId,
        receivedAt: new Date(e.receivedAt).toISOString(),
        verified: e.verified,
        verificationError: e.verificationError,
        payload: e.payload,
        rawBody: e.rawBody,
      })),
    };
  },
});

// ============================================================================
// 5. clear_cdp_webhook_buffer
// ============================================================================

export const clearCdpWebhookBufferTool = createTool({
  id: "clear_cdp_webhook_buffer",
  description:
    "Clear the local CDP webhook event buffer without stopping the listener. " +
    "Use after processing a batch of events to free memory or reset the view.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    cleared: z.boolean(),
    previousCount: z.number(),
  }),
  execute: async () => {
    const r = getCdpWebhookReceiver();
    const previousCount = r.getStatus().eventCount;
    r.clearBuffer();
    return { cleared: true, previousCount };
  },
});

// ============================================================================
// Export
// ============================================================================

export const cdpWebhookReceiverTools = {
  start_cdp_webhook_listener: startCdpWebhookListenerTool,
  stop_cdp_webhook_listener: stopCdpWebhookListenerTool,
  get_cdp_webhook_listener_status: getCdpWebhookListenerStatusTool,
  get_recent_cdp_webhook_events: getRecentCdpWebhookEventsTool,
  clear_cdp_webhook_buffer: clearCdpWebhookBufferTool,
};
