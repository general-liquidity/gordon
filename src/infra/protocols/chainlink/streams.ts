/**
 * Chainlink Data Streams Client
 *
 * Sub-second institutional-grade crypto price feeds powered by the
 * official @chainlink/data-streams-sdk. Handles HMAC auth, report
 * decoding (V2-V13), retries, and error handling internally.
 *
 * Features over hand-rolled HMAC:
 * - Automatic HMAC authentication
 * - Multi-version report decoding (V2-V13)
 * - Built-in retries and typed errors
 * - WebSocket streaming support (via createStream)
 *
 * Required env vars: CHAINLINK_API_KEY, CHAINLINK_API_SECRET
 */

import {
  createClient,
  decodeReport as sdkDecodeReport,
  type DataStreamsClient,
} from "@chainlink/data-streams-sdk";

import {
  CHAINLINK_ENV_KEYS,
  STREAMS_BASE_URL,
  STREAMS_FEED_IDS,
  type StreamsReport,
} from "./types.ts";

// ============================================================================
// Configuration Check
// ============================================================================

/**
 * Check if Data Streams API is configured
 */
export function isStreamsConfigured(): boolean {
  return Boolean(
    process.env[CHAINLINK_ENV_KEYS.API_KEY] &&
    process.env[CHAINLINK_ENV_KEYS.API_SECRET]
  );
}

// ============================================================================
// Lazy Singleton Client
// ============================================================================

let _client: DataStreamsClient | null = null;

/**
 * Get or create the Data Streams SDK client
 */
function getClient(): DataStreamsClient {
  if (_client) return _client;

  if (!isStreamsConfigured()) {
    throw new Error(
      "Chainlink Data Streams not configured. Set CHAINLINK_API_KEY and CHAINLINK_API_SECRET environment variables."
    );
  }

  _client = createClient({
    apiKey: process.env[CHAINLINK_ENV_KEYS.API_KEY]!,
    userSecret: process.env[CHAINLINK_ENV_KEYS.API_SECRET]!,
    endpoint: STREAMS_BASE_URL,
    wsEndpoint: STREAMS_BASE_URL.replace("https://", "wss://").replace("api.", "ws."),
  });

  return _client;
}

// ============================================================================
// Feed ID Resolution
// ============================================================================

/**
 * Resolve a pair name (e.g., "BTC/USD") or raw feed ID to a feed ID
 */
function resolveFeedId(pairOrFeedId: string): string {
  if (pairOrFeedId.startsWith("0x")) return pairOrFeedId;

  const normalized = pairOrFeedId.toUpperCase().replace("-", "/");
  const pair = normalized.includes("/") ? normalized : `${normalized}/USD`;

  const feedId = STREAMS_FEED_IDS[pair];
  if (!feedId) {
    throw new Error(
      `Unknown feed pair "${pair}". Available: ${Object.keys(STREAMS_FEED_IDS).join(", ")}. ` +
      `You can also provide a raw feed ID (0x...).`
    );
  }
  return feedId;
}

/**
 * Find the pair name for a feed ID (reverse lookup)
 */
function feedIdToPair(feedId: string): string {
  for (const [pair, id] of Object.entries(STREAMS_FEED_IDS)) {
    if (id.toLowerCase() === feedId.toLowerCase()) return pair;
  }
  return feedId;
}

// ============================================================================
// Report Conversion
// ============================================================================

/**
 * Convert an SDK report response into our StreamsReport format
 */
function toStreamsReport(
  rawReport: { fullReport: string; feedID: string; observationsTimestamp?: number; validFromTimestamp?: number; },
  feedId: string,
): StreamsReport {
  // Decode the full report payload using the SDK's multi-version decoder
  const decoded = sdkDecodeReport(rawReport.fullReport, rawReport.feedID) as unknown as Record<string, unknown>;

  // Extract price fields — SDK returns bigint for V3 crypto streams
  const price = toNumber(decoded.price ?? decoded.benchmarkPrice ?? 0n, decoded.decimals);
  const bid = toNumber(decoded.bid ?? price, decoded.decimals);
  const ask = toNumber(decoded.ask ?? price, decoded.decimals);

  const timestamp = Number(decoded.observationsTimestamp ?? rawReport.observationsTimestamp ?? 0);
  const validFrom = Number(decoded.validFromTimestamp ?? rawReport.validFromTimestamp ?? timestamp);
  const expiresAt = Number(decoded.expiresAt ?? 0);

  return {
    feedId,
    pair: feedIdToPair(feedId),
    price: typeof price === "number" ? price : Number(price),
    bid: typeof bid === "number" ? bid : Number(bid),
    ask: typeof ask === "number" ? ask : Number(ask),
    timestamp,
    validFromTimestamp: validFrom,
    expiresAt,
  };
}

/**
 * Convert a bigint price to a number, applying decimals if available
 */
function toNumber(value: unknown, decimals?: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") {
    const dec = typeof decimals === "number" ? decimals : (typeof decimals === "bigint" ? Number(decimals) : 18);
    return Number(value) / Math.pow(10, dec);
  }
  return parseFloat(String(value)) || 0;
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Get the latest price report for a feed
 * @param pairOrFeedId - Pair name (e.g., "BTC/USD") or raw feed ID (0x...)
 */
export async function getLatestReport(pairOrFeedId: string): Promise<StreamsReport> {
  const feedId = resolveFeedId(pairOrFeedId);
  const client = getClient();
  const report = await client.getLatestReport(feedId);
  return toStreamsReport(report as { fullReport: string; feedID: string; observationsTimestamp?: number; validFromTimestamp?: number }, feedId);
}

/**
 * Get a price report at a specific timestamp
 * @param pairOrFeedId - Pair name or raw feed ID
 * @param timestamp - Unix timestamp in seconds
 */
export async function getReportAtTimestamp(
  pairOrFeedId: string,
  timestamp: number,
): Promise<StreamsReport> {
  const feedId = resolveFeedId(pairOrFeedId);
  const client = getClient();
  const report = await client.getReportByTimestamp(feedId, timestamp);
  return toStreamsReport(report as { fullReport: string; feedID: string; observationsTimestamp?: number; validFromTimestamp?: number }, feedId);
}

/**
 * Get latest reports for multiple feeds in one call
 * @param pairsOrFeedIds - Array of pair names or feed IDs
 */
export async function getBulkReports(
  pairsOrFeedIds: string[],
): Promise<StreamsReport[]> {
  const feedIds = pairsOrFeedIds.map(resolveFeedId);
  const client = getClient();

  // SDK's getReportsBulk needs a timestamp — use current time
  const now = Math.floor(Date.now() / 1000);
  const reports = await client.getReportsBulk(feedIds, now);

  const results = Array.isArray(reports) ? reports : [reports];
  return results.map((raw, i) =>
    toStreamsReport(
      raw as { fullReport: string; feedID: string; observationsTimestamp?: number; validFromTimestamp?: number },
      feedIds[i] ?? "unknown",
    )
  );
}

/**
 * List all available Data Streams feed IDs (static directory)
 */
export function listAvailableFeeds(): Array<{ pair: string; feedId: string }> {
  return Object.entries(STREAMS_FEED_IDS).map(([pair, feedId]) => ({
    pair,
    feedId,
  }));
}
