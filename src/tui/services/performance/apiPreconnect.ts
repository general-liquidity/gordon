// ============================================================================
// API Preconnect — TCP+TLS warmup during boot
//
// Fire-and-forget HEAD requests for connection pool warming.
// Best-effort, catches and ignores all errors.
// ============================================================================

export function preconnectToEndpoints(endpoints: string[]): void {
  for (const url of endpoints) {
    fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Best effort — ignore all errors
    });
  }
}

export function preconnectExchanges(): void {
  preconnectToEndpoints([
    "https://api.binance.com/api/v3/ping",
    "https://api.binance.us/api/v3/ping",
    "https://api.coinbase.com/v2/time",
    "https://api.kraken.com/0/public/Time",
    "https://api.hyperliquid.xyz/info",
    "https://api-pub.bitfinex.com/v2/platform/status",
    "https://api.anthropic.com/v1/messages",
  ]);
}
