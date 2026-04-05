/**
 * Chainlink Integration
 *
 * Three modules:
 * - streams: Data Streams REST API (sub-second prices, HMAC auth)
 * - feeds: On-chain Data Feeds (free price oracles via eth_call)
 * - ccip: Cross-Chain Interoperability Protocol (EVM bridging)
 */

// Types & constants
export {
  CHAINLINK_ENV_KEYS,
  STREAMS_BASE_URL,
  STREAMS_FEED_IDS,
  FEED_SELECTORS,
  CHAIN_RPCS,
  FEED_DIRECTORY,
  CCIP_CHAINS,
  getRpcUrl,
  type StreamsReport,
  type FeedResult,
  type CCIPFeeResult,
  type CCIPTransferResult,
  type CCIPChainConfig,
} from "./types.ts";

// Data Streams (official @chainlink/data-streams-sdk)
export {
  isStreamsConfigured,
  getLatestReport,
  getReportAtTimestamp,
  getBulkReports,
  listAvailableFeeds as listStreamFeeds,
} from "./streams.ts";

// Data Feeds (on-chain)
export {
  readFeed,
  readFeedByPair,
  comparePrices,
  listAvailableFeeds as listOnChainFeeds,
} from "./feeds.ts";

// CCIP
export {
  isCCIPConfigured,
  getSupportedChains,
  getCCIPFee,
  executeCCIPTransfer,
  getCCIPStatus,
} from "./ccip.ts";
