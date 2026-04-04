/**
 * Basescan / Etherscan V2 API Client
 * Free REST API for Base L2 on-chain data (token transfers, holders, address tags)
 *
 * Uses the unified Etherscan V2 API with chainid=8453 for Base mainnet.
 * Requires BASESCAN_API_KEY env var (free from basescan.org).
 * Rate limit: 5 calls/sec per API key.
 */

import type { BaseTokenTransfer, BaseTokenHolder } from "./types.ts";

// ============================================================================
// Configuration
// ============================================================================

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const BASE_CHAIN_ID = "8453";

let _apiKeyWarned = false;

function getApiKey(): string {
  const key = process.env.BASESCAN_API_KEY || "";
  if (!key && !_apiKeyWarned) {
    console.warn("[Basescan] BASESCAN_API_KEY not set — whale detection will be rate-limited to 1 req/5s");
    _apiKeyWarned = true;
  }
  return key;
}

// ============================================================================
// Internal Helpers
// ============================================================================

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

async function etherscanCall<T>(params: Record<string, string>): Promise<T> {
  const apiKey = getApiKey();
  const query = new URLSearchParams({
    chainid: BASE_CHAIN_ID,
    ...(apiKey ? { apikey: apiKey } : {}),
    ...params,
  });

  const url = `${ETHERSCAN_V2_BASE}?${query.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (!res.ok) {
    throw new Error(`Basescan API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as EtherscanResponse<T>;

  if (data.status === "0" && data.message === "NOTOK") {
    throw new Error(`Basescan API error: ${data.result}`);
  }

  return data.result;
}

// ============================================================================
// Token Transfers (ERC-20)
// ============================================================================

interface EtherscanTokenTx {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  value: string;
}

/**
 * Get ERC-20 token transfers — primary endpoint for whale detection
 *
 * @param opts.contractAddress - Filter by token contract (e.g., USDC address)
 * @param opts.address - Filter by wallet address
 * @param opts.startBlock - Starting block number
 * @param opts.endBlock - Ending block number
 * @param opts.page - Page number (default 1)
 * @param opts.offset - Results per page (default 100, max 10000)
 * @param opts.sort - Sort direction ('asc' or 'desc')
 */
export async function getTokenTransfers(opts: {
  contractAddress?: string;
  address?: string;
  startBlock?: number;
  endBlock?: number;
  page?: number;
  offset?: number;
  sort?: "asc" | "desc";
} = {}): Promise<BaseTokenTransfer[]> {
  const params: Record<string, string> = {
    module: "account",
    action: "tokentx",
    page: String(opts.page ?? 1),
    offset: String(opts.offset ?? 100),
    sort: opts.sort ?? "desc",
  };

  if (opts.contractAddress) params.contractaddress = opts.contractAddress;
  if (opts.address) params.address = opts.address;
  if (opts.startBlock !== undefined) params.startblock = String(opts.startBlock);
  if (opts.endBlock !== undefined) params.endblock = String(opts.endBlock);

  const txs = await etherscanCall<EtherscanTokenTx[]>(params);

  if (!Array.isArray(txs)) return [];

  return txs.map((tx) => ({
    from: tx.from,
    to: tx.to,
    value: tx.value,
    contractAddress: tx.contractAddress,
    tokenSymbol: tx.tokenSymbol,
    tokenName: tx.tokenName,
    tokenDecimal: parseInt(tx.tokenDecimal, 10),
    blockNumber: parseInt(tx.blockNumber, 10),
    timestamp: parseInt(tx.timeStamp, 10),
    hash: tx.hash,
  }));
}

// ============================================================================
// Normal Transactions (ETH)
// ============================================================================

interface EtherscanTx {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  isError: string;
  functionName: string;
}

/**
 * Get normal ETH transactions for an address
 */
export async function getTransactions(
  address: string,
  opts: { page?: number; offset?: number; sort?: "asc" | "desc" } = {},
): Promise<{
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  isError: boolean;
}[]> {
  const txs = await etherscanCall<EtherscanTx[]>({
    module: "account",
    action: "txlist",
    address,
    page: String(opts.page ?? 1),
    offset: String(opts.offset ?? 50),
    sort: opts.sort ?? "desc",
  });

  if (!Array.isArray(txs)) return [];

  return txs.map((tx) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    timestamp: parseInt(tx.timeStamp, 10),
    isError: tx.isError === "1",
  }));
}

// ============================================================================
// Token Holders
// ============================================================================

interface EtherscanTokenHolder {
  TokenHolderAddress: string;
  TokenHolderQuantity: string;
}

/**
 * Get top holders for an ERC-20 token
 */
export async function getTopTokenHolders(
  contractAddress: string,
  opts: { page?: number; offset?: number } = {},
): Promise<BaseTokenHolder[]> {
  const holders = await etherscanCall<EtherscanTokenHolder[]>({
    module: "token",
    action: "tokenholderlist",
    contractaddress: contractAddress,
    page: String(opts.page ?? 1),
    offset: String(opts.offset ?? 20),
  });

  if (!Array.isArray(holders)) return [];

  // Calculate total for share percentages
  const total = holders.reduce((sum, h) => sum + parseFloat(h.TokenHolderQuantity || "0"), 0);

  return holders.map((h) => ({
    address: h.TokenHolderAddress,
    balance: h.TokenHolderQuantity,
    share: total > 0 ? (parseFloat(h.TokenHolderQuantity || "0") / total) * 100 : 0,
  }));
}

/**
 * Check if Basescan API is configured
 */
export function isBasescanConfigured(): boolean {
  return Boolean(process.env.BASESCAN_API_KEY);
}
