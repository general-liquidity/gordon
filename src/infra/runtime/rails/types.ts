import type {
  AgentRailsConfig,
  ChainProviderConfig,
  PaymentProviderConfig,
  RailAuthMode,
  WalletProviderConfig,
} from "../../types/index.ts";

export type AgentRailProviderKind = "wallet" | "chain" | "payment";
export type AgentRailProviderId = "moonpay" | "helius" | "polygon";

export interface AgentRailProviderStatus {
  id: AgentRailProviderId;
  kind: AgentRailProviderKind;
  configured: boolean;
  enabled: boolean;
  authMode: RailAuthMode;
  transport: "native" | "mcp" | "hybrid";
  mcpServerId?: string;
  warnings?: string[];
  details?: Record<string, unknown>;
}

export interface WalletFundingIntent {
  baseCurrencyCode: string;
  quoteCurrencyCode: string;
  walletAddress?: string;
  lockAmount?: number;
  baseCurrencyAmount?: number;
  quoteCurrencyAmount?: number;
  redirectUrl?: string;
  network?: string;
  email?: string;
  externalCustomerId?: string;
  theme?: "light" | "dark";
  metadata?: Record<string, string>;
}

export interface WalletSwapIntent {
  fromCurrencyCode: string;
  toCurrencyCode: string;
  amount?: number;
  amountCurrencyCode?: string;
  walletAddress?: string;
  redirectUrl?: string;
  email?: string;
  externalCustomerId?: string;
  theme?: "light" | "dark";
  metadata?: Record<string, string>;
}

export interface WalletLinkResult {
  provider: "moonpay";
  mode: "buy" | "sell" | "swap";
  url: string;
  query: Record<string, string>;
  signed?: boolean;
  signature?: string;
}

export interface MoonPayCurrencyLimits {
  provider: "moonpay";
  currencyCode: string;
  paymentMethod?: string;
  raw: Record<string, unknown>;
}

export interface MoonPayQuoteIntent {
  mode: "buy" | "sell";
  currencyCode: string;
  baseCurrencyAmount?: number;
  quoteCurrencyAmount?: number;
  baseCurrencyCode?: string;
  paymentMethod?: string;
  areFeesIncluded?: boolean;
  extraFeePercentage?: number;
}

export interface MoonPaySwapQuoteIntent {
  pair?: string;
  fromCurrencyCode?: string;
  toCurrencyCode?: string;
  amount?: number;
  amountCurrencyCode?: string;
  externalCustomerId?: string;
}

export interface MoonPaySwapPair {
  provider: "moonpay";
  pair: string;
  fromCurrencyCode?: string;
  toCurrencyCode?: string;
  raw: Record<string, unknown>;
}

export interface MoonPayQuoteResult {
  provider: "moonpay";
  mode: "buy" | "sell" | "swap";
  raw: Record<string, unknown>;
}

export interface MoonPayTransactionLookup {
  mode: "buy" | "sell";
  transactionId?: string;
  externalTransactionId?: string;
  customerId?: string;
  limit?: number;
}

export interface MoonPayTransactionSummary {
  provider: "moonpay";
  mode: "buy" | "sell" | "virtual-onramp" | "virtual-offramp";
  id: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  baseCurrencyCode?: string;
  quoteCurrencyCode?: string;
  baseCurrencyAmount?: number;
  quoteCurrencyAmount?: number;
  externalTransactionId?: string;
  raw: Record<string, unknown>;
}

export interface MoonPayCustomerLimits {
  provider: "moonpay";
  customerId: string;
  externalCustomerId?: string;
  raw: Record<string, unknown>;
}

export interface MoonPayVirtualAccount {
  provider: "moonpay";
  id: string;
  status?: string;
  externalCustomerId?: string;
  walletAddress?: string;
  raw: Record<string, unknown>;
}

export interface MoonPayVirtualAccountFilters {
  virtualAccountId?: string;
  externalCustomerId?: string;
  walletAddress?: string;
}

export interface MoonPayVirtualAccountTransactionQuery {
  mode: "onramp" | "offramp";
  transactionId?: string;
  virtualAccountId?: string;
  externalCustomerId?: string;
  cursor?: string;
  pageSize?: number;
}

export interface MoonPayVirtualAccountTransactionPage {
  provider: "moonpay";
  mode: "onramp" | "offramp";
  nextCursor?: string;
  transactions: MoonPayTransactionSummary[];
  raw: Record<string, unknown>;
}

export interface MoonPayWebhookVerificationInput {
  signatureHeader: string;
  payload: string;
  method?: "POST" | "GET";
  requestPath?: string;
  maxAgeSeconds?: number;
}

export interface MoonPayWebhookVerificationResult {
  provider: "moonpay";
  valid: boolean;
  timestamp?: number;
  expectedSignature?: string;
  receivedSignature?: string;
  reason?: string;
}

export interface ChainWalletAsset {
  id: string;
  symbol: string;
  name?: string;
  amount?: number;
  usdValue?: number;
  metadata?: Record<string, unknown>;
}

export interface ChainWalletOverview {
  provider: "helius";
  address: string;
  nativeBalanceLamports?: number;
  assetCount: number;
  assets: ChainWalletAsset[];
}

export interface ChainTransactionSummary {
  signature: string;
  slot: number;
  timestamp?: string;
  err?: string | null;
  memo?: string | null;
  confirmationStatus?: string;
}

export interface ChainTokenMetadata {
  mint: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  description?: string;
  image?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentIntent {
  provider: "polygon";
  network: string;
  resource: string;
  recipient: string;
  amountUsd: string;
  currency: string;
  payer?: string;
  facilitatorUrl?: string;
  description?: string;
  nonce: string;
  issuedAt: string;
  expiresAt?: string;
}

export interface SignedPaymentIntent extends PaymentIntent {
  signature: string;
  signatureType: "eip191";
}

export interface PaymentHeadersResult {
  provider: "polygon";
  headers: Record<string, string>;
  intent: SignedPaymentIntent | PaymentIntent;
}

export interface WalletProvider {
  readonly id: "moonpay";
  readonly config: WalletProviderConfig;
  getStatus(): AgentRailProviderStatus;
  buildOnRampLink(intent: WalletFundingIntent): WalletLinkResult;
  buildSellLink(intent: WalletFundingIntent): WalletLinkResult;
  buildSwapLink(intent: WalletSwapIntent): WalletLinkResult;
  getCurrencyLimits(currencyCode: string, paymentMethod?: string): Promise<MoonPayCurrencyLimits>;
  getQuote(intent: MoonPayQuoteIntent): Promise<MoonPayQuoteResult>;
  getSwapPairs(): Promise<MoonPaySwapPair[]>;
  getSwapQuote(intent: MoonPaySwapQuoteIntent): Promise<MoonPayQuoteResult>;
  getTransactions(input: MoonPayTransactionLookup): Promise<MoonPayTransactionSummary[]>;
  getCustomerLimits(customerId: string, externalCustomerId?: boolean): Promise<MoonPayCustomerLimits[]>;
  getVirtualAccounts(filters?: MoonPayVirtualAccountFilters): Promise<MoonPayVirtualAccount[]>;
  getVirtualAccountTransactions(input: MoonPayVirtualAccountTransactionQuery): Promise<MoonPayVirtualAccountTransactionPage>;
  verifyWebhookSignature(input: MoonPayWebhookVerificationInput): MoonPayWebhookVerificationResult;
}

export interface ChainDataProvider {
  readonly id: "helius";
  readonly config: ChainProviderConfig;
  getStatus(): AgentRailProviderStatus;
  getWalletOverview(address: string, limit?: number): Promise<ChainWalletOverview>;
  getRecentTransactions(address: string, limit?: number): Promise<ChainTransactionSummary[]>;
  getTokenMetadata(mint: string): Promise<ChainTokenMetadata>;
}

export interface PaymentProvider {
  readonly id: "polygon";
  readonly config: PaymentProviderConfig;
  getStatus(): AgentRailProviderStatus;
  createPaymentIntent(input: {
    resource: string;
    amountUsd: string;
    currency?: string;
    recipient?: string;
    description?: string;
    expiresInMinutes?: number;
  }): Promise<PaymentIntent>;
  signPaymentIntent(intent: PaymentIntent): Promise<SignedPaymentIntent | PaymentIntent>;
  buildPaymentHeaders(intent: SignedPaymentIntent | PaymentIntent): PaymentHeadersResult;
}

export interface AgentRailsRegistry {
  config: AgentRailsConfig;
  walletProviders: WalletProvider[];
  chainProviders: ChainDataProvider[];
  paymentProviders: PaymentProvider[];
  activeWalletProvider: WalletProvider | null;
  activeChainProvider: ChainDataProvider | null;
  activePaymentProvider: PaymentProvider | null;
  getStatuses(): AgentRailProviderStatus[];
}
