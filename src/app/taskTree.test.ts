import { describe, expect, test } from "bun:test";

import {
  cancelTaskTree,
  completeTaskTree,
  createTaskTree,
  dequeueTaskTreeSubmission,
  queueTaskTreeSubmission,
  recordTaskTreeAgentSwitch,
  recordTaskTreeToolEnd,
  recordTaskTreeToolStart,
} from "./taskTree.ts";

describe("taskTree", () => {
  test("creates a request root and routing node", () => {
    const tree = createTaskTree({
      input: "/analyze AAPL",
      actionId: "market.analyze",
      commandName: "analyze",
    });

    expect(tree.nodes.some((node) => node.kind === "request" && node.label === "Analyze Market")).toBe(true);
    expect(tree.nodes.some((node) => node.kind === "routing" && node.status === "running")).toBe(true);
  });

  test("classifies market-analysis tools under a functional family", () => {
    let tree = createTaskTree({ input: "/analyze BTC", actionId: "market.analyze", commandName: "analyze" });
    tree = recordTaskTreeAgentSwitch(tree, "Analyst");
    tree = recordTaskTreeToolStart(tree, "analyze_coin", { symbol: "BTCUSDT", timeframes: ["1h", "4h"] }, "Analyst");

    expect(tree.nodes.some((node) => node.kind === "family" && node.label === "Market analysis")).toBe(true);
    expect(tree.nodes.some((node) => node.kind === "agent" && node.label === "Analyst")).toBe(true);
    expect(tree.nodes.some((node) => node.kind === "tool" && node.label === "Analyze Coin")).toBe(true);
  });

  test("classifies systematic tools under systematic research", () => {
    let tree = createTaskTree({ input: "/validate momentum_v2", commandName: "validate" });
    tree = recordTaskTreeToolStart(tree, "validate_strategy", { strategy: "momentum_v2" }, "Systematic");

    expect(tree.nodes.some((node) => node.kind === "family" && node.label === "Systematic research")).toBe(true);
  });

  test("queues and dequeues follow-ups", () => {
    let tree = createTaskTree({ input: "Find a BTC setup" });
    tree = queueTaskTreeSubmission(tree, "Preview the strongest BTC setup next", "follow-up")!;
    expect(tree.nodes.some((node) => node.kind === "queue" && node.status === "queued")).toBe(true);

    tree = dequeueTaskTreeSubmission(tree)!;
    expect(tree.nodes.some((node) => node.kind === "queue" && node.status === "completed")).toBe(true);
  });

  test("settles tool nodes on completion and cancellation", () => {
    let tree = createTaskTree({ input: "/preview-order AAPL buy 10", actionId: "trading.preview_market_order" });
    tree = recordTaskTreeToolStart(tree, "preview_market_order", { symbol: "AAPL", side: "BUY" }, "Executor");
    tree = recordTaskTreeToolEnd(tree, "preview_market_order", true);
    tree = completeTaskTree(tree, "Run complete")!;

    expect(tree.nodes.some((node) => node.kind === "tool" && node.status === "completed")).toBe(true);
    expect(tree.nodes.find((node) => node.kind === "request")?.status).toBe("completed");

    let cancelled = createTaskTree({ input: "Find another setup" });
    cancelled = recordTaskTreeToolStart(cancelled, "scan_market", { topN: 20 }, "Scanner");
    cancelled = cancelTaskTree(cancelled, "Run stopped")!;

    expect(cancelled.nodes.find((node) => node.kind === "request")?.status).toBe("cancelled");
  });
});
