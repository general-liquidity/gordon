export const STRATEGY_TEMPLATE = `import { createGordonSDK } from "@general-liquidity/gordon/sdk";

const gordon = createGordonSDK({
  token: process.env.GORDON_AUTH_TOKEN!,
  sessionId: "{{PROJECT_NAME}}",
});

async function main() {
  await gordon.connect();
  console.log("{{PROJECT_NAME}} strategy connected");

  // 1. Stay read-only for the starter run. Raise this yourself once you have
  //    reviewed what the strategy does; "auto" lets Gordon place trades.
  await gordon.setPermissionMode({ mode: "strict", reason: "{{PROJECT_NAME}} starter run" });

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

  await gordon.disconnect();
}

main().catch((err) => {
  console.error("Strategy failed:", err);
  process.exit(1);
});
`;
