/**
 * Gordon Response Schemas
 * Zod schemas for structured agent output via Mastra's structuredOutput API.
 */

import { z } from "zod";

import {
  jsonSchemaToZod,
  type JsonSchema,
} from "../tools/structuredOutput/jsonSchemaToZod.ts";

/** Individual trade signal from scan or analysis */
export const TradeSignalSchema = z.object({
  symbol: z.string(),
  direction: z.enum(["long", "short", "neutral"]),
  confidence: z.number().min(0).max(1),
  entry: z.number().optional(),
  stopLoss: z.number().optional(),
  targets: z.array(z.number()).optional(),
  timeframe: z.string().optional(),
  reasoning: z.string(),
});
export type TradeSignal = z.infer<typeof TradeSignalSchema>;

/** Market scan result with multiple signals */
export const MarketScanResultSchema = z.object({
  summary: z.string(),
  signals: z.array(TradeSignalSchema),
  marketSentiment: z.enum(["bullish", "bearish", "neutral", "mixed"]),
  topOpportunity: TradeSignalSchema.optional(),
});
export type MarketScanResult = z.infer<typeof MarketScanResultSchema>;

/** Coin analysis result */
export const AnalysisResultSchema = z.object({
  symbol: z.string(),
  sentiment: z.enum(["bullish", "bearish", "neutral"]),
  keyLevels: z.object({
    support: z.array(z.number()),
    resistance: z.array(z.number()),
  }),
  recommendation: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/** Portfolio status overview */
export const PortfolioStatusSchema = z.object({
  totalValue: z.number(),
  pnl: z.number(),
  pnlPercent: z.number(),
  positions: z.array(
    z.object({
      symbol: z.string(),
      side: z.enum(["long", "short"]),
      size: z.number(),
      entryPrice: z.number(),
      currentPrice: z.number(),
      pnl: z.number(),
      pnlPercent: z.number(),
    }),
  ),
  riskExposure: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});
export type PortfolioStatus = z.infer<typeof PortfolioStatusSchema>;

/** Generic agent decision for autonomous/event-driven processing */
export const AgentDecisionSchema = z.object({
  action: z.enum(["execute", "monitor", "alert", "ignore"]),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

/** Schema name → schema lookup for gateway/API usage */
export const RESPONSE_SCHEMAS: Record<string, z.ZodSchema> = {
  tradeSignal: TradeSignalSchema,
  marketScan: MarketScanResultSchema,
  analysis: AnalysisResultSchema,
  portfolioStatus: PortfolioStatusSchema,
  agentDecision: AgentDecisionSchema,
};

export function getSchemaByName(name: string): z.ZodSchema | undefined {
  return RESPONSE_SCHEMAS[name];
}

/**
 * Resolve the Zod schema for a structured-message run from either a built-in
 * NAMED schema (`schemaName`) or an ARBITRARY caller-supplied JSON Schema
 * (`jsonSchema`, compiled via {@link jsonSchemaToZod}). This is what lets a
 * headless / SDK caller pass any output shape per run instead of only the five
 * built-ins, while reusing the existing `processStructuredMessage` path.
 *
 * Throws on: neither provided · unknown `schemaName` · uncompilable `jsonSchema`.
 */
export function resolveStructuredSchema(payload: {
  schemaName?: string;
  jsonSchema?: unknown;
}): z.ZodSchema {
  if (payload.jsonSchema != null) {
    try {
      return jsonSchemaToZod(payload.jsonSchema as JsonSchema) as z.ZodSchema;
    } catch (e) {
      throw new Error(`Invalid jsonSchema: ${(e as Error).message}`);
    }
  }
  if (payload.schemaName) {
    const named = getSchemaByName(payload.schemaName);
    if (!named) {
      throw new Error(
        `Unknown schema: "${payload.schemaName}". Available: ${Object.keys(
          RESPONSE_SCHEMAS,
        ).join(", ")} — or pass jsonSchema for an arbitrary shape.`,
      );
    }
    return named;
  }
  throw new Error(
    "structured_message requires either schemaName or jsonSchema.",
  );
}
