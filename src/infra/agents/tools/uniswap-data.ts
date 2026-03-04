/**
 * Uniswap V3 Subgraph Tools (Mastra Format)
 * Agent-facing tools for on-chain Uniswap market data beyond the Exchange interface.
 *
 * These tools expose subgraph-specific data that doesn't map to the generic
 * Exchange interface: tick liquidity, mint/burn events, LP positions,
 * flash loans, and protocol-wide metrics.
 *
 * Only available when the active exchange is Uniswap with a THEGRAPH_API_KEY.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import type { UniswapAdapter } from "../../exchange/adapters/uniswap.ts";

// ============================================================================
// Helpers
// ============================================================================

function getSubgraph(execContext: MastraExecutionContext) {
  const ctx = getGordonContext(execContext);
  if (!ctx?.exchange) return { error: "Exchange client not connected." as const };
  if (ctx.exchange.exchangeId !== "uniswap") return { error: "This tool is only available on Uniswap." as const };
  const subgraph = (ctx.exchange as UniswapAdapter).subgraph;
  if (!subgraph?.isAvailable()) return { error: "Uniswap subgraph not available. Set THEGRAPH_API_KEY." as const };
  return { subgraph };
}

// ============================================================================
// get_pool_tick_liquidity — Real order book depth from tick data
// ============================================================================

export const getPoolTickLiquidityTool = createTool({
  id: "get_pool_tick_liquidity",
  description:
    "Get real liquidity distribution around the current price for a Uniswap pool. " +
    "Shows actual bid/ask depth from on-chain tick data — much more accurate than TVL proxy. " +
    "Use for order book depth analysis, slippage estimation, and liquidity gap detection.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'ETHUSDC', 'UNIUSDC')"),
    ticksPerSide: z.number().min(1).max(50).default(20).describe("Number of tick spaces on each side of current price"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    currentTick: z.number().optional(),
    tickCount: z.number().optional(),
    ticks: z.array(z.object({
      tickIdx: z.number(),
      price: z.number(),
      liquidityNet: z.number(),
      liquidityGross: z.number(),
      volumeUSD: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, ticksPerSide }, execContext: MastraExecutionContext) => {
    const result = getSubgraph(execContext);
    if ("error" in result) return result;

    try {
      const pool = await result.subgraph.resolvePool(symbol);
      const ticks = await result.subgraph.getTickLiquidity(symbol, ticksPerSide);
      return {
        symbol,
        currentTick: parseInt(pool.pool.tick, 10),
        tickCount: ticks.length,
        ticks: ticks.map((t) => ({
          tickIdx: parseInt(t.tickIdx, 10),
          price: parseFloat(pool.isInverted ? t.price1 : t.price0),
          liquidityNet: parseFloat(t.liquidityNet),
          liquidityGross: parseFloat(t.liquidityGross),
          volumeUSD: parseFloat(t.volumeUSD),
        })),
      };
    } catch (error) {
      return { error: `Failed to get tick liquidity: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// get_liquidity_events — Mints + Burns (liquidity flow signals)
// ============================================================================

export const getLiquidityEventsTool = createTool({
  id: "get_liquidity_events",
  description:
    "Get recent liquidity additions (mints) and removals (burns) for a Uniswap pool. " +
    "Large mints signal confidence; large burns may signal exit. " +
    "Use for detecting smart money flows, liquidity rug risk, and LP sentiment.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'ETHUSDC', 'UNIUSDC')"),
    limit: z.number().min(1).max(100).default(20).describe("Number of events per type"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    mints: z.array(z.object({
      timestamp: z.number(),
      amountUSD: z.number(),
      amount0: z.number(),
      amount1: z.number(),
      owner: z.string(),
      tickLower: z.number(),
      tickUpper: z.number(),
    })).optional(),
    burns: z.array(z.object({
      timestamp: z.number(),
      amountUSD: z.number(),
      amount0: z.number(),
      amount1: z.number(),
      owner: z.string(),
      tickLower: z.number(),
      tickUpper: z.number(),
    })).optional(),
    netFlowUSD: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }, execContext: MastraExecutionContext) => {
    const result = getSubgraph(execContext);
    if ("error" in result) return result;

    try {
      const [mints, burns] = await Promise.all([
        result.subgraph.getMints(symbol, limit),
        result.subgraph.getBurns(symbol, limit),
      ]);

      const mintFlow = mints.reduce((sum, m) => sum + parseFloat(m.amountUSD), 0);
      const burnFlow = burns.reduce((sum, b) => sum + parseFloat(b.amountUSD), 0);

      return {
        symbol,
        mints: mints.map((m) => ({
          timestamp: parseInt(m.timestamp, 10) * 1000,
          amountUSD: parseFloat(m.amountUSD),
          amount0: parseFloat(m.amount0),
          amount1: parseFloat(m.amount1),
          owner: m.owner,
          tickLower: parseInt(m.tickLower, 10),
          tickUpper: parseInt(m.tickUpper, 10),
        })),
        burns: burns.map((b) => ({
          timestamp: parseInt(b.timestamp, 10) * 1000,
          amountUSD: parseFloat(b.amountUSD),
          amount0: parseFloat(b.amount0),
          amount1: parseFloat(b.amount1),
          owner: b.owner,
          tickLower: parseInt(b.tickLower, 10),
          tickUpper: parseInt(b.tickUpper, 10),
        })),
        netFlowUSD: mintFlow - burnFlow,
      };
    } catch (error) {
      return { error: `Failed to get liquidity events: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// get_pool_flash_events — Flash loan activity
// ============================================================================

export const getPoolFlashEventsTool = createTool({
  id: "get_pool_flash_events",
  description:
    "Get recent flash loan events for a Uniswap pool. " +
    "Flash loans can indicate arbitrage activity or potential manipulation. " +
    "Large or frequent flash loans around a token may signal price instability.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'ETHUSDC')"),
    limit: z.number().min(1).max(100).default(20).describe("Number of events to return"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    count: z.number().optional(),
    totalAmountUSD: z.number().optional(),
    events: z.array(z.object({
      timestamp: z.number(),
      amountUSD: z.number(),
      amount0: z.number(),
      amount1: z.number(),
      amount0Paid: z.number(),
      amount1Paid: z.number(),
      sender: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }, execContext: MastraExecutionContext) => {
    const result = getSubgraph(execContext);
    if ("error" in result) return result;

    try {
      const flashes = await result.subgraph.getFlashLoans(symbol, limit);
      const totalUSD = flashes.reduce((sum, f) => sum + parseFloat(f.amountUSD), 0);

      return {
        symbol,
        count: flashes.length,
        totalAmountUSD: totalUSD,
        events: flashes.map((f) => ({
          timestamp: parseInt(f.timestamp, 10) * 1000,
          amountUSD: parseFloat(f.amountUSD),
          amount0: parseFloat(f.amount0),
          amount1: parseFloat(f.amount1),
          amount0Paid: parseFloat(f.amount0Paid),
          amount1Paid: parseFloat(f.amount1Paid),
          sender: f.sender,
        })),
      };
    } catch (error) {
      return { error: `Failed to get flash events: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// get_lp_positions — LP positions by wallet
// ============================================================================

export const getLpPositionsTool = createTool({
  id: "get_lp_positions",
  description:
    "Get active Uniswap V3 LP positions for a wallet address. " +
    "Shows pools, price ranges, liquidity amounts, deposited/withdrawn tokens, and collected fees. " +
    "Use for portfolio monitoring of LP positions.",
  inputSchema: z.object({
    owner: z.string().describe("Wallet address (0x...)"),
    limit: z.number().min(1).max(100).default(20).describe("Max positions to return"),
  }),
  outputSchema: z.object({
    owner: z.string().optional(),
    positionCount: z.number().optional(),
    positions: z.array(z.object({
      id: z.string(),
      pool: z.string(),
      token0: z.string(),
      token1: z.string(),
      tickLower: z.number(),
      tickUpper: z.number(),
      liquidity: z.string(),
      depositedToken0: z.number(),
      depositedToken1: z.number(),
      withdrawnToken0: z.number(),
      withdrawnToken1: z.number(),
      collectedFeesToken0: z.number(),
      collectedFeesToken1: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ owner, limit }, execContext: MastraExecutionContext) => {
    const result = getSubgraph(execContext);
    if ("error" in result) return result;

    try {
      const positions = await result.subgraph.getPositions(owner, limit);

      return {
        owner,
        positionCount: positions.length,
        positions: positions.map((p) => ({
          id: p.id,
          pool: p.pool.id,
          token0: `${p.token0.symbol} (${p.token0.id.slice(0, 10)}...)`,
          token1: `${p.token1.symbol} (${p.token1.id.slice(0, 10)}...)`,
          tickLower: parseInt(p.tickLower.tickIdx, 10),
          tickUpper: parseInt(p.tickUpper.tickIdx, 10),
          liquidity: p.liquidity,
          depositedToken0: parseFloat(p.depositedToken0),
          depositedToken1: parseFloat(p.depositedToken1),
          withdrawnToken0: parseFloat(p.withdrawnToken0),
          withdrawnToken1: parseFloat(p.withdrawnToken1),
          collectedFeesToken0: parseFloat(p.collectedFeesToken0),
          collectedFeesToken1: parseFloat(p.collectedFeesToken1),
        })),
      };
    } catch (error) {
      return { error: `Failed to get LP positions: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// get_uniswap_protocol_overview — ETH price + factory stats + daily data
// ============================================================================

export const getProtocolOverviewTool = createTool({
  id: "get_uniswap_protocol_overview",
  description:
    "Get Uniswap V3 protocol-wide metrics: ETH/USD price, total pools, total volume, " +
    "total fees, TVL, and recent daily data. Use for protocol health assessment, " +
    "DeFi market overview, and macro trend analysis.",
  inputSchema: z.object({
    days: z.number().min(1).max(90).default(7).describe("Number of days of daily data to include"),
  }),
  outputSchema: z.object({
    ethPriceUSD: z.number().optional(),
    factory: z.object({
      poolCount: z.number(),
      totalVolumeUSD: z.number(),
      totalFeesUSD: z.number(),
      totalValueLockedUSD: z.number(),
    }).optional(),
    dailyData: z.array(z.object({
      date: z.number(),
      volumeUSD: z.number(),
      feesUSD: z.number(),
      tvlUSD: z.number(),
      txCount: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ days }, execContext: MastraExecutionContext) => {
    const result = getSubgraph(execContext);
    if ("error" in result) return result;

    try {
      const [ethPrice, factory, dayData] = await Promise.all([
        result.subgraph.getEthPrice(),
        result.subgraph.getFactory(),
        result.subgraph.getProtocolDayData(days),
      ]);

      return {
        ethPriceUSD: ethPrice,
        factory: factory ? {
          poolCount: parseInt(factory.poolCount, 10),
          totalVolumeUSD: parseFloat(factory.totalVolumeUSD),
          totalFeesUSD: parseFloat(factory.totalFeesUSD),
          totalValueLockedUSD: parseFloat(factory.totalValueLockedUSD),
        } : undefined,
        dailyData: dayData.map((d) => ({
          date: d.date * 1000,
          volumeUSD: parseFloat(d.volumeUSD),
          feesUSD: parseFloat(d.feesUSD),
          tvlUSD: parseFloat(d.tvlUSD),
          txCount: parseInt(d.txCount, 10),
        })),
      };
    } catch (error) {
      return { error: `Failed to get protocol overview: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// get_fee_collections — Collect events (fee harvesting)
// ============================================================================

export const getFeeCollectionsTool = createTool({
  id: "get_fee_collections",
  description:
    "Get recent fee collection events for a Uniswap pool. " +
    "Shows when LPs harvest their earned fees. Useful for tracking LP profitability " +
    "and identifying wallets actively managing their positions.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'ETHUSDC')"),
    limit: z.number().min(1).max(100).default(20).describe("Number of events to return"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    count: z.number().optional(),
    totalFeesUSD: z.number().optional(),
    events: z.array(z.object({
      timestamp: z.number(),
      amountUSD: z.number(),
      amount0: z.number(),
      amount1: z.number(),
      owner: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }, execContext: MastraExecutionContext) => {
    const result = getSubgraph(execContext);
    if ("error" in result) return result;

    try {
      const collects = await result.subgraph.getCollects(symbol, limit);
      const totalUSD = collects.reduce((sum, c) => sum + parseFloat(c.amountUSD), 0);

      return {
        symbol,
        count: collects.length,
        totalFeesUSD: totalUSD,
        events: collects.map((c) => ({
          timestamp: parseInt(c.timestamp, 10) * 1000,
          amountUSD: parseFloat(c.amountUSD),
          amount0: parseFloat(c.amount0),
          amount1: parseFloat(c.amount1),
          owner: c.owner,
        })),
      };
    } catch (error) {
      return { error: `Failed to get fee collections: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

// No createCachedTool wrapper — the subgraph client caches internally
// with per-method TTLs (1-5 min). Double-caching wastes memory.
export const uniswapDataTools = {
  get_pool_tick_liquidity: getPoolTickLiquidityTool,
  get_liquidity_events: getLiquidityEventsTool,
  get_pool_flash_events: getPoolFlashEventsTool,
  get_lp_positions: getLpPositionsTool,
  get_uniswap_protocol_overview: getProtocolOverviewTool,
  get_fee_collections: getFeeCollectionsTool,
};
