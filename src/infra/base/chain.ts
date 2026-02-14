/**
 * Base Chain Data Client
 * Fetches on-chain data from Base L2 via public RPC and Basescan APIs
 *
 * Uses:
 * - Base public RPC for gas prices and block data
 * - Basescan API for token info and balances (free tier, no key required for basic calls)
 */

import {
  BASE_CHAIN_CONFIG,
  type BaseGasPrice,
  type BaseBlockInfo,
} from "./types.ts";

// ============================================================================
// RPC Client (JSON-RPC to Base public endpoint)
// ============================================================================

/**
 * Make a JSON-RPC call to Base
 */
async function rpcCall(
  method: string,
  params: unknown[] = [],
  network: "mainnet" | "testnet" = "mainnet"
): Promise<unknown> {
  const rpcUrl = BASE_CHAIN_CONFIG[network].rpc;

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Base RPC error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { result?: unknown; error?: { message: string } };
  if (data.error) {
    throw new Error(`Base RPC error: ${data.error.message}`);
  }

  return data.result;
}

// ============================================================================
// Gas Price
// ============================================================================

/**
 * Get current Base gas price
 *
 * @param network - mainnet or testnet
 * @returns Gas price info including estimated transfer cost
 */
export async function getBaseGasPrice(
  network: "mainnet" | "testnet" = "mainnet"
): Promise<BaseGasPrice> {
  const gasPriceHex = (await rpcCall("eth_gasPrice", [], network)) as string;
  const gasPriceWei = parseInt(gasPriceHex, 16);
  const gasPriceGwei = gasPriceWei / 1e9;

  // Standard ETH transfer = 21000 gas
  const transferCostWei = gasPriceWei * 21000;
  const transferCostETH = transferCostWei / 1e18;

  return {
    gasPrice: gasPriceGwei,
    // L1 data fee is set to 0 because it cannot be pre-calculated without actual
    // transaction calldata. The L1 fee depends on the compressed tx size posted to
    // Ethereum and the current L1 blob base fee — it varies per transaction.
    // Use eth_estimateGas with a concrete tx for accurate total cost.
    l1DataFee: 0,
    estimatedTransferCostETH: transferCostETH,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Block Data
// ============================================================================

/**
 * Get the latest block info
 *
 * @param network - mainnet or testnet
 * @returns Latest block information
 */
export async function getLatestBlock(
  network: "mainnet" | "testnet" = "mainnet"
): Promise<BaseBlockInfo> {
  const block = (await rpcCall("eth_getBlockByNumber", ["latest", false], network)) as {
    number: string;
    timestamp: string;
    gasUsed: string;
    gasLimit: string;
    baseFeePerGas?: string;
    transactions: string[];
  };

  return {
    number: parseInt(block.number, 16),
    timestamp: parseInt(block.timestamp, 16),
    gasUsed: parseInt(block.gasUsed, 16),
    gasLimit: parseInt(block.gasLimit, 16),
    baseFeePerGas: block.baseFeePerGas ? parseInt(block.baseFeePerGas, 16) / 1e9 : 0,
    transactionCount: block.transactions.length,
  };
}

// ============================================================================
// Balance
// ============================================================================

/**
 * Get ETH balance for an address on Base
 *
 * @param address - Ethereum address (0x...)
 * @param network - mainnet or testnet
 * @returns Balance in ETH
 */
export async function getBaseBalance(
  address: string,
  network: "mainnet" | "testnet" = "mainnet"
): Promise<number> {
  const balanceHex = (await rpcCall("eth_getBalance", [address, "latest"], network)) as string;
  const balanceWei = parseInt(balanceHex, 16);
  return balanceWei / 1e18;
}

// ============================================================================
// Chain ID Verification
// ============================================================================

/**
 * Verify we're connected to the expected Base network
 *
 * @param network - mainnet or testnet
 * @returns true if chain ID matches
 */
export async function verifyBaseChainId(
  network: "mainnet" | "testnet" = "mainnet"
): Promise<boolean> {
  const chainIdHex = (await rpcCall("eth_chainId", [], network)) as string;
  const chainId = parseInt(chainIdHex, 16);
  return chainId === BASE_CHAIN_CONFIG[network].chainId;
}

// ============================================================================
// ERC-20 Token Balance (via RPC)
// ============================================================================

/**
 * Get ERC-20 token balance for an address on Base
 *
 * @param tokenAddress - ERC-20 contract address
 * @param walletAddress - Wallet address to check
 * @param decimals - Token decimals (default 18)
 * @param network - mainnet or testnet
 * @returns Token balance (formatted with decimals)
 */
export async function getBaseTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  decimals: number = 18,
  network: "mainnet" | "testnet" = "mainnet"
): Promise<number> {
  // balanceOf(address) = 0x70a08231 + padded address
  const paddedAddress = walletAddress.toLowerCase().replace("0x", "").padStart(64, "0");
  const data = `0x70a08231${paddedAddress}`;

  const result = (await rpcCall(
    "eth_call",
    [{ to: tokenAddress, data }, "latest"],
    network
  )) as string;

  const balanceRaw = BigInt(result);

  // String-based conversion to avoid BigInt→Number precision loss for large balances.
  // Number() loses precision above 2^53, which can happen with 18-decimal tokens
  // at balances above ~9,007 tokens — unlikely for most wallets but possible for
  // contracts/whales. This approach is safe for any balance.
  const balanceStr = balanceRaw.toString();
  if (decimals === 0) return parseFloat(balanceStr);
  const intPart = balanceStr.slice(0, -decimals) || "0";
  const fracPart = balanceStr.slice(-decimals).padStart(decimals, "0");
  return parseFloat(`${intPart}.${fracPart}`);
}
