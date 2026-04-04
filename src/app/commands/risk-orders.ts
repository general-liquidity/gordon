// ============================================================================
// Risk Orders — Stop-loss and take-profit handlers
//
// Usage: /stop-loss <symbol> <price>   — set stop-loss
//        /take-profit <symbol> <price> — set take-profit
// ============================================================================

export interface RiskOrderResult {
  success: boolean;
  symbol: string;
  type: "stop-loss" | "take-profit";
  price: number;
  error?: string;
}

export async function handleStopLossCommand(
  args: string,
  runtime: any,
): Promise<RiskOrderResult> {
  const parts = args.trim().split(/\s+/);
  const symbol = parts[0]?.toUpperCase();
  const price = parseFloat(parts[1] ?? "0");

  if (!symbol || !price || isNaN(price)) {
    return { success: false, symbol: symbol ?? "", type: "stop-loss", price: 0, error: "Usage: /stop-loss <symbol> <price>" };
  }

  try {
    const state = runtime?.getState?.();
    const exchange = state?.session?.exchange;

    if (!exchange) {
      return { success: false, symbol, type: "stop-loss", price, error: "No exchange connected" };
    }

    // Place a stop-loss order (sell stop for long, buy stop for short)
    const positions = await exchange.getPositions?.() ?? [];
    const pos = positions.find((p: any) => p.symbol.toUpperCase().includes(symbol));

    if (!pos) {
      return { success: false, symbol, type: "stop-loss", price, error: `No open position for ${symbol}` };
    }

    const stopSide = pos.side === "long" ? "sell" : "buy";
    await exchange.placeOrder(pos.symbol, stopSide, "stop", pos.quantity, price);

    return { success: true, symbol: pos.symbol, type: "stop-loss", price };
  } catch (err) {
    return { success: false, symbol, type: "stop-loss", price, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleTakeProfitCommand(
  args: string,
  runtime: any,
): Promise<RiskOrderResult> {
  const parts = args.trim().split(/\s+/);
  const symbol = parts[0]?.toUpperCase();
  const price = parseFloat(parts[1] ?? "0");

  if (!symbol || !price || isNaN(price)) {
    return { success: false, symbol: symbol ?? "", type: "take-profit", price: 0, error: "Usage: /take-profit <symbol> <price>" };
  }

  try {
    const state = runtime?.getState?.();
    const exchange = state?.session?.exchange;

    if (!exchange) {
      return { success: false, symbol, type: "take-profit", price, error: "No exchange connected" };
    }

    const positions = await exchange.getPositions?.() ?? [];
    const pos = positions.find((p: any) => p.symbol.toUpperCase().includes(symbol));

    if (!pos) {
      return { success: false, symbol, type: "take-profit", price, error: `No open position for ${symbol}` };
    }

    const tpSide = pos.side === "long" ? "sell" : "buy";
    await exchange.placeOrder(pos.symbol, tpSide, "limit", pos.quantity, price);

    return { success: true, symbol: pos.symbol, type: "take-profit", price };
  } catch (err) {
    return { success: false, symbol, type: "take-profit", price, error: err instanceof Error ? err.message : String(err) };
  }
}
