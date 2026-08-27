import type {
  Balance,
  Exchange,
  ExchangeDerivatives,
  Order,
  Position,
} from "../../exchange/types.ts";

export type CancellationExposure = "reduces_risk" | "removes_protection" | "unknown";

type CancellationOrder = Pick<
  Order,
  "orderId" | "symbol" | "side" | "type" | "quantity" | "executedQty"
>;

type PositionBalance = Pick<Balance, "asset" | "total">;

export type CancellationMarketContext =
  | { market: "spot" }
  | { market: "derivative"; position: Pick<Position, "side" | "contracts" | "contractSize"> | null }
  | { market: "unknown" };

function baseAssetFor(symbol: string, balances: readonly PositionBalance[]): string | null {
  const normalized = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const candidates = balances
    .map((balance) => balance.asset.toUpperCase())
    .filter((asset) => asset.length > 0 && normalized.startsWith(asset))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

function normalizedSymbol(symbol: string | undefined): string {
  return (symbol ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Spot-exchange cancellation classification. A BUY creates long exposure, so
 * removing it is risk-reducing. A SELL is protective only when a current long
 * can cover its entire unfilled quantity. Anything the adapter cannot prove is
 * unknown and remains consent-gated.
 */
export function classifyCancellationExposure(
  order: CancellationOrder,
  balances: readonly PositionBalance[],
  context: CancellationMarketContext = { market: "unknown" },
): CancellationExposure {
  const remaining = order.quantity - order.executedQty;
  if (!Number.isFinite(remaining) || remaining <= 0) return "unknown";
  if (context.market === "unknown") return "unknown";

  if (context.market === "derivative") {
    const position = context.position;
    if (!position) return "reduces_risk";
    // CCXT order `amount` and unified position `contracts` are both expressed
    // in contracts. contractSize converts contracts to base units/notional and
    // must not be applied to only one side of this comparison.
    const size = Math.abs(position.contracts);
    if (!Number.isFinite(size) || size <= 0) return "unknown";
    const exitSide = position.side === "short" ? "BUY" : "SELL";
    if (order.side !== exitSide) return "reduces_risk";
    return remaining <= size ? "removes_protection" : "unknown";
  }

  if (order.side === "BUY") return "reduces_risk";
  if (order.side !== "SELL") return "unknown";

  const baseAsset = baseAssetFor(order.symbol, balances);
  if (!baseAsset) return "unknown";
  const held = balances
    .filter((balance) => balance.asset.toUpperCase() === baseAsset)
    .reduce((sum, balance) => sum + balance.total, 0);
  return Number.isFinite(held) && held >= remaining ? "removes_protection" : "unknown";
}

export async function inspectCancellationMarket(
  exchange: Exchange,
  symbol: string,
): Promise<{ balances: PositionBalance[]; context: CancellationMarketContext }> {
  const account = await exchange.getFullAccountDetails();
  const accountType = account.accountInfo?.accountType?.trim().toLowerCase() ?? "";
  const marketTypeReader = exchange.getMarketType;
  let declaredMarket: "spot" | "derivative" | "unknown" = "unknown";
  if (typeof marketTypeReader === "function") {
    try {
      declaredMarket = await marketTypeReader.call(exchange, symbol);
    } catch {
      declaredMarket = "unknown";
    }
  }
  if (declaredMarket === "spot" && (accountType === "spot" || accountType === "cash")) {
    return { balances: account.nonZeroBalances, context: { market: "spot" } };
  }
  const supports = (exchange as Exchange & { supports?: (method: string) => boolean }).supports;
  const derivatives = exchange as Partial<ExchangeDerivatives>;
  const fetchPositions = derivatives.fetchPositions;
  const supportsAllPositions =
    typeof fetchPositions === "function" &&
    (typeof supports !== "function" || supports.call(exchange, "fetchPositions"));
  if (supportsAllPositions) {
    try {
      const targetSymbol = normalizedSymbol(symbol);
      const positions = (await fetchPositions.call(exchange, [symbol])).filter(
        (position) =>
          normalizedSymbol(position.symbol) === targetSymbol &&
          Number.isFinite(position.contracts) &&
          Math.abs(position.contracts) > 0,
      );
      // Hedge mode can expose simultaneous long and short legs. A singular
      // answer would hide one protective direction, so only one nonzero leg
      // is sufficiently unambiguous for consent-free cancellation.
      if (positions.length !== 1) {
        return { balances: account.nonZeroBalances, context: { market: "unknown" } };
      }
      const position = positions[0]!;
      return {
        balances: account.nonZeroBalances,
        context: {
          market: "derivative",
          position: {
            side: position.side,
            contracts: position.contracts,
            contractSize: position.contractSize,
          },
        },
      };
    } catch {
      return { balances: account.nonZeroBalances, context: { market: "unknown" } };
    }
  }
  // Never fall back to singular fetchPosition for a derivative surface. In
  // hedge mode it can hide the opposed leg, so a BUY cancellation that appears
  // to remove long-entry risk may actually remove protection from a short.
  // Without an all-positions view (or explicit one-way-mode proof), consent is
  // the only safe answer.
  if (declaredMarket === "derivative") {
    return { balances: account.nonZeroBalances, context: { market: "unknown" } };
  }
  // CcxtAdapter implements fetchPosition on the wrapper class even for a spot
  // connection. Its `supports` result comes from the underlying CCXT venue and
  // is therefore stronger evidence than method presence. Only a spot/cash
  // account with no derivative lookup capability is proven spot; a flat
  // derivative-capable connection remains unknown above.
  if (
    typeof marketTypeReader !== "function" &&
    (accountType === "spot" || accountType === "cash")
  ) {
    return { balances: account.nonZeroBalances, context: { market: "spot" } };
  }
  return { balances: account.nonZeroBalances, context: { market: "unknown" } };
}
