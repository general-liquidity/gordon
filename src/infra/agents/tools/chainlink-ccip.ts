/**
 * Chainlink CCIP Tools
 * Mastra createTool() wrappers for cross-chain token transfers via CCIP
 *
 * Tools:
 * - chainlink_ccip_supported_chains: List CCIP-supported chains and tokens
 * - chainlink_ccip_get_fee: Estimate CCIP transfer fee
 * - chainlink_ccip_transfer: Execute cross-chain token transfer
 * - chainlink_ccip_status: Check CCIP transfer status
 *
 * Requires EVM_PRIVATE_KEY for transfers. Fee estimation and status checks are read-only.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  isCCIPConfigured,
  getSupportedChains,
  getCCIPFee,
  executeCCIPTransfer,
  getCCIPStatus,
} from "../../protocols/chainlink/index.ts";

// ============================================================================
// Tools
// ============================================================================

const chainlinkCCIPSupportedChainsTool = createTool({
  id: "chainlink_ccip_supported_chains",
  description:
    "List all chains and tokens supported by Chainlink CCIP for cross-chain transfers. " +
    "Shows which EVM chains can send/receive tokens and what tokens are available on each.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
  }),
  execute: async () => {
    const chains = getSupportedChains();
    return { success: true, data: chains };
  },
});

const chainlinkCCIPGetFeeTool = createTool({
  id: "chainlink_ccip_get_fee",
  description:
    "Estimate the fee for a Chainlink CCIP cross-chain token transfer. " +
    "Returns fee in both LINK and native token. Does NOT execute the transfer. " +
    "Requires EVM_PRIVATE_KEY to query the router contract.",
  inputSchema: z.object({
    sourceChain: z
      .string()
      .describe('Source chain (e.g., "ethereum", "arbitrum", "base")'),
    destChain: z
      .string()
      .describe('Destination chain (e.g., "arbitrum", "optimism", "polygon")'),
    token: z
      .string()
      .describe('Token symbol to transfer (e.g., "USDC", "LINK", "WETH")'),
    amount: z
      .string()
      .describe('Amount to transfer in human-readable format (e.g., "100.5")'),
    recipient: z
      .string()
      .describe("Recipient address on the destination chain (0x...)"),
    decimals: z
      .number()
      .default(18)
      .describe("Token decimals (default 18, USDC=6)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ sourceChain, destChain, token, amount, recipient, decimals }) => {
    if (!isCCIPConfigured()) {
      return {
        success: false,
        error: "CCIP not configured. Set EVM_PRIVATE_KEY environment variable.",
      };
    }
    try {
      const fee = await getCCIPFee(sourceChain, destChain, token, amount, recipient, decimals);
      return { success: true, data: fee };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const chainlinkCCIPTransferTool = createTool({
  id: "chainlink_ccip_transfer",
  description:
    "Execute a cross-chain token transfer using Chainlink CCIP. " +
    "Transfers tokens between EVM chains (e.g., Ethereum -> Arbitrum). " +
    "REQUIRES permissionMode NOT STRICT. Confirm transfer details with user before executing. " +
    "Flow: approve -> estimate fee -> ccipSend. Requires EVM_PRIVATE_KEY.",
  inputSchema: z.object({
    sourceChain: z
      .string()
      .describe('Source chain (e.g., "ethereum", "arbitrum")'),
    destChain: z
      .string()
      .describe('Destination chain (e.g., "arbitrum", "base")'),
    token: z
      .string()
      .describe('Token symbol (e.g., "USDC", "LINK", "WETH")'),
    amount: z
      .string()
      .describe('Amount to transfer (e.g., "100.5")'),
    recipient: z
      .string()
      .describe("Recipient address on destination chain (0x...)"),
    payFeesInLink: z
      .boolean()
      .default(false)
      .describe("Pay fees in LINK (true) or native token (false, default)"),
    decimals: z
      .number()
      .default(18)
      .describe("Token decimals (default 18, USDC=6)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ sourceChain, destChain, token, amount, recipient, payFeesInLink, decimals }) => {
    if (!isCCIPConfigured()) {
      return {
        success: false,
        error: "CCIP not configured. Set EVM_PRIVATE_KEY environment variable.",
      };
    }
    try {
      const result = await executeCCIPTransfer(
        sourceChain, destChain, token, amount, recipient, payFeesInLink, decimals,
      );
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const chainlinkCCIPStatusTool = createTool({
  id: "chainlink_ccip_status",
  description:
    "Check the status of a Chainlink CCIP cross-chain transfer by its message ID. " +
    "Returns the transfer state (pending, in-flight, success, failed).",
  inputSchema: z.object({
    messageId: z
      .string()
      .describe("The CCIP message ID returned from chainlink_ccip_transfer"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ messageId }) => {
    try {
      const status = await getCCIPStatus(messageId);
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

// ============================================================================
// Export as keyed object (Mastra tool format)
// ============================================================================

export const chainlinkCCIPTools = {
  chainlink_ccip_supported_chains: chainlinkCCIPSupportedChainsTool,
  chainlink_ccip_get_fee: chainlinkCCIPGetFeeTool,
  chainlink_ccip_transfer: chainlinkCCIPTransferTool,
  chainlink_ccip_status: chainlinkCCIPStatusTool,
};
