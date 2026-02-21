/**
 * Solana Agent Kit — DeFi Lending, Staking & Vault Tools
 * Mastra createTool() wrappers for Lulo, Sanctum, Solayer, Voltr, and Drift yield
 *
 * Tools:
 * - solana_lulo_lend: Lend tokens via Lulo
 * - solana_lulo_withdraw: Withdraw from Lulo lending
 * - solana_drift_lend_apy: Get Drift lending/borrowing APY
 * - solana_drift_insurance_stake: Stake in Drift insurance fund
 * - solana_drift_insurance_request_unstake: Request unstake from Drift insurance
 * - solana_drift_insurance_unstake: Complete Drift insurance unstake
 * - solana_sanctum_lst_price: Get LST token prices via Sanctum
 * - solana_sanctum_apy: Get LST APY data
 * - solana_sanctum_tvl: Get LST TVL data
 * - solana_sanctum_owned_lst: Get owned LST tokens
 * - solana_sanctum_swap_lst: Swap between LST tokens
 * - solana_sanctum_add_liquidity: Add liquidity to Sanctum pool
 * - solana_sanctum_remove_liquidity: Remove liquidity from Sanctum pool
 * - solana_solayer_stake: Restake SOL via Solayer
 * - solana_voltr_deposit: Deposit into Voltr vault strategy
 * - solana_voltr_withdraw: Withdraw from Voltr vault strategy
 * - solana_voltr_positions: Get Voltr vault position values
 * - solana_drift_vault_info: Get Drift vault information
 * - solana_drift_vault_deposit: Deposit into a Drift vault
 * - solana_drift_vault_request_withdraw: Request withdrawal from Drift vault
 * - solana_drift_vault_withdraw: Complete Drift vault withdrawal
 *
 * All tools gracefully handle the case where Solana keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isSolanaKitConfigured } from "../../solanakit/index.ts";
import type { SolanaKitActionResult } from "../../solanakit/index.ts";

// ============================================================================
// Helper
// ============================================================================

async function safeExecuteAction(
  actionName: string,
  args: Record<string, unknown> = {},
): Promise<SolanaKitActionResult> {
  if (!isSolanaKitConfigured()) {
    return {
      success: false,
      result: "",
      action: actionName,
      error: "Solana Agent Kit not configured. Set SOLANA_PRIVATE_KEY and SOLANA_RPC_URL environment variables.",
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
      error: `Solana action "${actionName}" failed: ${(error as Error).message}`,
    };
  }
}

const solanaResultSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  action: z.string(),
  error: z.string().optional(),
});

// ============================================================================
// Lulo Lending
// ============================================================================

export const solanaLuloLendTool = createTool({
  id: "solana_lulo_lend",
  description:
    "Lend tokens via Lulo Protocol on Solana for yield. " +
    "Lulo optimizes across multiple lending protocols for best rates. Requires ARMED mode.",
  inputSchema: z.object({
    mintAddress: z.string().describe("Token mint address to lend (e.g., USDC mint)"),
    amount: z.number().describe("Amount to lend in human-readable units"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ mintAddress, amount }) =>
    safeExecuteAction("LULO_LEND", { mintAddress, amount }),
});

export const solanaLuloWithdrawTool = createTool({
  id: "solana_lulo_withdraw",
  description:
    "Withdraw tokens from Lulo Protocol lending position. Requires ARMED mode.",
  inputSchema: z.object({
    mintAddress: z.string().describe("Token mint address to withdraw"),
    amount: z.number().describe("Amount to withdraw"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ mintAddress, amount }) =>
    safeExecuteAction("LULO_WITHDRAW", { mintAddress, amount }),
});

// ============================================================================
// Drift Lending & Insurance
// ============================================================================

export const solanaDriftLendApyTool = createTool({
  id: "solana_drift_lend_apy",
  description:
    "Get current lending and borrowing APY for a token on Drift Protocol. " +
    "Useful for comparing yield opportunities.",
  inputSchema: z.object({
    symbol: z.string().describe("Token symbol (e.g., 'USDC', 'SOL')"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ symbol }) =>
    safeExecuteAction("DRIFT_GET_LEND_AND_BORROW_APY_ACTION", { symbol }),
});

export const solanaDriftInsuranceStakeTool = createTool({
  id: "solana_drift_insurance_stake",
  description:
    "Stake tokens in Drift Protocol's insurance fund for yield. Requires ARMED mode.",
  inputSchema: z.object({
    amount: z.number().describe("Amount to stake"),
    symbol: z.string().describe("Token symbol (e.g., 'USDC')"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, symbol }) =>
    safeExecuteAction("STAKE_TO_DRIFT_INSURANCE_FUND_ACTION", { amount, symbol }),
});

export const solanaDriftInsuranceRequestUnstakeTool = createTool({
  id: "solana_drift_insurance_request_unstake",
  description:
    "Request to unstake from Drift Protocol insurance fund. " +
    "Initiates cooldown period before withdrawal. Requires ARMED mode.",
  inputSchema: z.object({
    amount: z.number().describe("Amount to unstake"),
    symbol: z.string().describe("Token symbol"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, symbol }) =>
    safeExecuteAction("REQUEST_UNSTAKE_FROM_DRIFT_INSURANCE_FUND_ACTION", { amount, symbol }),
});

export const solanaDriftInsuranceUnstakeTool = createTool({
  id: "solana_drift_insurance_unstake",
  description:
    "Complete unstake from Drift insurance fund after cooldown period. Requires ARMED mode.",
  inputSchema: z.object({
    symbol: z.string().describe("Token symbol to unstake"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ symbol }) =>
    safeExecuteAction("UNSTAKE_FROM_DRIFT_INSURANCE_FUND_ACTION", { symbol }),
});

// ============================================================================
// Sanctum LST (Liquid Staking Tokens)
// ============================================================================

export const solanaSanctumLstPriceTool = createTool({
  id: "solana_sanctum_lst_price",
  description:
    "Get current prices of liquid staking tokens (LSTs) via Sanctum. " +
    "Accepts mint addresses or symbols (e.g., 'mSOL', 'bSOL', 'jitoSOL').",
  inputSchema: z.object({
    inputs: z.array(z.string()).describe("Array of LST mint addresses or symbols"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ inputs }) =>
    safeExecuteAction("GET_SANCTUM_PRICE", { inputs }),
});

export const solanaSanctumApyTool = createTool({
  id: "solana_sanctum_apy",
  description:
    "Get APY data for liquid staking tokens via Sanctum. " +
    "Compare yields across mSOL, bSOL, jitoSOL, and other LSTs.",
  inputSchema: z.object({
    inputs: z.array(z.string()).describe("Array of LST mint addresses or symbols"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ inputs }) =>
    safeExecuteAction("GET_SANCTUM_APY", { inputs }),
});

export const solanaSanctumTvlTool = createTool({
  id: "solana_sanctum_tvl",
  description: "Get TVL data for liquid staking tokens via Sanctum.",
  inputSchema: z.object({
    inputs: z.array(z.string()).describe("Array of LST mint addresses or symbols"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ inputs }) =>
    safeExecuteAction("GET_SANCTUM_TVL", { inputs }),
});

export const solanaSanctumOwnedLstTool = createTool({
  id: "solana_sanctum_owned_lst",
  description: "Get all liquid staking tokens owned by the wallet via Sanctum.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("SANCTUM_GET_OWNED_LST"),
});

export const solanaSanctumSwapLstTool = createTool({
  id: "solana_sanctum_swap_lst",
  description:
    "Swap between liquid staking tokens via Sanctum (e.g., mSOL → jitoSOL). Requires ARMED mode.",
  inputSchema: z.object({
    inputLstMint: z.string().describe("Input LST mint address"),
    outputLstMint: z.string().describe("Output LST mint address"),
    amount: z.string().describe("Amount to swap (as string, in base units)"),
    quotedAmount: z.string().describe("Expected output amount from quote"),
    priorityFee: z.number().optional().describe("Priority fee in lamports"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ inputLstMint, outputLstMint, amount, quotedAmount, priorityFee }) =>
    safeExecuteAction("SANCTUM_SWAP_LST", {
      inputLstMint, outputLstMint, amount, quotedAmount,
      ...(priorityFee !== undefined ? { priorityFee } : {}),
    }),
});

export const solanaSanctumAddLiquidityTool = createTool({
  id: "solana_sanctum_add_liquidity",
  description: "Add liquidity to Sanctum's LST pool. Requires ARMED mode.",
  inputSchema: z.object({
    lstMint: z.string().describe("LST mint address"),
    amount: z.string().describe("Amount to add (as string, in base units)"),
    quotedAmount: z.string().describe("Expected LP token amount from quote"),
    priorityFee: z.number().optional().describe("Priority fee in lamports"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ lstMint, amount, quotedAmount, priorityFee }) =>
    safeExecuteAction("SANCTUM_ADD_LIQUIDITY", {
      lstMint, amount, quotedAmount,
      ...(priorityFee !== undefined ? { priorityFee } : {}),
    }),
});

export const solanaSanctumRemoveLiquidityTool = createTool({
  id: "solana_sanctum_remove_liquidity",
  description: "Remove liquidity from Sanctum's LST pool. Requires ARMED mode.",
  inputSchema: z.object({
    lstMint: z.string().describe("LST mint address"),
    amount: z.string().describe("LP token amount to remove (as string)"),
    quotedAmount: z.string().describe("Expected LST amount from quote"),
    priorityFee: z.number().optional().describe("Priority fee in lamports"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ lstMint, amount, quotedAmount, priorityFee }) =>
    safeExecuteAction("SANCTUM_REMOVE_LIQUIDITY", {
      lstMint, amount, quotedAmount,
      ...(priorityFee !== undefined ? { priorityFee } : {}),
    }),
});

// ============================================================================
// Solayer Restaking
// ============================================================================

export const solanaSolayerStakeTool = createTool({
  id: "solana_solayer_stake",
  description:
    "Restake SOL via Solayer Protocol for additional yield on top of staking. Requires ARMED mode.",
  inputSchema: z.object({
    amount: z.number().describe("Amount of SOL to restake"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount }) =>
    safeExecuteAction("STAKE_WITH_SOLAYER", { amount }),
});

// ============================================================================
// Voltr Vault Strategies
// ============================================================================

export const solanaVoltrDepositTool = createTool({
  id: "solana_voltr_deposit",
  description:
    "Deposit into a Voltr vault strategy for automated yield. Requires ARMED mode.",
  inputSchema: z.object({
    depositAmount: z.string().describe("Amount to deposit (as string, in base units)"),
    vault: z.string().describe("Vault public key"),
    strategy: z.string().describe("Strategy public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ depositAmount, vault, strategy }) =>
    safeExecuteAction("DEPOSIT_VOLTR_STRATEGY", { depositAmount, vault, strategy }),
});

export const solanaVoltrWithdrawTool = createTool({
  id: "solana_voltr_withdraw",
  description:
    "Withdraw from a Voltr vault strategy. Requires ARMED mode.",
  inputSchema: z.object({
    withdrawAmount: z.string().describe("Amount to withdraw (as string, in base units)"),
    vault: z.string().describe("Vault public key"),
    strategy: z.string().describe("Strategy public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ withdrawAmount, vault, strategy }) =>
    safeExecuteAction("WITHDRAW_VOLTR_STRATEGY", { withdrawAmount, vault, strategy }),
});

export const solanaVoltrPositionsTool = createTool({
  id: "solana_voltr_positions",
  description: "Get current position values in a Voltr vault.",
  inputSchema: z.object({
    vault: z.string().describe("Vault public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ vault }) =>
    safeExecuteAction("GET_VOLTR_POSITION_VALUES", { vault }),
});

// ============================================================================
// Drift Vaults
// ============================================================================

export const solanaDriftVaultInfoTool = createTool({
  id: "solana_drift_vault_info",
  description: "Get information about a Drift vault including performance and TVL.",
  inputSchema: z.object({
    vaultNameOrAddress: z.string().describe("Vault name or public key address"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ vaultNameOrAddress }) =>
    safeExecuteAction("VAULT_INFO", { vaultNameOrAddress }),
});

export const solanaDriftVaultDepositTool = createTool({
  id: "solana_drift_vault_deposit",
  description: "Deposit funds into a Drift vault. Requires ARMED mode.",
  inputSchema: z.object({
    amount: z.number().describe("Amount to deposit"),
    vault: z.string().describe("Vault name or public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, vault }) =>
    safeExecuteAction("DEPOSIT_INTO_DRIFT_VAULT", { amount, vault }),
});

export const solanaDriftVaultRequestWithdrawTool = createTool({
  id: "solana_drift_vault_request_withdraw",
  description:
    "Request withdrawal from a Drift vault. Initiates cooldown period. Requires ARMED mode.",
  inputSchema: z.object({
    amount: z.number().describe("Amount to withdraw"),
    vault: z.string().describe("Vault name or public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, vault }) =>
    safeExecuteAction("REQUEST_WITHDRAWAL_FROM_DRIFT_VAULT", { amount, vault }),
});

export const solanaDriftVaultWithdrawTool = createTool({
  id: "solana_drift_vault_withdraw",
  description:
    "Complete withdrawal from a Drift vault after cooldown period. Requires ARMED mode.",
  inputSchema: z.object({
    vault: z.string().describe("Vault name or public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ vault }) =>
    safeExecuteAction("WITHDRAW_FROM_DRIFT_VAULT", { vault }),
});

// ============================================================================
// Export
// ============================================================================

export const solanaKitDefiLendingTools = {
  solana_lulo_lend: solanaLuloLendTool,
  solana_lulo_withdraw: solanaLuloWithdrawTool,
  solana_drift_lend_apy: solanaDriftLendApyTool,
  solana_drift_insurance_stake: solanaDriftInsuranceStakeTool,
  solana_drift_insurance_request_unstake: solanaDriftInsuranceRequestUnstakeTool,
  solana_drift_insurance_unstake: solanaDriftInsuranceUnstakeTool,
  solana_sanctum_lst_price: solanaSanctumLstPriceTool,
  solana_sanctum_apy: solanaSanctumApyTool,
  solana_sanctum_tvl: solanaSanctumTvlTool,
  solana_sanctum_owned_lst: solanaSanctumOwnedLstTool,
  solana_sanctum_swap_lst: solanaSanctumSwapLstTool,
  solana_sanctum_add_liquidity: solanaSanctumAddLiquidityTool,
  solana_sanctum_remove_liquidity: solanaSanctumRemoveLiquidityTool,
  solana_solayer_stake: solanaSolayerStakeTool,
  solana_voltr_deposit: solanaVoltrDepositTool,
  solana_voltr_withdraw: solanaVoltrWithdrawTool,
  solana_voltr_positions: solanaVoltrPositionsTool,
  solana_drift_vault_info: solanaDriftVaultInfoTool,
  solana_drift_vault_deposit: solanaDriftVaultDepositTool,
  solana_drift_vault_request_withdraw: solanaDriftVaultRequestWithdrawTool,
  solana_drift_vault_withdraw: solanaDriftVaultWithdrawTool,
};
