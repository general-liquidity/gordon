/**
 * HIP3AssetBrowser — Browse HIP-3 builder-deployed perp assets
 *
 * Categories: Stocks, Commodities, Indices.
 * Each row: symbol + price + 24h change + funding rate + open interest.
 * Arrow keys navigate, Enter to trade, Escape to close.
 *
 * Pattern: matches IndicatorBrowser (grouped list with descriptions).
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../design-system/Pane.js";
import {
  HIP3_ASSETS,
  HIP3_CATEGORIES,
  getAllHIP3Quotes,
} from "../../infra/hyperliquid/hip3.ts";
import type {
  HIP3CategorizedAsset,
  HIP3AssetCategory,
  HIP3Quote,
} from "../../infra/hyperliquid/hip3-types.ts";

// ============================================================================
// Types
// ============================================================================

export interface HIP3TradeRequest {
  symbol: string;
  price: number;
  builder: string;
  collateral: string;
  maxLeverage: number;
}

interface Props {
  onSelect?: (request: HIP3TradeRequest) => void;
  onClose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_COLOR: Record<HIP3AssetCategory, string> = {
  Stocks: "cyan",
  Commodities: "yellow",
  Indices: "magenta",
};

const REFRESH_INTERVAL_MS = 15000;

// ============================================================================
// Helpers
// ============================================================================

interface FlatEntry {
  type: "header" | "asset";
  category?: HIP3AssetCategory;
  count?: number;
  asset?: HIP3CategorizedAsset;
}

function buildFlatList(): FlatEntry[] {
  const entries: FlatEntry[] = [];
  for (const cat of HIP3_CATEGORIES) {
    const items = [...HIP3_ASSETS.values()].filter((a) => a.category === cat);
    entries.push({ type: "header", category: cat, count: items.length });
    for (const asset of items) {
      entries.push({ type: "asset", asset });
    }
  }
  return entries;
}

function selectableIndices(entries: FlatEntry[]): number[] {
  return entries
    .map((e, i) => (e.type === "asset" ? i : -1))
    .filter((i) => i >= 0);
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function formatPrice(price: number): string {
  if (price === 0) return "-";
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatChange(current: number, prev: number): { text: string; color: string } {
  if (prev === 0 || current === 0) return { text: "   -   ", color: "white" };
  const pct = ((current - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "green" : "red";
  return { text: `${sign}${pct.toFixed(2)}%`, color };
}

function formatFunding(rate: number): { text: string; color: string } {
  if (rate === 0) return { text: "0.0000%", color: "white" };
  const pct = rate * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "green" : "red";
  return { text: `${sign}${pct.toFixed(4)}%`, color };
}

function formatOI(oi: number): string {
  if (oi === 0) return "-";
  if (oi >= 1e9) return `${(oi / 1e9).toFixed(2)}B`;
  if (oi >= 1e6) return `${(oi / 1e6).toFixed(2)}M`;
  if (oi >= 1e3) return `${(oi / 1e3).toFixed(1)}K`;
  return oi.toFixed(0);
}

// ============================================================================
// Component
// ============================================================================

export function HIP3AssetBrowser({ onSelect, onClose }: Props) {
  const flatList = useMemo(() => buildFlatList(), []);
  const selectable = useMemo(() => selectableIndices(flatList), [flatList]);
  const [cursor, setCursor] = useState(0);
  const [quotes, setQuotes] = useState<Map<string, HIP3Quote>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch quotes on mount and periodically
  useEffect(() => {
    let mounted = true;

    async function fetchQuotes() {
      try {
        const q = await getAllHIP3Quotes();
        if (mounted) {
          setQuotes(q);
          setLoading(false);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setLoading(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void fetchQuotes();
    const interval = setInterval(() => void fetchQuotes(), REFRESH_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(selectable.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const idx = selectable[cursor];
      const entry = flatList[idx];
      if (entry?.asset && onSelect) {
        const quote = quotes.get(entry.asset.symbol);
        onSelect({
          symbol: entry.asset.symbol,
          price: quote?.price ?? 0,
          builder: entry.asset.builder,
          collateral: entry.asset.collateral,
          maxLeverage: entry.asset.maxLeverage,
        });
      }
    }
  });

  const selectedFlatIdx = selectable[cursor];
  const focusedAsset = flatList[selectedFlatIdx]?.asset;
  const focusedQuote = focusedAsset ? quotes.get(focusedAsset.symbol) : undefined;
  const totalAssets = HIP3_ASSETS.size;

  return (
    <Pane title="HIP-3 ASSET BROWSER" color="yellow">
      <Box>
        <Text dimColor>
          ({totalAssets} assets{" "}
          {loading ? "loading..." : error ? `error: ${error}` : "live"})
        </Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={3}>
        <Box width={10}>
          <Text bold dimColor>SYMBOL</Text>
        </Box>
        <Box width={14}>
          <Text bold dimColor>PRICE</Text>
        </Box>
        <Box width={10}>
          <Text bold dimColor>24H</Text>
        </Box>
        <Box width={12}>
          <Text bold dimColor>FUNDING</Text>
        </Box>
        <Box width={10}>
          <Text bold dimColor>OI</Text>
        </Box>
        <Box width={6}>
          <Text bold dimColor>LEV</Text>
        </Box>
      </Box>

      {/* List */}
      <Box flexDirection="column">
        {flatList.map((entry, i) => {
          if (entry.type === "header") {
            const catColor = CATEGORY_COLOR[entry.category!] ?? "white";
            return (
              <Box key={`hdr-${entry.category}`} marginTop={i > 0 ? 1 : 0}>
                <Text bold color={catColor}>
                  {entry.category!.toUpperCase()}
                </Text>
                <Text dimColor> ({entry.count})</Text>
              </Box>
            );
          }

          const asset = entry.asset!;
          const quote = quotes.get(asset.symbol);
          const isFocused = i === selectedFlatIdx;
          const pointer = isFocused ? "\u25B8 " : "  ";
          const catColor = CATEGORY_COLOR[asset.category] ?? "white";

          const price = quote ? formatPrice(quote.price) : "-";
          const change = quote
            ? formatChange(quote.price, quote.prevDayPrice)
            : { text: "   -   ", color: "white" };
          const funding = quote
            ? formatFunding(quote.fundingRate)
            : { text: "-", color: "white" };
          const oi = quote ? formatOI(quote.openInterest) : "-";

          return (
            <Box key={asset.symbol} paddingLeft={1}>
              <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
              <Box width={10}>
                <Text bold={isFocused} color={isFocused ? catColor : undefined}>
                  {padRight(asset.symbol, 10)}
                </Text>
              </Box>
              <Box width={14}>
                <Text>{padRight(price, 14)}</Text>
              </Box>
              <Box width={10}>
                <Text color={change.color}>{padRight(change.text, 10)}</Text>
              </Box>
              <Box width={12}>
                <Text color={funding.color}>{padRight(funding.text, 12)}</Text>
              </Box>
              <Box width={10}>
                <Text dimColor>{padRight(oi, 10)}</Text>
              </Box>
              <Box width={6}>
                <Text dimColor>{asset.maxLeverage}x</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Focused asset details */}
      {focusedAsset && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"\u2500".repeat(60)}</Text>
          <Box>
            <Text bold color={CATEGORY_COLOR[focusedAsset.category] ?? "white"}>
              {focusedAsset.displayName}
            </Text>
            <Text dimColor> {"\u00b7"} </Text>
            <Text>{focusedAsset.symbol}</Text>
            <Text dimColor> {"\u00b7"} </Text>
            <Text dimColor>Dex: </Text>
            <Text>{focusedAsset.builder}</Text>
            <Text dimColor> {"\u00b7"} </Text>
            <Text dimColor>Collateral: </Text>
            <Text>{focusedAsset.collateral}</Text>
          </Box>
          {focusedQuote && (
            <Box>
              <Text dimColor>Oracle: </Text>
              <Text>{formatPrice(focusedQuote.oraclePrice)}</Text>
              <Text dimColor> {"\u00b7"} Vol 24h: $</Text>
              <Text>{formatOI(focusedQuote.volume24h)}</Text>
            </Box>
          )}
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Enter trade {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
