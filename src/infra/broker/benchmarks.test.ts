import { describe, expect, test } from "bun:test";
import { BrokerFactory } from "./factory.ts";
import { runBrokerBenchmarks, validateBenchmarkReport } from "./benchmarks.ts";

describe("broker latency benchmarks and reliability scorecard", () => {
  test("produces benchmark + scorecard for every supported broker", async () => {
    const reports = await runBrokerBenchmarks({ iterations: 4 });
    const supported = BrokerFactory.getSupportedBrokers();

    expect(reports.length).toBe(supported.length);

    for (const report of reports) {
      expect(supported).toContain(report.brokerId);

      expect(report.latency.quote.p95Ms).toBeGreaterThan(0);
      expect(report.latency.orderAck.p95Ms).toBeGreaterThan(0);
      expect(report.latency.orderStatusPropagation.p95Ms).toBeGreaterThan(0);

      expect(report.reliability.rateLimitRecovery.score).toBeGreaterThanOrEqual(0);
      expect(report.reliability.retryQuality.score).toBeGreaterThanOrEqual(0);
      expect(report.reliability.sessionResilience.score).toBeGreaterThanOrEqual(0);
      expect(report.reliability.overallScore).toBeGreaterThanOrEqual(0);
    }
  });

  test("passes CI latency envelope validation", async () => {
    const reports = await runBrokerBenchmarks({ iterations: 4 });
    const validation = validateBenchmarkReport(reports, { maxP95Ms: 50 });
    expect(validation.passed).toBe(true);
    expect(validation.failures).toHaveLength(0);
  });
});

