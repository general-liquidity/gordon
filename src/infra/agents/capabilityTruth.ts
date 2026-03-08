export type CapabilityScope = "cross-market" | "crypto-only" | "stocks-only";

export interface CapabilityTruthEntry {
  id: string;
  label: string;
  scope: CapabilityScope;
  supportedMarkets: Array<"crypto" | "stocks">;
  venueDependency: string;
  phrasingRule: string;
}

export const CAPABILITY_TRUTH_MATRIX: CapabilityTruthEntry[] = [
  {
    id: "market.discovery",
    label: "Broad market discovery and trending",
    scope: "crypto-only",
    supportedMarkets: ["crypto"],
    venueDependency: "crypto venues with market-wide scan coverage",
    phrasingRule:
      "Describe as crypto-first. Do not imply stock-universe scanning unless a broker-specific workflow exists.",
  },
  {
    id: "market.analysis",
    label: "Single-symbol analysis and technical review",
    scope: "cross-market",
    supportedMarkets: ["crypto", "stocks"],
    venueDependency: "active exchange, broker, or compatible market-data source",
    phrasingRule:
      "Describe as available for crypto symbols and supported stock tickers, with capability differences handled by venue.",
  },
  {
    id: "trading.plan",
    label: "Trade planning and order preview",
    scope: "cross-market",
    supportedMarkets: ["crypto", "stocks"],
    venueDependency: "active execution venue with planning and preview support",
    phrasingRule:
      "Describe as cross-market. Use 'symbol' or 'market' rather than 'coin' when the workflow can span both.",
  },
  {
    id: "execution.live",
    label: "Live order execution",
    scope: "cross-market",
    supportedMarkets: ["crypto", "stocks"],
    venueDependency: "active execution venue (CEX, broker, or supported protocol) in ARMED mode",
    phrasingRule:
      "Use 'execution venue' as the generic term. Only say exchange, broker, or protocol when the distinction matters.",
  },
  {
    id: "portfolio.monitoring",
    label: "Portfolio, positions, orders, and account monitoring",
    scope: "cross-market",
    supportedMarkets: ["crypto", "stocks"],
    venueDependency: "connected exchange, broker, or compatible rails surface",
    phrasingRule:
      "Describe as cross-market portfolio/account monitoring. Do not imply wallet-only or crypto-only ownership views.",
  },
  {
    id: "systematic.research",
    label: "Systematic research, validation, and backtesting",
    scope: "cross-market",
    supportedMarkets: ["crypto", "stocks"],
    venueDependency: "historical data support through exchange or broker routing",
    phrasingRule:
      "Describe as crypto + stocks. Be explicit that data breadth still depends on the connected venue and supported history.",
  },
  {
    id: "onchain.protocols",
    label: "Onchain protocols, Base, DEX, and chain tooling",
    scope: "crypto-only",
    supportedMarkets: ["crypto"],
    venueDependency: "configured chain infra, wallet, or protocol integrations",
    phrasingRule:
      "Keep this explicitly crypto and onchain. Do not blend it into stock-facing copy.",
  },
  {
    id: "wallet.rails",
    label: "Wallet rails, funding, payments, and transfers",
    scope: "crypto-only",
    supportedMarkets: ["crypto"],
    venueDependency: "configured wallet, chain, or payment rail provider",
    phrasingRule:
      "Describe as rails or wallet workflows, not as generic trading features or brokerage features.",
  },
  {
    id: "stocks.broker",
    label: "Broker-linked stock workflows",
    scope: "stocks-only",
    supportedMarkets: ["stocks"],
    venueDependency: "connected broker adapter",
    phrasingRule:
      "When speaking about stocks, anchor copy in broker-linked quotes, analysis, orders, positions, and backtests rather than market-wide scans.",
  },
];

export const GORDON_PRODUCT_TRUTH = {
  headline: "Gordon is a chat-first trading agent for crypto and stocks.",
  summaryLines: [
    "Gordon supports both crypto and stocks.",
    "Crypto currently has the broadest market-wide discovery, onchain, DEX, and venue coverage.",
    "Stocks currently support broker-linked quotes, analysis, plans, positions, orders, portfolio checks, and backtests.",
    "Some workflows are cross-market, while others remain market-specific by capability.",
  ],
  discoveryRule:
    "Broad scans, trending, and market-wide discovery should be described as crypto-first unless the user explicitly asks for a stock workflow.",
  venueRule:
    "Use 'execution venue' as the generic term, then narrow to exchange, broker, or protocol when the venue type matters.",
  wordingRules: [
    "Prefer 'symbol', 'ticker', 'market', or 'instrument' over 'coin' when the workflow spans crypto and stocks.",
    "Use 'coins' only in crypto-native discovery, DEX, onchain, or liquidation contexts.",
    "Do not hard-assume USDT or a default exchange in shared prompts or working-memory templates.",
  ],
} as const;

export const WORKING_MEMORY_LABELS = {
  favorites: "Favorite Markets/Tickers",
  avoided: "Avoided Markets/Tickers",
  defaultVenue: "Default Execution Venue",
  accountType: "Account Type",
  baseCurrency: "Base Currency: (e.g., USD or USDT)",
  marketFocus: "Primary Market Focus: (crypto/stocks/mixed)",
} as const;

export function formatCapabilityTruthSummary(): string {
  return [
    ...GORDON_PRODUCT_TRUTH.summaryLines.map((line) => `- ${line}`),
    `- ${GORDON_PRODUCT_TRUTH.discoveryRule}`,
    `- ${GORDON_PRODUCT_TRUTH.venueRule}`,
  ].join("\n");
}
