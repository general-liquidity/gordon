/**
 * Shared helper: backfill the markdown ticker registry from an
 * ExchangeInfo response so every base/quote asset the venue lists
 * colors correctly when mentioned in chat. Each adapter calls this
 * inside its getExchangeInfo before returning.
 */

import type { ExchangeInfo } from "../types.ts";
import { registerSymbols } from "../../../tui/components/markdownPalette.ts";

export function registerExchangeInfoSymbols(info: ExchangeInfo): void {
  registerSymbols(info.symbols.flatMap((s) => [s.baseAsset, s.quoteAsset]));
}
