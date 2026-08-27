/**
 * LLM Enrichment for Quote Data
 *
 * Takes raw quote data and optional candle history, calls the LLM
 * to produce structured market insights (trend, momentum, volume
 * assessment, and a short summary). Results are cached for 5 minutes.
 */

import { Cache } from "../../platform/cache/cache.ts";
import { createModuleLogger } from "../../logger/index.ts";
import type { LLMClient } from "../../ai/llm/client.ts";
import type { Candle } from "../../../types/index.ts";

const logger = createModuleLogger("llm-enrichment");

// ============================================================================
// Types
// ============================================================================

export type TrendDirection = "up" | "down" | "sideways";
export type Momentum = "strong" | "moderate" | "weak";
export type VolumeAssessment = "above_average" | "average" | "below_average";

export interface LLMEnrichment {
  trendDirection: TrendDirection;
  momentum: Momentum;
  volumeAssessment: VolumeAssessment;
  summary: string;
}

export interface BaseQuote {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

// ============================================================================
// Cache (5-minute TTL per symbol)
// ============================================================================

const enrichmentCache = new Cache<LLMEnrichment>({
  defaultTtl: 5 * 60 * 1000, // 5 minutes
  maxEntries: 200,
  updateTtlOnAccess: false,
});

// ============================================================================
// Prompt Builder
// ============================================================================

function buildPrompt(quote: BaseQuote, candles?: Candle[]): string {
  let candleSection = "";

  if (candles && candles.length > 0) {
    const recentCloses = candles
      .slice(-10)
      .map((c) => `$${c.close.toFixed(2)}`)
      .join(", ");
    candleSection = `\nRecent price action (last 10 candle closes): [${recentCloses}].`;
  }

  return (
    `Given this market data for ${quote.symbol}: ` +
    `price $${quote.price.toFixed(2)}, ` +
    `24h change ${quote.changePercent24h >= 0 ? "+" : ""}${quote.changePercent24h.toFixed(2)}%, ` +
    `24h volume $${formatVolume(quote.volume24h)}, ` +
    `24h high $${quote.high24h.toFixed(2)}, ` +
    `24h low $${quote.low24h.toFixed(2)}.` +
    candleSection +
    `\n\nProvide:\n` +
    `1) trend direction (up/down/sideways)\n` +
    `2) momentum (strong/moderate/weak)\n` +
    `3) volume assessment (above_average/average/below_average)\n` +
    `4) 1-sentence market summary\n\n` +
    `Respond ONLY with valid JSON in this exact format:\n` +
    `{"trendDirection":"up|down|sideways","momentum":"strong|moderate|weak","volumeAssessment":"above_average|average|below_average","summary":"..."}`
  );
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toFixed(0);
}

// ============================================================================
// Response Parser
// ============================================================================

const VALID_TRENDS: TrendDirection[] = ["up", "down", "sideways"];
const VALID_MOMENTUM: Momentum[] = ["strong", "moderate", "weak"];
const VALID_VOLUME: VolumeAssessment[] = ["above_average", "average", "below_average"];

function parseEnrichmentResponse(content: string): LLMEnrichment | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const trendDirection = parsed.trendDirection as string;
    const momentum = parsed.momentum as string;
    const volumeAssessment = parsed.volumeAssessment as string;
    const summary = parsed.summary as string;

    if (
      !VALID_TRENDS.includes(trendDirection as TrendDirection) ||
      !VALID_MOMENTUM.includes(momentum as Momentum) ||
      !VALID_VOLUME.includes(volumeAssessment as VolumeAssessment) ||
      typeof summary !== "string" ||
      summary.length === 0
    ) {
      logger.warn("LLM enrichment response failed validation", {
        trendDirection,
        momentum,
        volumeAssessment,
      });
      return null;
    }

    return {
      trendDirection: trendDirection as TrendDirection,
      momentum: momentum as Momentum,
      volumeAssessment: volumeAssessment as VolumeAssessment,
      summary,
    };
  } catch (error) {
    logger.warn("Failed to parse LLM enrichment response", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Enrich a base quote with LLM-generated market insights.
 *
 * - Checks cache first (5-minute TTL per symbol).
 * - Builds a structured prompt from market data + optional candles.
 * - Parses the LLM response into validated LLMEnrichment.
 * - Returns null gracefully if the LLM is unavailable or parsing fails.
 */
export async function enrichQuoteWithLLM(
  llmClient: LLMClient,
  quote: BaseQuote,
  candles?: Candle[],
): Promise<LLMEnrichment | null> {
  const cacheKey = `enrichment:${quote.symbol.toUpperCase()}`;

  // Check cache
  const cached = enrichmentCache.get(cacheKey);
  if (cached) {
    logger.debug("Returning cached LLM enrichment", { symbol: quote.symbol });
    return cached;
  }

  try {
    const prompt = buildPrompt(quote, candles);

    const response = await llmClient.chat([
      {
        role: "system",
        content: "You are a concise market analyst. Respond only with the requested JSON.",
      },
      { role: "user", content: prompt },
    ]);

    const enrichment = parseEnrichmentResponse(response.content);

    if (enrichment) {
      enrichmentCache.set(cacheKey, enrichment);
      logger.debug("LLM enrichment successful", { symbol: quote.symbol });
    }

    return enrichment;
  } catch (error) {
    logger.warn("LLM enrichment failed, returning null", {
      symbol: quote.symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
