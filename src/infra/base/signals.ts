/**
 * Base L2 On-Chain Signal Detection
 * Combines Basescan (wallet/transfer data) and DexScreener (DEX data) to detect trading signals
 *
 * Signals:
 * - Whale transfers: Large token movements on Base
 * - Volume spikes: Tokens with unusual DEX volume
 * - New listings: Recently created token pairs
 * - Buy/sell pressure: Transaction count analysis
 */

import { getTokenTransfers } from "./basescan.ts";
import { getBasePairs, getBaseTokensBatch, getNewBaseTokens } from "./dexscreener.ts";
import { BASE_TOKENS } from "./types.ts";
import type {
  WhaleTransferSignal,
  VolumeSpikeSignal,
  NewListingSignal,
  DexPressureSignal,
} from "./types.ts";

// ============================================================================
// Whale Transfer Detection
// ============================================================================

/**
 * Detect large token transfers on Base (whale movements)
 *
 * Scans recent ERC-20 transfers for USDC, WETH, and other major tokens
 * and returns those above the minimum USD-equivalent threshold.
 *
 * @param opts.minAmount - Minimum token amount to flag (default: 50000 for USDC-like)
 * @param opts.tokens - Token addresses to scan (default: USDC, WETH)
 * @param opts.limit - Max transfers to fetch per token (default: 50)
 */
export async function detectWhaleTransfers(opts: {
  minAmount?: number;
  tokens?: string[];
  limit?: number;
} = {}): Promise<WhaleTransferSignal[]> {
  const minAmount = opts.minAmount ?? 50000;
  const tokens = opts.tokens ?? [BASE_TOKENS.USDC, BASE_TOKENS.WETH];
  const limit = opts.limit ?? 50;

  // Token decimals for amount conversion
  const DECIMALS: Record<string, number> = {
    [BASE_TOKENS.USDC.toLowerCase()]: 6,
    [BASE_TOKENS.WETH.toLowerCase()]: 18,
    [BASE_TOKENS.DAI.toLowerCase()]: 18,
    [BASE_TOKENS.cbETH.toLowerCase()]: 18,
    [BASE_TOKENS.USDbC.toLowerCase()]: 6,
  };

  const signals: WhaleTransferSignal[] = [];

  const results = await Promise.allSettled(
    tokens.map((contractAddress) =>
      getTokenTransfers({ contractAddress, offset: limit, sort: "desc" })
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;

    for (const tx of result.value) {
      const decimals = DECIMALS[tx.contractAddress.toLowerCase()] ?? tx.tokenDecimal;
      const amount = parseFloat(tx.value) / Math.pow(10, decimals);

      if (amount >= minAmount) {
        signals.push({
          from: tx.from,
          to: tx.to,
          token: tx.contractAddress,
          tokenSymbol: tx.tokenSymbol,
          amount,
          hash: tx.hash,
          timestamp: tx.timestamp,
        });
      }
    }
  }

  // Sort by amount descending
  signals.sort((a, b) => b.amount - a.amount);
  return signals;
}

// ============================================================================
// DEX Volume Spike Detection
// ============================================================================

/**
 * Detect tokens with unusual volume spikes on Base DEXs
 *
 * A spike is when the hourly volume significantly exceeds the 24h average.
 * spikeMultiple = volumeH1 / (volumeH24 / 24)
 *
 * @param opts.tokenAddresses - Specific tokens to check (fetches top pairs)
 * @param opts.spikeThreshold - Minimum spike multiple (default: 3x)
 * @param opts.minLiquidityUsd - Minimum liquidity to filter noise (default: 10000)
 */
export async function detectVolumeSpikes(opts: {
  tokenAddresses?: string[];
  spikeThreshold?: number;
  minLiquidityUsd?: number;
} = {}): Promise<VolumeSpikeSignal[]> {
  const threshold = opts.spikeThreshold ?? 3;
  const minLiquidity = opts.minLiquidityUsd ?? 10000;

  let pairs;
  if (opts.tokenAddresses && opts.tokenAddresses.length > 0) {
    pairs = await getBaseTokensBatch(opts.tokenAddresses);
  } else {
    // Default: scan major Base tokens
    pairs = await getBaseTokensBatch([BASE_TOKENS.USDC, BASE_TOKENS.WETH]);
  }

  const signals: VolumeSpikeSignal[] = [];

  for (const pair of pairs) {
    if ((pair.liquidity?.usd ?? 0) < minLiquidity) continue;
    if (!pair.volume?.h1 || !pair.volume?.h24) continue;

    const avgHourlyVolume = pair.volume.h24 / 24;
    if (avgHourlyVolume <= 0) continue;

    const spikeMultiple = pair.volume.h1 / avgHourlyVolume;

    if (spikeMultiple >= threshold) {
      signals.push({
        token: pair.baseToken.address,
        tokenSymbol: pair.baseToken.symbol,
        pairAddress: pair.pairAddress,
        dex: pair.dexId,
        volumeH1: pair.volume.h1,
        volumeH24: pair.volume.h24,
        spikeMultiple: Math.round(spikeMultiple * 10) / 10,
        priceUsd: pair.priceUsd,
        priceChangeH1: pair.priceChange?.h1 ?? 0,
        liquidityUsd: pair.liquidity.usd,
      });
    }
  }

  signals.sort((a, b) => b.spikeMultiple - a.spikeMultiple);
  return signals;
}

// ============================================================================
// New Token Listing Detection
// ============================================================================

/**
 * Discover newly created token pairs on Base DEXs
 *
 * @param opts.maxAgeHours - Maximum age of listing (default: 24)
 * @param opts.minLiquidityUsd - Minimum liquidity to filter rugs (default: 5000)
 */
export async function detectNewListings(opts: {
  maxAgeHours?: number;
  minLiquidityUsd?: number;
} = {}): Promise<NewListingSignal[]> {
  const maxAgeHours = opts.maxAgeHours ?? 24;
  const minLiquidity = opts.minLiquidityUsd ?? 5000;
  const now = Date.now();
  const cutoff = now - maxAgeHours * 60 * 60 * 1000;

  const profiles = await getNewBaseTokens();

  // Get pair data for the new tokens
  const addresses = profiles.map((p) => p.tokenAddress).slice(0, 30);
  if (addresses.length === 0) return [];

  const pairs = await getBaseTokensBatch(addresses);

  const signals: NewListingSignal[] = [];

  for (const pair of pairs) {
    if (!pair.pairCreatedAt || pair.pairCreatedAt < cutoff) continue;
    if ((pair.liquidity?.usd ?? 0) < minLiquidity) continue;

    const ageHours = (now - pair.pairCreatedAt) / (60 * 60 * 1000);

    signals.push({
      token: pair.baseToken.address,
      tokenSymbol: pair.baseToken.symbol,
      tokenName: pair.baseToken.name,
      pairAddress: pair.pairAddress,
      dex: pair.dexId,
      priceUsd: pair.priceUsd,
      liquidityUsd: pair.liquidity.usd,
      volumeH24: pair.volume?.h24 ?? 0,
      createdAt: pair.pairCreatedAt,
      ageHours: Math.round(ageHours * 10) / 10,
    });
  }

  signals.sort((a, b) => a.ageHours - b.ageHours);
  return signals;
}

// ============================================================================
// DEX Buy/Sell Pressure Analysis
// ============================================================================

/**
 * Analyze buy/sell pressure for a token on Base DEXs
 *
 * Aggregates buy and sell transaction counts from the top liquidity pair.
 * buyPressure = buys / (buys + sells) — above 0.5 means more buyers.
 */
export async function analyzeDexPressure(tokenAddress: string): Promise<DexPressureSignal | null> {
  const pairs = await getBasePairs(tokenAddress);

  if (pairs.length === 0) return null;

  // Use the highest-liquidity pair
  const pair = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]!;

  const buysH1 = pair.txns?.h1?.buys ?? 0;
  const sellsH1 = pair.txns?.h1?.sells ?? 0;
  const buysH24 = pair.txns?.h24?.buys ?? 0;
  const sellsH24 = pair.txns?.h24?.sells ?? 0;
  const totalH1 = buysH1 + sellsH1;
  const totalH24 = buysH24 + sellsH24;

  return {
    token: pair.baseToken.address,
    tokenSymbol: pair.baseToken.symbol,
    priceUsd: pair.priceUsd,
    buysH1,
    sellsH1,
    buysH24,
    sellsH24,
    buyPressureH1: totalH1 > 0 ? Math.round((buysH1 / totalH1) * 100) / 100 : 0.5,
    buyPressureH24: totalH24 > 0 ? Math.round((buysH24 / totalH24) * 100) / 100 : 0.5,
    volumeH1: pair.volume?.h1 ?? 0,
    volumeH24: pair.volume?.h24 ?? 0,
    priceChangeH1: pair.priceChange?.h1 ?? 0,
    priceChangeH24: pair.priceChange?.h24 ?? 0,
  };
}
