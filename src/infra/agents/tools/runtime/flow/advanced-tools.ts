import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGordonContext, type MastraExecutionContext } from "../../types.ts";
import {
  simulateOrderBundle,
  generateCircuitBreakerProof,
  verifyCircuitBreakerProof,
  queryRegimeScopedMemory,
} from "../../../../../gateway/advanced/index.ts";
import { StrategyRuntime } from "../../../../../core/runtime/engine.ts";

export const simulateOrderBundleTool = createTool({
  id: "simulate_order_bundle",
  description:
    "Counterfactual execution twin: simulate an order bundle through risk/circuit checks before live submission.",
  inputSchema: z.object({
    orders: z.array(
      z.object({
        symbol: z.string(),
        side: z.enum(["BUY", "SELL"]),
        type: z.enum(["MARKET", "LIMIT", "STOP_LIMIT"]),
        quantity: z.number().positive(),
        price: z.number().positive().optional(),
      }),
    ).min(1).max(30),
  }),
  execute: async ({ orders }, execContext?: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx) {
      return { error: "Context not available." };
    }
    return simulateOrderBundle(orders, ctx);
  },
});

export const generateCircuitBreakerProofTool = createTool({
  id: "generate_circuit_breaker_proof",
  description:
    "Generate a machine-checkable commitment proof for baseline circuit breaker state.",
  inputSchema: z.object({
    correlationShockPercent: z.number().min(0).default(0),
    maxCorrelationShockPercent: z.number().positive().default(15),
    liquidityGapBps: z.number().min(0).default(0),
    maxLiquidityGapBps: z.number().positive().default(250),
  }),
  execute: async ({ correlationShockPercent, maxCorrelationShockPercent, liquidityGapBps, maxLiquidityGapBps }) => {
    const runtime = StrategyRuntime.getInstance();
    const state = runtime.getPortfolioState();
    return generateCircuitBreakerProof({
      portfolioDrawdownPercent: state.portfolio_drawdown_percent,
      maxPortfolioDrawdownPercent: 15,
      correlationShockPercent,
      maxCorrelationShockPercent,
      liquidityGapBps,
      maxLiquidityGapBps,
    });
  },
});

export const verifyCircuitBreakerProofTool = createTool({
  id: "verify_circuit_breaker_proof",
  description: "Verify integrity of a previously generated circuit breaker proof.",
  inputSchema: z.object({
    proof: z.object({
      generatedAt: z.string(),
      input: z.object({
        portfolioDrawdownPercent: z.number(),
        maxPortfolioDrawdownPercent: z.number(),
        correlationShockPercent: z.number(),
        maxCorrelationShockPercent: z.number(),
        liquidityGapBps: z.number(),
        maxLiquidityGapBps: z.number(),
      }),
      open: z.boolean(),
      triggers: z.array(
        z.object({
          name: z.string(),
          current: z.number(),
          threshold: z.number(),
          message: z.string(),
        }),
      ),
      commitment: z.string(),
    }),
  }),
  execute: async ({ proof }) => {
    return {
      valid: verifyCircuitBreakerProof(proof),
      commitment: proof.commitment,
    };
  },
});

export const queryRegimeScopedMemoryTool = createTool({
  id: "query_regime_scoped_memory",
  description:
    "Retrieve regime-scoped memory context for a symbol (decision history under similar market regimes).",
  inputSchema: z.object({
    symbol: z.string(),
    timeframe: z.string().default("1h"),
    query: z.string().optional(),
    limit: z.number().min(1).max(20).default(8),
  }),
  execute: async ({ symbol, timeframe, query, limit }) => {
    return queryRegimeScopedMemory({
      symbol,
      timeframe,
      query,
      limit,
    });
  },
});

export const advancedTools = {
  simulate_order_bundle: simulateOrderBundleTool,
  generate_circuit_breaker_proof: generateCircuitBreakerProofTool,
  verify_circuit_breaker_proof: verifyCircuitBreakerProofTool,
  query_regime_scoped_memory: queryRegimeScopedMemoryTool,
};

