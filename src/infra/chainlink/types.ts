/**
 * Chainlink Integration Types & Constants
 *
 * Shared configuration for:
 * - Data Streams (REST API with HMAC auth)
 * - Data Feeds (on-chain price oracles via eth_call)
 * - CCIP (cross-chain token transfers)
 *
 * No npm dependencies — uses Node built-in crypto, fetch, and ethers (already installed).
 */

// ============================================================================
// Environment Variable Names
// ============================================================================

export const CHAINLINK_ENV_KEYS = {
  /** Chainlink Data Streams API key */
  API_KEY: "CHAINLINK_API_KEY",
  /** Chainlink Data Streams API secret */
  API_SECRET: "CHAINLINK_API_SECRET",
  /** EVM private key for CCIP transfers (hex, with or without 0x prefix) */
  EVM_PRIVATE_KEY: "EVM_PRIVATE_KEY",
} as const;

// ============================================================================
// Data Streams Configuration
// ============================================================================

export const STREAMS_BASE_URL = "https://api.dataengine.chain.link";

/**
 * Common Data Streams feed IDs (V3 format — 66-char hex with 0x prefix)
 * Source: https://docs.chain.link/data-streams/crypto-streams
 *
 * These are the "Crypto Streams" feed IDs for the most popular pairs.
 * Users can also provide custom feed IDs directly.
 */
export const STREAMS_FEED_IDS: Record<string, string> = {
  // Major pairs
  "BTC/USD": "0x00027bbaff688c906a3e20a34fe951715d1018d262a5b66e38eda027a674cd1b",
  "ETH/USD": "0x000359843a543ee2fe414dc14c7e7920ef10f4372990b79d6361cdc0dd1ba782",
  "SOL/USD": "0x000346b313b6252ed2b79e0ba23bbfa04bace3de5dec995baab3c0a8756e1e47",
  "LINK/USD": "0x000322e3155c32334a8af4ec4f3ad6f2e0ee3b8fc9b5bba459f2c2f9e2ace1a3",
  "AVAX/USD": "0x0003ee5a13ec8c58f795e4c71e0c63c62b0c71b946c58d9afda4d5c0fbc34a07",
  "DOGE/USD": "0x00036bbf92e81b12a1f3fb2e70b79aebc413adb9590e80cd75ada6a8b476a8c5",
  "MATIC/USD": "0x0003ec8e24da58f00c3a14f36a76e556b3a4c2b6f7a2461b64c0e73f8a2a5c0e",
  "ARB/USD": "0x00034cb3de9cebd64f06eb6ae978a5fb78bfe2e90d8a4d20a5c6fe34be3e4c89",
  "OP/USD": "0x0003ccb8cf41e5749e2e3f1b6ea1f0e76e0f2079f9ce7cc3b3e3d2e3e4f08b6a",
  "DOT/USD": "0x0003b413f4a7c94e7ecb1c6c6fcfc94e36a17ef5a3f1e1e6e5b8b0d5c8e1a2b3",
};

// ============================================================================
// Data Feeds Configuration (On-Chain)
// ============================================================================

/** ABI function selectors for Chainlink Aggregator V3 */
export const FEED_SELECTORS = {
  /** latestRoundData() => (roundId, answer, startedAt, updatedAt, answeredInRound) */
  latestRoundData: "0xfeaf968c",
  /** decimals() => uint8 */
  decimals: "0x313ce567",
} as const;

/**
 * Default public RPC URLs by chain name
 * Users can override with CHAINLINK_RPC_<CHAIN> env vars
 */
export const CHAIN_RPCS: Record<string, string> = {
  ethereum: "https://eth.llamarpc.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
  polygon: "https://polygon-rpc.com",
  base: "https://mainnet.base.org",
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
  bnb: "https://bsc-dataseed.binance.org",
};

/**
 * Chainlink Data Feed aggregator contract addresses
 * Key format: "chainName:PAIR" (e.g., "ethereum:ETH/USD")
 * Source: https://docs.chain.link/data-feeds/price-feeds/addresses
 */
export const FEED_DIRECTORY: Record<string, string> = {
  // Ethereum Mainnet
  "ethereum:BTC/USD": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  "ethereum:ETH/USD": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "ethereum:LINK/USD": "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
  "ethereum:SOL/USD": "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  "ethereum:AVAX/USD": "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7",
  "ethereum:DOGE/USD": "0x2465CefD3b488BE410b941b1d4b2767088e2A028",
  "ethereum:DOT/USD": "0x1C07AFb8E2B827c5A4739C6d59Ae3A5035f28734",
  "ethereum:USDC/USD": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
  "ethereum:USDT/USD": "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D",
  // Arbitrum
  "arbitrum:BTC/USD": "0x6ce185860a4963106506C203335A2910413708e9",
  "arbitrum:ETH/USD": "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
  "arbitrum:LINK/USD": "0x86E53CF1B870786351Da77A57575e79CB55812CB",
  "arbitrum:ARB/USD": "0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6",
  "arbitrum:SOL/USD": "0x24ceA4b8ce57cdA5058b924B9B9987992450590c",
  // Base
  "base:ETH/USD": "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  "base:USDC/USD": "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
  // Polygon
  "polygon:BTC/USD": "0xc907E116054Ad103354f2D350FD2514433D57F6f",
  "polygon:ETH/USD": "0xF9680D99D6C9589e2a93a78A04A279e509205945",
  "polygon:LINK/USD": "0xd9FFdb71EbE7496cC440152d43986Aae0AB76665",
  "polygon:MATIC/USD": "0xAB594600376Ec9fD91F8e8dC9E0950EfEf8a3c20",
};

// ============================================================================
// CCIP Configuration
// ============================================================================

export interface CCIPChainConfig {
  /** CCIP chain selector (uint64) */
  selector: string;
  /** CCIP Router contract address */
  router: string;
  /** LINK token address on this chain */
  linkToken: string;
  /** Commonly bridgeable token addresses on this chain */
  supportedTokens: Record<string, string>;
  /** RPC URL (uses CHAIN_RPCS fallback) */
  rpcKey: string;
}

/**
 * CCIP-supported chains with router addresses and chain selectors
 * Source: https://docs.chain.link/ccip/supported-networks/v1_2_0/mainnet
 */
export const CCIP_CHAINS: Record<string, CCIPChainConfig> = {
  ethereum: {
    selector: "5009297550715157269",
    router: "0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D",
    linkToken: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    supportedTokens: {
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    },
    rpcKey: "ethereum",
  },
  arbitrum: {
    selector: "4949039107694359620",
    router: "0x141fa059441E0ca23ce184B6A78bafD2A517DdE8",
    linkToken: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    supportedTokens: {
      WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    },
    rpcKey: "arbitrum",
  },
  optimism: {
    selector: "3734403246176062136",
    router: "0x3206695CaE725f44B28e86ede0805bAD662Ce783",
    linkToken: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
    supportedTokens: {
      WETH: "0x4200000000000000000000000000000000000006",
      USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      LINK: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
    },
    rpcKey: "optimism",
  },
  base: {
    selector: "15971525489660198786",
    router: "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD",
    linkToken: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
    supportedTokens: {
      WETH: "0x4200000000000000000000000000000000000006",
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      LINK: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
    },
    rpcKey: "base",
  },
  polygon: {
    selector: "4051577828743386545",
    router: "0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe",
    linkToken: "0xb0897686c545045aFc77CF20eC7A532E3120E0F1",
    supportedTokens: {
      WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      LINK: "0xb0897686c545045aFc77CF20eC7A532E3120E0F1",
    },
    rpcKey: "polygon",
  },
  avalanche: {
    selector: "6433500567565415381",
    router: "0xF4c7E640EdA248ef95972845a62bdC74237805dB",
    linkToken: "0x5947BB275c521040051D82396192181b413227A3",
    supportedTokens: {
      WAVAX: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
      USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      LINK: "0x5947BB275c521040051D82396192181b413227A3",
    },
    rpcKey: "avalanche",
  },
  bnb: {
    selector: "11344663589394136015",
    router: "0x34B03Cb9086d7D758AC55af71584F81A598759FE",
    linkToken: "0x404460C6A5EdE2D891e8297795264fDe62ADBB75",
    supportedTokens: {
      WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      USDT: "0x55d398326f99059fF775485246999027B3197955",
      LINK: "0x404460C6A5EdE2D891e8297795264fDe62ADBB75",
    },
    rpcKey: "bnb",
  },
};

// ============================================================================
// Result Types
// ============================================================================

/** Decoded Data Streams report */
export interface StreamsReport {
  feedId: string;
  pair: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
  validFromTimestamp: number;
  expiresAt: number;
}

/** On-chain Data Feed result */
export interface FeedResult {
  chain: string;
  pair: string;
  price: number;
  decimals: number;
  roundId: string;
  updatedAt: number;
  aggregatorAddress: string;
}

/** CCIP fee estimation result */
export interface CCIPFeeResult {
  sourceChain: string;
  destChain: string;
  token: string;
  amount: string;
  feeInLink: string;
  feeInNative: string;
}

/** CCIP transfer result */
export interface CCIPTransferResult {
  txHash: string;
  messageId: string;
  sourceChain: string;
  destChain: string;
  token: string;
  amount: string;
  recipient: string;
}

// ============================================================================
// CCIP ABI Fragments (ethers v6 human-readable format)
// ============================================================================

/** ERC-20 approve ABI */
export const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;

/** CCIP Router ABI (minimal, for fee estimation and sending) */
export const CCIP_ROUTER_ABI = [
  "function getFee(uint64 destinationChainSelector, tuple(bytes receiver, bytes data, tuple(address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256)",
  "function ccipSend(uint64 destinationChainSelector, tuple(bytes receiver, bytes data, tuple(address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)",
] as const;

/**
 * Get RPC URL for a chain, checking env var override first
 */
export function getRpcUrl(chainName: string): string {
  const envKey = `CHAINLINK_RPC_${chainName.toUpperCase()}`;
  const envUrl = process.env[envKey];
  if (envUrl) return envUrl;

  const defaultUrl = CHAIN_RPCS[chainName];
  if (!defaultUrl) {
    throw new Error(`Unknown chain "${chainName}". Supported: ${Object.keys(CHAIN_RPCS).join(", ")}`);
  }
  return defaultUrl;
}
