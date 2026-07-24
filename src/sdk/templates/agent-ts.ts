export const AGENT_TEMPLATE = `import { createGordonSDKClient } from "@general-liquidity/gordon/sdk";

const gordon = createGordonSDKClient({
  token: process.env.GORDON_AUTH_TOKEN!,
  sessionId: "{{PROJECT_NAME}}",
  autoReconnect: true,
});

// React to connection events
gordon.onEvent("connected", () => console.log("Connected to Gordon daemon"));
gordon.onEvent("disconnected", () => console.log("Disconnected from daemon"));
gordon.onEvent("error", (e) => console.error("SDK error:", e.data));

async function main() {
  // 1. Connect to the running Gordon daemon
  await gordon.connect();
  console.log("{{PROJECT_NAME}} agent started");

  // 2. Check daemon health
  const status = await gordon.getStatus();
  console.log("Daemon status:", status);

  // 3. Run a market scan
  const scan = await gordon.scan({ topN: 20, timeframes: ["1h"] });
  console.log("Scan result:", scan.data);

  // 4. Send an analysis request to the agent network
  await gordon.sendMessage("Analyze the top 5 trending tokens and identify any breakout setups");

  // 5. Schedule periodic health checks
  await gordon.scheduleTask({
    taskId: "{{PROJECT_NAME}}-health",
    cron: "@every 30m",
    commandType: "runtime.health_check",
    payload: { aggressive: false },
  });

  // 6. Schedule market scans every 4 hours
  await gordon.scheduleTask({
    taskId: "{{PROJECT_NAME}}-scan",
    cron: "@every 4h",
    commandType: "scan.run",
    payload: { topN: 50 },
  });

  console.log("Scheduled tasks created. Agent is running.");
  console.log("Press Ctrl+C to stop.");

  // Keep process alive
  process.on("SIGINT", () => {
    gordon.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Agent failed:", err);
  process.exit(1);
});
`;
