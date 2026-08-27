/**
 * Mock factories for testing
 */

import type {
  Candle,
  Indicators,
  Level,
  CoinAnalysis,
  Plan,
  GordonConfig,
  Preferences,
} from "../types/index.ts";

/**
 * Create a mock candle with optional overrides
 */
export function createMockCandle(overrides: Partial<Candle> = {}): Candle {
  const now = Date.now();
  return {
    openTime: now - 3600000,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1000000,
    closeTime: now,
    ...overrides,
  };
}

/**
 * Create an array of mock candles
 */
export function createMockCandles(
  count: number,
  options: {
    startPrice?: number;
    trend?: "up" | "down" | "flat";
    volatility?: number;
  } = {},
): Candle[] {
  const { startPrice = 100, trend = "flat", volatility = 0.02 } = options;
  const candles: Candle[] = [];
  let currentPrice = startPrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const trendMultiplier = trend === "up" ? 1.002 : trend === "down" ? 0.998 : 1;
    const randomFactor = 1 + (Math.random() - 0.5) * volatility;

    const open = currentPrice;
    let nextPrice = currentPrice * trendMultiplier * randomFactor;
    const minimumDirectionalMove = Math.max(0.0005, volatility * 0.1);
    if (trend === "up" && nextPrice <= currentPrice) {
      nextPrice = currentPrice * (1 + minimumDirectionalMove);
    } else if (trend === "down" && nextPrice >= currentPrice) {
      nextPrice = currentPrice * (1 - minimumDirectionalMove);
    }
    currentPrice = nextPrice;
    const close = currentPrice;

    const high = Math.max(open, close) * (1 + Math.random() * volatility);
    const low = Math.min(open, close) * (1 - Math.random() * volatility);

    candles.push({
      openTime: now - (count - i) * 3600000,
      open,
      high,
      low,
      close,
      volume: 1000000 * (0.5 + Math.random()),
      closeTime: now - (count - i - 1) * 3600000,
    });
  }

  return candles;
}

/**
 * Create mock indicators
 */
export function createMockIndicators(overrides: Partial<Indicators> = {}): Indicators {
  return {
    rsi: 50,
    macd: {
      macd: 0,
      signal: 0,
      histogram: 0,
    },
    volumeMA: 1000000,
    volumeRatio: 1,
    ...overrides,
  };
}

/**
 * Create a mock level (support/resistance)
 */
export function createMockLevel(overrides: Partial<Level> = {}): Level {
  return {
    price: 100,
    type: "support",
    strength: 0.8,
    touches: 3,
    ...overrides,
  };
}

/**
 * Create a mock coin analysis
 */
export function createMockCoinAnalysis(overrides: Partial<CoinAnalysis> = {}): CoinAnalysis {
  return {
    symbol: "BTCUSDT",
    price: 50000,
    change24h: 2.5,
    volume24h: 1000000000,
    indicators: createMockIndicators(),
    levels: [createMockLevel()],
    trend: "up",
    setupDetected: false,
    setupConfidence: 0,
    bias: "neutral",
    risk: "medium",
    ...overrides,
  };
}

/**
 * Create a mock trading plan
 */
export function createMockPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-123",
    createdAt: new Date().toISOString(),
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: {
      currency: "USDT",
      amount: 1000,
      percentOfPortfolio: 0.1,
    },
    entry: {
      type: "limit",
      price: 50000,
    },
    dca: null,
    grid: null,
    stopLoss: {
      price: 48000,
    },
    takeProfit: [
      { price: 52500, percentToSell: 0.5 }, // R:R = 2500/2000 = 1.25:1 (above min 1.2)
      { price: 55000, percentToSell: 0.5 },
    ],
    reasoning: "Support bounce setup detected with strong confluence.",
    status: "DRAFT",
    ...overrides,
  };
}

/**
 * Create mock preferences
 */
export function createMockPreferences(overrides: Partial<Preferences> = {}): Preferences {
  return {
    cashReservePercent: 0.2,
    maxAllocationPerTrade: 0.1,
    defaultTimeframes: ["1h", "4h"],
    topNCoins: 50,
    maxConcurrentTrades: 5,
    ...overrides,
  };
}

/**
 * Create a mock Gordon config
 */
export function createMockConfig(overrides: Partial<GordonConfig> = {}): GordonConfig {
  return {
    version: "1.0.0",
    exchanges: [],
    brokers: [],
    mcpServers: [],
    preferences: createMockPreferences(),
    memoryConfig: {
      lastMessages: 20,
      maxSessionDurationHours: 24,
      memoryWarningThreshold: 0.8,
    },
    permissionMode: "ask",
    costBudget: {
      action: "warn",
      warnThresholds: [0.5, 0.75, 0.9],
    },
    onboardingComplete: false,
    startupBannerMode: "full",
    useKeyring: false,
    telemetry: { enabled: false, researchData: false },
    riskManagement: {
      mode: "enforce",
      maxDailyLossPercent: 3,
      maxDrawdownPercent: 15,
      maxPositionSizePercent: 10,
      maxPositions: 5,
    },
    strategyRuntime: {
      allocationStrategy: "equal_weight",
    },
    regimeDetection: {
      autoRegime: true,
    },
    ui: {},
    systematic: {
      executionMode: "assisted",
      minTradesForPromotion: 30,
      minValidationScore: 60,
      autoSnapshotDatasets: true,
      autoCreateResearchExperiments: true,
      simulationRealism: {
        profile: "realistic",
        executionLagBars: 1,
        spreadBps: 2,
        marketImpactBps: 1,
      },
      biasDiagnostics: {
        minBacktestDays: 90,
        minOutOfSampleWindows: 3,
        maxTradePnlConcentrationPercent: 55,
        maxCagrPercent: 300,
        requireWalkForward: true,
        requireMonteCarlo: true,
      },
    },
    ...overrides,
  };
}

/**
 * Create a mock portfolio
 */
export function createMockPortfolio(
  overrides: { totalValue?: number; availableCash?: number; openPositions?: number } = {},
): { totalValue: number; availableCash: number; openPositions: number } {
  return {
    totalValue: 10000,
    availableCash: 8000,
    openPositions: 0,
    ...overrides,
  };
}
