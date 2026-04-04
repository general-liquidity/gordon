// ============================================================================
// Close Command — Close an open position
//
// Usage: /close <symbol>                — close at market
//        /close <symbol> limit <price>  — close at limit price
//        /close all                     — close all positions
// ============================================================================

export interface CloseResult {
  closed: number;
  failed: number;
  details: Array<{ symbol: string; side: string; quantity: number; price?: number; status: "closed" | "failed"; error?: string }>;
}

export async function handleCloseCommand(
  args: string,
  runtime: any,
): Promise<CloseResult> {
  const parts = args.trim().split(/\s+/);
  const target = parts[0]?.toUpperCase();

  if (!target) {
    return { closed: 0, failed: 0, details: [{ symbol: "", side: "", quantity: 0, status: "failed", error: "Usage: /close <symbol|all> [limit <price>]" }] };
  }

  try {
    const state = runtime?.getState?.();
    const exchange = state?.session?.exchange;

    if (!exchange) {
      return { closed: 0, failed: 0, details: [{ symbol: "", side: "", quantity: 0, status: "failed", error: "No exchange connected" }] };
    }

    // Parse order type
    const isLimit = parts[1]?.toLowerCase() === "limit";
    const limitPrice = isLimit ? parseFloat(parts[2] ?? "0") : undefined;

    if (target === "ALL") {
      // Close all positions
      const positions = await exchange.getPositions?.() ?? [];
      const results: CloseResult["details"] = [];

      for (const pos of positions) {
        try {
          const closeSide = pos.side === "long" ? "sell" : "buy";
          await exchange.placeOrder(pos.symbol, closeSide, isLimit ? "limit" : "market", pos.quantity, limitPrice);
          results.push({ symbol: pos.symbol, side: closeSide, quantity: pos.quantity, price: limitPrice, status: "closed" });
        } catch (err) {
          results.push({ symbol: pos.symbol, side: "", quantity: pos.quantity, status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
      }

      return {
        closed: results.filter((r) => r.status === "closed").length,
        failed: results.filter((r) => r.status === "failed").length,
        details: results,
      };
    }

    // Close specific symbol
    const positions = await exchange.getPositions?.() ?? [];
    const pos = positions.find((p: any) => p.symbol.toUpperCase().includes(target));

    if (!pos) {
      return { closed: 0, failed: 1, details: [{ symbol: target, side: "", quantity: 0, status: "failed", error: `No open position for ${target}` }] };
    }

    const closeSide = pos.side === "long" ? "sell" : "buy";
    await exchange.placeOrder(pos.symbol, closeSide, isLimit ? "limit" : "market", pos.quantity, limitPrice);

    return { closed: 1, failed: 0, details: [{ symbol: pos.symbol, side: closeSide, quantity: pos.quantity, price: limitPrice, status: "closed" }] };
  } catch (err) {
    return { closed: 0, failed: 1, details: [{ symbol: target, side: "", quantity: 0, status: "failed", error: err instanceof Error ? err.message : String(err) }] };
  }
}
