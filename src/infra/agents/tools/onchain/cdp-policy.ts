/**
 * CDP Policy Engine Tools
 *
 * Programmatic control over CDP's wallet-level policy engine: allowlists,
 * spend limits, contract allowlists, network restrictions. Policies apply to
 * CDP Server Wallet v2 accounts and enforce at the signing layer — a policy
 * violation rejects the transaction before it's signed, even if Gordon tried
 * to send it.
 *
 * Uses CdpClient.policies.* from @coinbase/cdp-sdk for typed access.
 *
 * For an autonomous trading agent, these are the hard rails: the trading
 * constitution can be mirrored as policy rules (per-day spend cap, contract
 * allowlist, network restrictions) so the wallet refuses to sign anything
 * that violates them regardless of what Gordon's in-process logic thinks.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { CdpClient } from "@coinbase/cdp-sdk";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("cdp-policy");

const CDP_NOT_CONFIGURED_MSG =
  "CDP not configured. Set CDP_API_KEY_ID, CDP_API_KEY_SECRET and CDP_WALLET_SECRET " +
  "in ~/.gordon/.env to use policy engine tools.";

function getCdpClient(): CdpClient | null {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.CDP_WALLET_SECRET;
  if (!apiKeyId || !apiKeySecret || !walletSecret) return null;
  try {
    return new CdpClient({ apiKeyId, apiKeySecret, walletSecret });
  } catch (err) {
    logger.warn("Failed to init CdpClient for policy tools", { err: String(err) });
    return null;
  }
}

function errorString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ============================================================================
// 1. list_cdp_policies
// ============================================================================

export const listCdpPoliciesTool = createTool({
  id: "list_cdp_policies",
  description:
    "List all CDP policies on the user's account. Policies control what the " +
    "CDP Server Wallet is allowed to sign — allowlisted addresses, value caps, " +
    "contract allowlists, network restrictions. Returns id, scope, rule count, " +
    "and description for each.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    policies: z
      .array(
        z.object({
          id: z.string(),
          scope: z.string(),
          description: z.string(),
          ruleCount: z.number(),
          createdAt: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    const client = getCdpClient();
    if (!client) return { configured: false, total: 0, error: CDP_NOT_CONFIGURED_MSG };
    try {
      const response = (await client.policies.listPolicies({})) as unknown as {
        policies?: Array<Record<string, unknown>>;
      };
      const policies = response.policies ?? [];
      return {
        configured: true,
        total: policies.length,
        policies: policies.map((p) => ({
          id: String(p.id ?? ""),
          scope: String(p.scope ?? "project"),
          description: String(p.description ?? ""),
          ruleCount: Array.isArray(p.rules) ? p.rules.length : 0,
          createdAt: String(p.createdAt ?? p.created_at ?? ""),
        })),
      };
    } catch (err) {
      return { configured: true, total: 0, error: `Policy list failed: ${errorString(err)}` };
    }
  },
});

// ============================================================================
// 2. get_cdp_policy
// ============================================================================

export const getCdpPolicyTool = createTool({
  id: "get_cdp_policy",
  description:
    "Fetch a single CDP policy by ID, including its full rule set. Use after " +
    "list_cdp_policies to see what a specific policy actually enforces.",
  inputSchema: z.object({
    id: z.string().describe("Policy ID."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    success: z.boolean(),
    id: z.string(),
    scope: z.string().optional(),
    description: z.string().optional(),
    rules: z.array(z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    const client = getCdpClient();
    if (!client) {
      return { configured: false, success: false, id, error: CDP_NOT_CONFIGURED_MSG };
    }
    try {
      const policy = (await client.policies.getPolicyById({ id })) as unknown as Record<string, unknown>;
      return {
        configured: true,
        success: true,
        id,
        scope: String(policy.scope ?? "project"),
        description: String(policy.description ?? ""),
        rules: Array.isArray(policy.rules) ? (policy.rules as unknown[]) : [],
      };
    } catch (err) {
      return {
        configured: true,
        success: false,
        id,
        error: `Policy fetch failed: ${errorString(err)}`,
      };
    }
  },
});

// ============================================================================
// 3. create_cdp_policy
// ============================================================================

export const createCdpPolicyTool = createTool({
  id: "create_cdp_policy",
  description:
    "Create a new CDP policy that will enforce rules on the wallet. Rule shape " +
    "is CDP-specific JSON. Common patterns: send eth value cap, signEvmTransaction " +
    "destination allowlist, contract call allowlist, network restriction. " +
    "Example rules: [{ action: 'reject', operation: 'signEvmTransaction', criteria: [{ type: 'ethValue', ethValue: '1000000000000000000', operator: '>' }] }]. " +
    "Policies immediately start enforcing on signing attempts. Use for trading-" +
    "constitution mirroring (daily cap, contract allowlist).",
  inputSchema: z.object({
    scope: z.enum(["project", "account"]).default("project").describe(
      "Whether the policy applies to the whole project or a specific account.",
    ),
    description: z.string().describe("Human-readable description of what the policy enforces."),
    rules: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe("Array of CDP policy rule objects."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    created: z.boolean(),
    id: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ scope, description, rules }) => {
    const client = getCdpClient();
    if (!client) return { configured: false, created: false, error: CDP_NOT_CONFIGURED_MSG };
    try {
      const response = (await client.policies.createPolicy({
        policy: { scope, description, rules },
      } as unknown as Parameters<typeof client.policies.createPolicy>[0])) as unknown as {
        id?: string;
      };
      return { configured: true, created: true, id: response.id };
    } catch (err) {
      return {
        configured: true,
        created: false,
        error: `Policy create failed: ${errorString(err)}`,
      };
    }
  },
});

// ============================================================================
// 4. delete_cdp_policy
// ============================================================================

export const deleteCdpPolicyTool = createTool({
  id: "delete_cdp_policy",
  description:
    "Delete a CDP policy by ID. Policy stops enforcing immediately. Irreversible — " +
    "the policy must be recreated if you still want its rules enforced.",
  inputSchema: z.object({
    id: z.string().describe("Policy ID."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    deleted: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    const client = getCdpClient();
    if (!client) return { configured: false, deleted: false, error: CDP_NOT_CONFIGURED_MSG };
    try {
      await client.policies.deletePolicy({ id });
      return { configured: true, deleted: true };
    } catch (err) {
      return {
        configured: true,
        deleted: false,
        error: `Policy delete failed: ${errorString(err)}`,
      };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const cdpPolicyTools = {
  list_cdp_policies: listCdpPoliciesTool,
  get_cdp_policy: getCdpPolicyTool,
  create_cdp_policy: createCdpPolicyTool,
  delete_cdp_policy: deleteCdpPolicyTool,
};
