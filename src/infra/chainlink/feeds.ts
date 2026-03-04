/**
 * Chainlink Data Feeds — On-Chain Price Oracle Reader
 *
 * Reads price data directly from Chainlink Aggregator V3 contracts
 * via raw eth_call JSON-RPC. No SDK needed — just HTTP + ABI encoding.
 *
 * Free to use (no API key required). Works on any EVM chain.
 *
 * Functions:
 * - readFeed: Read latestRoundData from an aggregator contract
 * - readFeedByPair: Look up aggregator address by chain:pair and read
 * - comparePrices: Compare on-chain feed price vs Data Streams price
 */

import {
  FEED_SELECTORS,
  FEED_DIRECTORY,
  getRpcUrl,
  type FeedResult,
} from "./types.ts";
import { getLatestReport, isStreamsConfigured } from "./streams.ts";

// ============================================================================
// Low-Level eth_call Helper
// ============================================================================

/**
 * Execute a raw eth_call via JSON-RPC
 * @param rpcUrl - The RPC endpoint URL
 * @param to - Contract address
 * @param data - ABI-encoded calldata (hex)
 * @returns Hex-encoded return data
 */
async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { result?: string; error?: { message: string } };

  if (json.error) {
    throw new Error(`eth_call error: ${json.error.message}`);
  }

  if (!json.result || json.result === "0x") {
    throw new Error("eth_call returned empty result — contract may not exist at this address");
  }

  return json.result;
}

// ============================================================================
// ABI Decoding Helpers
// ============================================================================

/**
 * Decode latestRoundData() return value
 * Returns: (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
 * Each value is 32 bytes (64 hex chars) in the returned data
 */
function decodeLatestRoundData(hex: string): {
  roundId: string;
  answer: bigint;
  updatedAt: number;
} {
  // Strip 0x prefix
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;

  // Each slot is 32 bytes = 64 hex chars
  const roundId = BigInt("0x" + data.slice(0, 64)).toString();
  const answer = BigInt("0x" + data.slice(64, 128));
  // startedAt = slot 2, skip
  const updatedAt = Number(BigInt("0x" + data.slice(192, 256)));

  return { roundId, answer, updatedAt };
}

/**
 * Decode decimals() return value (uint8)
 */
function decodeDecimals(hex: string): number {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Number(BigInt("0x" + data));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Read the latest price from a Chainlink Data Feed aggregator contract
 *
 * @param chainName - Chain name (e.g., "ethereum", "arbitrum")
 * @param aggregatorAddress - The aggregator proxy contract address
 * @param pair - Optional pair name for display (e.g., "ETH/USD")
 */
export async function readFeed(
  chainName: string,
  aggregatorAddress: string,
  pair?: string,
): Promise<FeedResult> {
  const rpcUrl = getRpcUrl(chainName);

  // Parallel calls: latestRoundData() and decimals()
  const [roundDataHex, decimalsHex] = await Promise.all([
    ethCall(rpcUrl, aggregatorAddress, FEED_SELECTORS.latestRoundData),
    ethCall(rpcUrl, aggregatorAddress, FEED_SELECTORS.decimals),
  ]);

  const { roundId, answer, updatedAt } = decodeLatestRoundData(roundDataHex);
  const decimals = decodeDecimals(decimalsHex);

  // Convert raw answer to price using decimals
  const price = Number(answer) / Math.pow(10, decimals);

  return {
    chain: chainName,
    pair: pair || "UNKNOWN",
    price,
    decimals,
    roundId,
    updatedAt,
    aggregatorAddress,
  };
}

/**
 * Read a Data Feed by chain name and pair
 * Looks up the aggregator address from FEED_DIRECTORY
 *
 * @param chainName - Chain name (e.g., "ethereum", "arbitrum")
 * @param pair - Pair name (e.g., "ETH/USD", "BTC/USD")
 */
export async function readFeedByPair(
  chainName: string,
  pair: string,
): Promise<FeedResult> {
  const normalized = pair.toUpperCase().replace("-", "/");
  const key = `${chainName}:${normalized}`;

  const aggregatorAddress = FEED_DIRECTORY[key];
  if (!aggregatorAddress) {
    // List available feeds for this chain
    const available = Object.keys(FEED_DIRECTORY)
      .filter((k) => k.startsWith(`${chainName}:`))
      .map((k) => k.split(":")[1]);

    if (available.length === 0) {
      throw new Error(
        `No Data Feeds available for chain "${chainName}". ` +
        `Supported chains: ${[...new Set(Object.keys(FEED_DIRECTORY).map((k) => k.split(":")[0]))].join(", ")}`
      );
    }

    throw new Error(
      `Data Feed "${normalized}" not found on ${chainName}. ` +
      `Available: ${available.join(", ")}. ` +
      `Or provide a custom aggregator address.`
    );
  }

  return readFeed(chainName, aggregatorAddress, normalized);
}

/**
 * Compare an on-chain Data Feed price with Data Streams price
 * Useful for detecting price manipulation or confirming fair value.
 *
 * @param pair - Pair name (e.g., "ETH/USD")
 * @param chainName - Chain for on-chain feed (default: "ethereum")
 * @param streamPrice - Optional pre-fetched Streams price (fetches if not provided)
 */
export async function comparePrices(
  pair: string,
  chainName: string = "ethereum",
  streamPrice?: number,
): Promise<{
  pair: string;
  onChainPrice: number;
  streamsPrice: number | null;
  deltaPercent: number | null;
  onChainUpdatedAt: number;
  chain: string;
}> {
  // Get on-chain feed price
  const feedResult = await readFeedByPair(chainName, pair);

  // Get Data Streams price if available
  let streamsPrice: number | null = streamPrice ?? null;
  if (streamsPrice === null && isStreamsConfigured()) {
    try {
      const report = await getLatestReport(pair);
      streamsPrice = report.price;
    } catch {
      // Data Streams might not have this pair — that's OK
      streamsPrice = null;
    }
  }

  // Calculate delta percentage
  const deltaPercent =
    streamsPrice !== null
      ? ((feedResult.price - streamsPrice) / streamsPrice) * 100
      : null;

  return {
    pair: feedResult.pair,
    onChainPrice: feedResult.price,
    streamsPrice,
    deltaPercent,
    onChainUpdatedAt: feedResult.updatedAt,
    chain: chainName,
  };
}

/**
 * List all available Data Feed pairs for a chain
 */
export function listAvailableFeeds(chainName?: string): Array<{ chain: string; pair: string; address: string }> {
  return Object.entries(FEED_DIRECTORY)
    .filter(([key]) => !chainName || key.startsWith(`${chainName}:`))
    .map(([key, address]) => {
      const [chain, pair] = key.split(":");
      return { chain: chain!, pair: pair!, address };
    });
}
