import {
  formatBenchmarkSummary,
  runBrokerBenchmarks,
  validateBenchmarkReport,
} from "../src/infra/broker/benchmarks.ts";

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const ciMode = hasArg("--ci");
  const iterationsArg = process.argv.find((arg) => arg.startsWith("--iterations="));
  const iterations = iterationsArg ? Number(iterationsArg.split("=")[1]) : 8;

  const reports = await runBrokerBenchmarks({ iterations: Number.isFinite(iterations) ? iterations : 8 });
  const summary = formatBenchmarkSummary(reports);
  console.log(summary);

  if (!ciMode) return;

  const validation = validateBenchmarkReport(reports, { maxP95Ms: 50 });
  if (!validation.passed) {
    console.error("Broker benchmark quality gate failed:");
    for (const failure of validation.failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
}

await main();

