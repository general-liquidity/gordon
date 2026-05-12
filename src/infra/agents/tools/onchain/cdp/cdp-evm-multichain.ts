/**
 * CDP EVM Multi-Chain Wallet Tools
 *
 * Gordon's existing AgentKit wallet is locked to Base. The CDP SDK's
 * CdpClient.evm namespace supports every EVM chain the platform covers —
 * Ethereum, Arbitrum, Optimism, Polygon, Avalanche, and more — from the
 * same API key. These tools expose that multi-chain surface directly, so
 * an agent can list accounts, check balances, quote swaps, and send
 * transactions on any supported EVM network without going through the
 * Base-pinned AgentKit provider.
 *
 * Uses CdpClient.evm.* directly (not raw REST) so we get typed SDK methods
 * and the SDK handles JWT auth + axios retries + billing accounting.
 *
 * Complements (does not replace) the existing agentkit_* tools. Use these
 * when the agent needs:
 *   - A non-Base chain (Ethereum mainnet, Arbitrum, Optimism, Polygon)
 *   - Smart account operations (batched UserOps, gasless flows)
 *   - Swap quotes via CDP Trade API on a specific network
 *   - A balance query across multiple chains for portfolio views
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CdpClient } from "@coinbase/cdp-sdk";

import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("cdp-evm-multichain");

const CDP_NOT_CONFIGURED_MSG =
  "CDP not configured. Set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET in " +
  "~/.gordon/.env to use multi-chain EVM wallet tools. Create keys at https://portal.cdp.coinbase.com/";

// CDP-supported EVM networks (per docs — all EVM chains are supported for wallets).
const SUPPORTED_NETWORKS = [
  "base",
  "base-sepolia",
  "ethereum",
  "ethereum-sepolia",
  "arbitrum",
  "arbitrum-sepolia",
  "optimism",
  "optimism-sepolia",
  "polygon",
  "polygon-amoy",
  "avalanche",
] as const;

type CdpNetwork = (typeof SUPPORTED_NETWORKS)[number];

function getCdpClient(): CdpClient | null {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.CDP_WALLET_SECRET;
  if (!apiKeyId || !apiKeySecret || !walletSecret) return null;
  try {
    return new CdpClient({ apiKeyId, apiKeySecret, walletSecret });
  } catch (err) {
    logger.warn("Failed to init CdpClient for multi-chain tools", { err: String(err) });
    return null;
  }
}

function errorString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ============================================================================
// 1. list_cdp_evm_accounts
// ============================================================================

export const listCdpEvmAccountsTool = createTool({
  id: "list_cdp_evm_accounts",
  description:
    "List all CDP-managed EVM accounts (Externally Owned Accounts). Each " +
    "account can operate on any EVM network — the same account address " +
    "exists on Ethereum, Base, Arbitrum, Optimism, Polygon, etc. Use to " +
    "see what addresses the user has provisioned through CDP.",
  inputSchema: z.object({
    pageSize: z.number().int().min(1).max(100).optional().default(20),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    accounts: z
      .array(
        z.object({
          address: z.string(),
          name: z.string().optional(),
          type: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pageSize }) => {
    const client = getCdpClient();
    if (!client) return { configured: false, total: 0, error: CDP_NOT_CONFIGURED_MSG };
    try {
      const response = (await client.evm.listAccounts({ pageSize })) as unknown as {
        accounts?: Array<{ address?: string; name?: string }>;
      };
      const accounts = (response.accounts ?? []).map((a) => ({
        address: a.address ?? "",
        name: a.name,
        type: "eoa",
      }));
      return { configured: true, total: accounts.length, accounts };
    } catch (err) {
      return { configured: true, total: 0, error: `List EVM accounts failed: ${errorString(err)}` };
    }
  },
});

// ============================================================================
// 2. list_cdp_smart_accounts
// ============================================================================

export const listCdpSmartAccountsTool = createTool({
  id: "list_cdp_smart_accounts",
  description:
    "List all CDP-managed smart accounts (ERC-4337 account abstraction wallets). " +
    "Smart accounts support batched UserOps, gas sponsorship via Paymaster, and " +
    "spend permissions. Each smart account has exactly one owner EOA.",
  inputSchema: z.object({
    pageSize: z.number().int().min(1).max(100).optional().default(20),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    smartAccounts: z
      .array(
        z.object({
          address: z.string(),
          name: z.string().optional(),
          ownerAddress: z.string().optional(),
          type: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pageSize }) => {
    const client = getCdpClient();
    if (!client) return { configured: false, total: 0, error: CDP_NOT_CONFIGURED_MSG };
    try {
      const response = (await client.evm.listSmartAccounts({ pageSize })) as unknown as {
        accounts?: Array<{ address?: string; name?: string; owners?: Array<{ address?: string }> }>;
      };
      const smartAccounts = (response.accounts ?? []).map((a) => ({
        address: a.address ?? "",
        name: a.name,
        ownerAddress: a.owners?.[0]?.address,
        type: "smart",
      }));
      return { configured: true, total: smartAccounts.length, smartAccounts };
    } catch (err) {
      return { configured: true, total: 0, error: `List smart accounts failed: ${errorString(err)}` };
    }
  },
});

// ============================================================================
// 3. create_cdp_evm_account
// ============================================================================

export const createCdpEvmAccountTool = createTool({
  id: "create_cdp_evm_account",
  description:
    "Create a new CDP-managed EVM account (EOA). The account is chain-agnostic " +
    "— the same address works on every EVM network CDP supports. Use for " +
    "provisioning a new hot wallet for trading strategies, sub-strategies, or " +
    "separate books within a portfolio.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe("Optional human-readable name for the account (e.g. 'scalper-book')."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    created: z.boolean(),
    address: z.string().optional(),
    name: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ name }) => {
    const client = getCdpClient();
    if (!client) return { configured: false, created: false, error: CDP_NOT_CONFIGURED_MSG };
    try {
      const account = (await client.evm.createAccount({ name })) as unknown as {
        address?: string;
        name?: string;
      };
      return {
        configured: true,
        created: true,
        address: account.address,
        name: account.name,
      };
    } catch (err) {
      return { configured: true, created: false, error: `Account create failed: ${errorString(err)}` };
    }
  },
});

// ============================================================================
// 4. create_cdp_smart_account
// ============================================================================

export const createCdpSmartAccountTool = createTool({
  id: "create_cdp_smart_account",
  description:
    "Create a new ERC-4337 smart account owned by an existing CDP EOA. Smart " +
    "accounts unlock batched UserOps (approve + swap in one tx), gas " +
    "sponsorship via CDP Paymaster (no ETH needed for gas), and spend " +
    "permissions. Requires an existing owner EOA address — call " +
    "create_cdp_evm_account first if none exists. One smart account per owner.",
  inputSchema: z.object({
    ownerAddress: z.string().describe("Existing CDP EOA address to own the smart account."),
    name: z.string().optional(),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    created: z.boolean(),
    address: z.string().optional(),
    ownerAddress: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ownerAddress, name }) => {
    const client = getCdpClient();
    if (!client) return { configured: false, created: false, error: CDP_NOT_CONFIGURED_MSG };
    try {
      const owner = (await client.evm.getAccount({ address: ownerAddress as `0x${string}` })) as unknown as Record<
        string,
        unknown
      >;
      if (!owner) {
        return {
          configured: true,
          created: false,
          error: `Owner EOA ${ownerAddress} not found in CDP. Create one with create_cdp_evm_account first.`,
        };
      }
      const smart = (await client.evm.createSmartAccount({
        owner: owner as unknown as Parameters<typeof client.evm.createSmartAccount>[0]["owner"],
        name,
      })) as unknown as { address?: string };
      return {
        configured: true,
        created: true,
        address: smart.address,
        ownerAddress,
      };
    } catch (err) {
      return { configured: true, created: false, error: `Smart account create failed: ${errorString(err)}` };
    }
  },
});

// ============================================================================
// 5. list_cdp_token_balances — multi-chain balance query
// ============================================================================

export const listCdpTokenBalancesTool = createTool({
  id: "list_cdp_token_balances",
  description:
    "List ERC20 and native token balances for a CDP-managed account on a " +
    "specific EVM network. Works on any CDP-supported chain: ethereum, base, " +
    "arbitrum, optimism, polygon, avalanche (and their testnets). Use for " +
    "cross-chain portfolio views — call once per network to assemble a full " +
    "picture.",
  inputSchema: z.object({
    address: z.string().describe("CDP account address (0x...)."),
    network: z.enum(SUPPORTED_NETWORKS).describe("EVM network to query balances on."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    address: z.string(),
    network: z.string(),
    balances: z
      .array(
        z.object({
          tokenAddress: z.string(),
          symbol: z.string().optional(),
          name: z.string().optional(),
          decimals: z.number().optional(),
          amount: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ address, network }) => {
    const client = getCdpClient();
    if (!client) {
      return { configured: false, address, network, error: CDP_NOT_CONFIGURED_MSG };
    }
    try {
      const response = (await client.evm.listTokenBalances({ address: address as `0x${string}`,
        network: network as unknown as Parameters<typeof client.evm.listTokenBalances>[0]["network"],
      })) as unknown as {
        balances?: Array<{
          token?: { contractAddress?: string; symbol?: string; name?: string; decimals?: number };
          amount?: { amount?: string };
        }>;
      };
      const balances = (response.balances ?? []).map((b) => ({
        tokenAddress: b.token?.contractAddress ?? "",
        symbol: b.token?.symbol,
        name: b.token?.name,
        decimals: b.token?.decimals,
        amount: String(b.amount?.amount ?? "0"),
      }));
      return { configured: true, address, network, balances };
    } catch (err) {
      return {
        configured: true,
        address,
        network,
        error: `Token balance query failed: ${errorString(err)}`,
      };
    }
  },
});

// ============================================================================
// 6. get_cdp_swap_price — pre-quote swap price on any EVM network
// ============================================================================

export const getCdpSwapPriceTool = createTool({
  id: "get_cdp_swap_price",
  description:
    "Get a real-time indicative swap price from CDP's Trade API on a specific " +
    "EVM network. Works on Base and Ethereum mainnet (per CDP Swaps coverage). " +
    "Use for price previews before committing to a swap. No commitment — " +
    "returns expected output amount, price impact, and the router that would " +
    "be used.",
  inputSchema: z.object({
    network: z.enum(["base", "ethereum"]).describe("CDP Swaps is supported on Base and Ethereum only."),
    fromToken: z.string().describe("Input token contract address (0x...) or 'eth' for native."),
    toToken: z.string().describe("Output token contract address (0x...) or 'eth' for native."),
    fromAmount: z.string().describe("Input amount in the token's smallest unit (e.g. wei)."),
    taker: z.string().describe("Taker address that will execute the swap."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    success: z.boolean(),
    toAmount: z.string().optional(),
    minToAmount: z.string().optional(),
    priceImpactBps: z.number().optional(),
    gasEstimate: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ network, fromToken, toToken, fromAmount, taker }) => {
    const client = getCdpClient();
    if (!client) return { configured: false, success: false, error: CDP_NOT_CONFIGURED_MSG };
    try {
      const response = (await client.evm.getSwapPrice({
        network: network as unknown as Parameters<typeof client.evm.getSwapPrice>[0]["network"],
        fromToken,
        toToken,
        fromAmount: BigInt(fromAmount),
        taker,
      } as unknown as Parameters<typeof client.evm.getSwapPrice>[0])) as unknown as {
        toAmount?: bigint | string;
        minToAmount?: bigint | string;
        priceImpact?: { bps?: number };
        gas?: bigint | string;
      };
      return {
        configured: true,
        success: true,
        toAmount: response.toAmount !== undefined ? String(response.toAmount) : undefined,
        minToAmount: response.minToAmount !== undefined ? String(response.minToAmount) : undefined,
        priceImpactBps: response.priceImpact?.bps,
        gasEstimate: response.gas !== undefined ? String(response.gas) : undefined,
      };
    } catch (err) {
      return {
        configured: true,
        success: false,
        error: `Swap price query failed: ${errorString(err)}`,
      };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const cdpEvmMultichainTools = {
  list_cdp_evm_accounts: listCdpEvmAccountsTool,
  list_cdp_smart_accounts: listCdpSmartAccountsTool,
  create_cdp_evm_account: createCdpEvmAccountTool,
  create_cdp_smart_account: createCdpSmartAccountTool,
  list_cdp_token_balances: listCdpTokenBalancesTool,
  get_cdp_swap_price: getCdpSwapPriceTool,
};
