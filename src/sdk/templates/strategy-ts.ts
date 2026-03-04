export const STRATEGY_TEMPLATE = `import { createGordonSDKClient } from "@general-liquidity/gordon-cli/sdk";

const gordon = createGordonSDKClient({
  token: process.env.GORDON_AUTH_TOKEN!,
  sessionId: "{{PROJECT_NAME}}",
});

async function main() {
  await gordon.connect();
  console.log("{{PROJECT_NAME}} strategy connected");

  // 1. Arm the system for live trading (1 hour window)
  await gordon.arm({ durationHours: 1, reason: "{{PROJECT_NAME}} strategy session" });
  console.log("System armed");

  // 2. Run a market scan to find opportunities
  const scan = await gordon.scan({ topN: 30, timeframes: ["15m"] });
  console.log("Scan complete:", scan.data);

  // 3. Ask Gordon to analyze and plan trades
  await gordon.sendMessage(
    "Based on the latest scan, identify the best momentum setup and create a detailed trade plan with entry, stop loss, and take profit levels"
  );

  // 4. Monitor positions
  await gordon.monitor({ includeAlerts: true });

  // 5. Run reconciliation to ensure exchange state is in sync
  await gordon.reconcile({ force: false });

  // 6. Check portfolio health
  const health = await gordon.healthCheck({ aggressive: false });
  console.log("Health check:", health.data);

  // 7. Disarm when done
  await gordon.disarm({ reason: "Strategy session complete" });
  console.log("System disarmed");

  gordon.disconnect();
}

main().catch((err) => {
  console.error("Strategy failed:", err);
  process.exit(1);
});
`;
