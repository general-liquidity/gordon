import { BrokerFactory } from "../factory.ts";
import type { BrokerAdapter, BrokerCredentials, BrokerId } from "../types.ts";
import { installMockBrokerApi } from "../testing/mock-api.ts";

/**
 * Brokers whose transport is NOT the REST mock and so cannot be measured by this
 * latency/reliability harness (it mocks REST endpoints). `mt5` routes through a
 * local sidecar (scripts/mt5-bridge) whose latency depends on a running terminal
 * absent in CI — benchmarking it through a fake REST mock would be meaningless.
 */
export const NON_REST_BENCHMARK_BROKERS = new Set<BrokerId>(["mt5"]);

/** REST brokers the benchmark harness can measure. */
export function getBenchmarkableBrokers(): BrokerId[] {
  return BrokerFactory.getSupportedBrokers().filter((b) => !NON_REST_BENCHMARK_BROKERS.has(b));
}

export interface BrokerLatencySnapshot {
  p50Ms: number;
  p95Ms: number;
  avgMs: number;
}

export interface BrokerLatencyBenchmarks {
  quote: BrokerLatencySnapshot;
  orderAck: BrokerLatencySnapshot;
  orderStatusPropagation: BrokerLatencySnapshot;
}

export interface BrokerReliabilityScorecard {
  rateLimitRecovery: {
    automaticRecovery: boolean;
    retryAttempts: number;
    score: number;
  };
  retryQuality: {
    retriesOnTransientFailure: boolean;
    score: number;
  };
  sessionResilience: {
    automaticSessionRecovery: boolean;
    score: number;
  };
  overallScore: number;
}

export interface BrokerBenchmarkReport {
  brokerId: BrokerId;
  latency: BrokerLatencyBenchmarks;
  reliability: BrokerReliabilityScorecard;
}

export interface BrokerBenchmarkOptions {
  iterations?: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  const value = sorted[index] ?? 0;
  return Number(value.toFixed(3));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, current) => acc + current, 0);
  return Number((sum / values.length).toFixed(3));
}

function makeSnapshot(values: number[]): BrokerLatencySnapshot {
  return {
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    avgMs: average(values),
  };
}

function createCredentials(brokerId: BrokerId): BrokerCredentials {
  return {
    apiKey: `key-${brokerId}`,
    apiSecret: `secret-${brokerId}`,
    accountId: brokerId === "webull" ? "WB-ACC-1" : undefined,
    paper: true,
    baseUrl: `https://${brokerId}.benchmark`,
    dataBaseUrl: `https://${brokerId}.benchmark`,
  };
}

async function measureLatencyMs(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return Number((performance.now() - start).toFixed(3));
}

async function runLatencyBenchmarks(brokerId: BrokerId, iterations: number): Promise<BrokerLatencyBenchmarks> {
  const mock = installMockBrokerApi(brokerId);
  try {
    const adapter = BrokerFactory.create(brokerId, createCredentials(brokerId));
    await adapter.getAccount();

    const quoteLatencies: number[] = [];
    const orderAckLatencies: number[] = [];
    const statusLatencies: number[] = [];

    for (let i = 0; i < iterations; i += 1) {
      quoteLatencies.push(await measureLatencyMs(() => adapter.getLatestQuote("AAPL")));
      orderAckLatencies.push(await measureLatencyMs(() => adapter.placeOrder({
        symbol: "AAPL",
        side: "buy",
        type: "market",
        timeInForce: "day",
        qty: 1,
      })));
      statusLatencies.push(await measureLatencyMs(() => adapter.getOrder("order-1")));
    }

    return {
      quote: makeSnapshot(quoteLatencies),
      orderAck: makeSnapshot(orderAckLatencies),
      orderStatusPropagation: makeSnapshot(statusLatencies),
    };
  } finally {
    mock.restore();
    BrokerFactory.clearCache();
  }
}

async function probeRateLimitRecovery(brokerId: BrokerId): Promise<{
  automaticRecovery: boolean;
  retryAttempts: number;
}> {
  const mock = installMockBrokerApi(brokerId, { failFirstQuoteWith429: true });
  try {
    const adapter = BrokerFactory.create(brokerId, createCredentials(brokerId));
    let automaticRecovery = false;
    try {
      await adapter.getLatestQuote("AAPL");
      automaticRecovery = true;
    } catch {
      automaticRecovery = false;
    }

    return {
      automaticRecovery,
      retryAttempts: Math.max(0, mock.getCallCount("quote") - 1),
    };
  } finally {
    mock.restore();
    BrokerFactory.clearCache();
  }
}

async function probeSessionResilience(brokerId: BrokerId): Promise<boolean> {
  const mock = installMockBrokerApi(brokerId, { failFirstAccountWith401: true });
  try {
    const adapter = BrokerFactory.create(brokerId, createCredentials(brokerId));
    return await adapter.testConnection();
  } finally {
    mock.restore();
    BrokerFactory.clearCache();
  }
}

async function buildReliabilityScorecard(brokerId: BrokerId): Promise<BrokerReliabilityScorecard> {
  const rateLimit = await probeRateLimitRecovery(brokerId);
  const sessionRecovered = await probeSessionResilience(brokerId);

  const rateLimitScore = rateLimit.automaticRecovery ? 100 : 20;
  const retryScore = rateLimit.retryAttempts > 0 ? 100 : 25;
  const sessionScore = sessionRecovered ? 100 : 30;
  const overallScore = Math.round((rateLimitScore + retryScore + sessionScore) / 3);

  return {
    rateLimitRecovery: {
      automaticRecovery: rateLimit.automaticRecovery,
      retryAttempts: rateLimit.retryAttempts,
      score: rateLimitScore,
    },
    retryQuality: {
      retriesOnTransientFailure: rateLimit.retryAttempts > 0,
      score: retryScore,
    },
    sessionResilience: {
      automaticSessionRecovery: sessionRecovered,
      score: sessionScore,
    },
    overallScore,
  };
}

export async function runBrokerBenchmarks(
  options: BrokerBenchmarkOptions = {},
): Promise<BrokerBenchmarkReport[]> {
  const iterations = Math.max(3, options.iterations ?? 8);
  const brokerIds = getBenchmarkableBrokers();
  const reports: BrokerBenchmarkReport[] = [];

  for (const brokerId of brokerIds) {
    const [latency, reliability] = await Promise.all([
      runLatencyBenchmarks(brokerId, iterations),
      buildReliabilityScorecard(brokerId),
    ]);

    reports.push({
      brokerId,
      latency,
      reliability,
    });
  }

  return reports;
}

export function validateBenchmarkReport(
  reports: BrokerBenchmarkReport[],
  options: { maxP95Ms?: number } = {},
): { passed: boolean; failures: string[] } {
  const maxP95Ms = options.maxP95Ms ?? 50;
  const failures: string[] = [];

  if (reports.length === 0) {
    failures.push("No broker benchmark reports produced.");
  }

  for (const report of reports) {
    if (report.latency.quote.p95Ms > maxP95Ms) {
      failures.push(`${report.brokerId}: quote p95 ${report.latency.quote.p95Ms}ms exceeded ${maxP95Ms}ms`);
    }
    if (report.latency.orderAck.p95Ms > maxP95Ms) {
      failures.push(`${report.brokerId}: orderAck p95 ${report.latency.orderAck.p95Ms}ms exceeded ${maxP95Ms}ms`);
    }
    if (report.latency.orderStatusPropagation.p95Ms > maxP95Ms) {
      failures.push(
        `${report.brokerId}: orderStatusPropagation p95 ${report.latency.orderStatusPropagation.p95Ms}ms exceeded ${maxP95Ms}ms`,
      );
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

export function formatBenchmarkSummary(reports: BrokerBenchmarkReport[]): string {
  const lines: string[] = [];
  lines.push("broker\tquote_p95\torderAck_p95\tstatus_p95\treliability");
  for (const report of reports) {
    lines.push(
      `${report.brokerId}\t${report.latency.quote.p95Ms}ms\t${report.latency.orderAck.p95Ms}ms\t${report.latency.orderStatusPropagation.p95Ms}ms\t${report.reliability.overallScore}`,
    );
  }
  return lines.join("\n");
}
