import { describe, expect, it } from "bun:test";
import { buildBackgroundTaskTree, type BackgroundStatusResponse } from "./backgroundTasks.ts";

describe("buildBackgroundTaskTree", () => {
  it("returns null when the daemon is offline", () => {
    const tree = buildBackgroundTaskTree(null);
    expect(tree).toBeNull();
  });

  it("builds daemon, scheduler, and autonomous branches", () => {
    const input: BackgroundStatusResponse = {
      daemon: { running: true },
      scheduler: {
        tasks: [
          {
            taskId: "__health_check",
            cronExpr: "@every 30s",
            commandType: "runtime.health_check",
            payload: {},
            enabled: true,
            nextRunAt: "2026-03-08T18:30:00.000Z",
            lastRunAt: "2026-03-08T18:29:30.000Z",
            createdAt: "2026-03-08T18:00:00.000Z",
            updatedAt: "2026-03-08T18:29:30.000Z",
          },
          {
            taskId: "scan4h",
            cronExpr: "@every 4h",
            commandType: "scan.run",
            payload: { topN: 50 },
            enabled: false,
            nextRunAt: "2026-03-08T22:00:00.000Z",
            lastRunAt: "2026-03-08T18:00:00.000Z",
            createdAt: "2026-03-08T18:00:00.000Z",
            updatedAt: "2026-03-08T18:10:00.000Z",
          },
        ],
      },
      autonomous: {
        isRunning: true,
        isPaused: false,
        mandate: {
          id: "mandate-1",
          timeframe: "4h",
          symbols: ["BTCUSDT", "AAPL"],
        },
        sessionId: "session-1",
        cycleCount: 3,
        totalOpportunities: 2,
        lastCycleTime: "2026-03-08T18:15:00.000Z",
        nextCycleTime: "2026-03-08T18:30:00.000Z",
      },
    };

    const tree = buildBackgroundTaskTree(input);
    expect(tree).not.toBeNull();
    const labels = tree!.nodes.map((node) => node.label);
    expect(labels).toContain("Background work");
    expect(labels).toContain("Daemon");
    expect(labels).toContain("Scheduler");
    expect(labels).toContain("Autonomous swing trading");
    expect(labels).toContain("Health check");
    expect(labels).toContain("Scan4h");

    const autonomousNode = tree!.nodes.find((node) => node.label === "Autonomous swing trading");
    expect(autonomousNode?.status).toBe("running");

    const blockedTask = tree!.nodes.find((node) => node.label === "Scan4h");
    expect(blockedTask?.status).toBe("blocked");
  });
});
