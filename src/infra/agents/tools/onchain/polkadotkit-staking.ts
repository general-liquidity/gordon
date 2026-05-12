/**
 * Polkadot Agent Kit — Staking Tools
 * Mastra createTool() wrappers for nomination pool staking actions
 *
 * Tools:
 * - polkadot_get_pool_info: Get nomination pool details
 * - polkadot_join_pool: Join a nomination pool with bonded stake
 * - polkadot_bond_extra: Add more stake to an existing pool membership
 * - polkadot_unbond: Start unbonding stake from a pool
 * - polkadot_withdraw_unbonded: Withdraw fully unbonded stake
 * - polkadot_claim_rewards: Claim pending staking rewards from a pool
 *
 * All tools gracefully handle the case where Polkadot keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isPolkadotKitConfigured } from "../../../protocols/polkadot/index.ts";
import type { PolkadotKitActionResult } from "../../../protocols/polkadot/index.ts";

// ============================================================================
// Helper
// ============================================================================

async function safeExecuteAction(
  actionName: string,
  args: Record<string, unknown> = {},
): Promise<PolkadotKitActionResult> {
  if (!isPolkadotKitConfigured()) {
    return {
      success: false,
      result: "",
      action: actionName,
      error: "Polkadot Agent Kit not configured. Set POLKADOT_PRIVATE_KEY or POLKADOT_MNEMONIC environment variable.",
    };
  }

  try {
    const result = await executeAction(actionName, args);
    return { success: true, result, action: actionName };
  } catch (error) {
    return {
      success: false,
      result: "",
      action: actionName,
      error: `Polkadot action "${actionName}" failed: ${(error as Error).message}`,
    };
  }
}

const polkadotResultSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  action: z.string(),
  error: z.string().optional(),
});

// ============================================================================
// Pool Info (Read-only)
// ============================================================================

export const polkadotGetPoolInfoTool = createTool({
  id: "polkadot_get_pool_info",
  description:
    "Get detailed information about a Polkadot nomination pool — member count, total bonded, " +
    "commission, state, and roles. Use when user asks about staking pool details or " +
    "wants to research pools before joining.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID (e.g., 'polkadot', 'kusama', 'west')"),
    pool_id: z
      .number()
      .describe("Nomination pool ID (numeric)"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, pool_id }) =>
    safeExecuteAction("get_pool_info", { chain, pool_id }),
});

// ============================================================================
// Pool Staking (State-changing)
// ============================================================================

export const polkadotJoinPoolTool = createTool({
  id: "polkadot_join_pool",
  description:
    "Join a Polkadot nomination pool by bonding tokens. This starts earning staking rewards. " +
    "The bonded amount is locked and must be unbonded before it can be transferred. " +
    "Unbonding period is ~28 days on Polkadot, ~7 days on Kusama. " +
    "IMPORTANT: Confirm pool ID and amount with the user before executing. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID (e.g., 'polkadot', 'kusama', 'west')"),
    pool_id: z
      .number()
      .describe("Nomination pool ID to join"),
    amount: z
      .string()
      .describe("Amount of tokens to bond (e.g., '10' for 10 DOT). Minimum varies by pool."),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, pool_id, amount }) =>
    safeExecuteAction("join_pool", { chain, pool_id, amount }),
});

export const polkadotBondExtraTool = createTool({
  id: "polkadot_bond_extra",
  description:
    "Add more bonded stake to an existing nomination pool membership. " +
    "Increases your staking rewards proportionally. " +
    "IMPORTANT: Confirm amount with the user. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID"),
    pool_id: z
      .number()
      .describe("Nomination pool ID you are a member of"),
    amount: z
      .string()
      .describe("Additional amount to bond (e.g., '5' for 5 more DOT)"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, pool_id, amount }) =>
    safeExecuteAction("bond_extra", { chain, pool_id, amount }),
});

export const polkadotUnbondTool = createTool({
  id: "polkadot_unbond",
  description:
    "Start unbonding stake from a nomination pool. After the unbonding period " +
    "(~28 days on Polkadot, ~7 days on Kusama), use polkadot_withdraw_unbonded to claim. " +
    "Stops earning rewards on the unbonded amount immediately. " +
    "IMPORTANT: Confirm amount. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID"),
    pool_id: z
      .number()
      .describe("Nomination pool ID"),
    amount: z
      .string()
      .describe("Amount to unbond (e.g., '5' for 5 DOT)"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, pool_id, amount }) =>
    safeExecuteAction("unbond", { chain, pool_id, amount }),
});

export const polkadotWithdrawUnbondedTool = createTool({
  id: "polkadot_withdraw_unbonded",
  description:
    "Withdraw fully unbonded stake from a nomination pool. " +
    "Only works after the unbonding period has completed. " +
    "The tokens become transferable again after withdrawal. " +
    "Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID"),
    pool_id: z
      .number()
      .describe("Nomination pool ID"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, pool_id }) =>
    safeExecuteAction("withdraw_unbonded", { chain, pool_id }),
});

export const polkadotClaimRewardsTool = createTool({
  id: "polkadot_claim_rewards",
  description:
    "Claim pending staking rewards from a nomination pool. " +
    "Rewards accumulate over time and must be claimed to receive them. " +
    "Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID"),
    pool_id: z
      .number()
      .describe("Nomination pool ID"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, pool_id }) =>
    safeExecuteAction("claim_rewards", { chain, pool_id }),
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

export const polkadotKitStakingTools = {
  polkadot_get_pool_info: polkadotGetPoolInfoTool,
  polkadot_join_pool: polkadotJoinPoolTool,
  polkadot_bond_extra: polkadotBondExtraTool,
  polkadot_unbond: polkadotUnbondTool,
  polkadot_withdraw_unbonded: polkadotWithdrawUnbondedTool,
  polkadot_claim_rewards: polkadotClaimRewardsTool,
};
