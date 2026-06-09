/**
 * Wallet / address intelligence adapter — types.
 *
 * A separate abstraction from the OHLC `DataSource` layer because the data
 * shape is different: balances, portfolios, transaction flow, token holders,
 * and smart-money labels — not candles. Each provider implements ONLY the
 * capabilities it declares (CCXT-style `has` gating); the manager routes each
 * operation to the highest-priority available source that supports it, with
 * fallback. This is the onchain alpha CCXT structurally cannot see.
 */

// ── Queries ────────────────────────────────────────────────────────────────

export interface AddressQuery {
  /** Wallet/contract address (or Solana account). */
  address: string;
  /** Single chain to scope to (e.g. "ethereum", "base", "solana"). */
  chain?: string;
  /** Multiple chains (portfolio aggregation). Overrides `chain` when set. */
  chains?: string[];
}

export interface TxQuery {
  address: string;
  chain?: string;
  /** Max rows to return. */
  limit?: number;
  /** Only transactions at/after this epoch-ms. */
  sinceMs?: number;
}

export interface TokenQuery {
  /** Token contract / mint address. */
  tokenAddress: string;
  chain: string;
  /** Max holders to return. */
  limit?: number;
}

export interface SmartMoneyQuery {
  /** Optional: scope flow to one token. */
  tokenAddress?: string;
  chain?: string;
  limit?: number;
}

// ── Results ────────────────────────────────────────────────────────────────

export interface TokenBalance {
  tokenAddress: string;
  symbol: string;
  name?: string;
  decimals?: number;
  /** Human-readable amount (already scaled by decimals). */
  amount: number;
  priceUsd?: number;
  valueUsd?: number;
  chain: string;
}

export interface Portfolio {
  address: string;
  totalValueUsd: number;
  positions: TokenBalance[];
  chains: string[];
}

export interface WalletTx {
  hash: string;
  chain: string;
  /** Epoch ms. */
  timestamp: number;
  from: string;
  to: string;
  valueUsd?: number;
  tokenSymbol?: string;
  direction?: "in" | "out";
  type?: string;
}

export interface TokenHolder {
  address: string;
  amount: number;
  valueUsd?: number;
  /** Share of supply, 0–100. */
  pct?: number;
  label?: string;
}

export interface AddressLabel {
  address: string;
  labels: string[];
  entity?: string;
  isSmartMoney?: boolean;
  isExchange?: boolean;
  isContract?: boolean;
}

export interface SmartMoneyFlowItem {
  tokenAddress: string;
  symbol?: string;
  chain: string;
  /** Net USD flow from labeled smart-money over the window (+ = accumulation). */
  netFlowUsd: number;
  buyers?: number;
  sellers?: number;
  /** e.g. "24h", "7d". */
  window?: string;
}

// ── Source contract ────────────────────────────────────────────────────────

export interface WalletIntelCapabilities {
  balances: boolean;
  portfolio: boolean;
  transactions: boolean;
  tokenHolders: boolean;
  labels: boolean;
  smartMoneyFlow: boolean;
  /** Supported chains, or ["*"] for "most chains". */
  chains: string[];
}

/**
 * A wallet/address-intelligence provider. Implement ONLY the operations your
 * `getCapabilities()` declares true — the manager never calls an op on a
 * source whose capability flag is false. Every implemented op must resolve
 * gracefully (return [] / null on error, never throw) so the manager can
 * fall through to the next source.
 */
export interface WalletIntelSource {
  readonly id: string;
  readonly name: string;
  /** Lower = tried first. */
  readonly priority: number;
  readonly requiresAuth: boolean;

  isAvailable(): Promise<boolean>;
  getCapabilities(): WalletIntelCapabilities;

  getTokenBalances?(query: AddressQuery): Promise<TokenBalance[]>;
  getPortfolio?(query: AddressQuery): Promise<Portfolio | null>;
  getTransactions?(query: TxQuery): Promise<WalletTx[]>;
  getTokenHolders?(query: TokenQuery): Promise<TokenHolder[]>;
  getAddressLabels?(query: AddressQuery): Promise<AddressLabel | null>;
  getSmartMoneyFlow?(query: SmartMoneyQuery): Promise<SmartMoneyFlowItem[]>;
}
