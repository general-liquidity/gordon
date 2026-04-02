import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { loadWorkspaceShellState, saveWorkspaceShellState } from "./workspaceShellState.ts";

describe("workspaceShellState", () => {
  it("persists and restores workspace shell state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-workspace-state-"));
    const filePath = join(dir, "workspace-shell-state.json");

    await saveWorkspaceShellState({
      workspace: "lab",
      workspaceMemory: {
        market: { focusSymbol: "BTCUSDT" },
        plan: { selectedPlanId: "pln_1", focusSymbol: "ETHUSDT" },
        lab: { selectedStrategyId: "sma_crossover", selectedSource: "built-in" },
        monitor: { focusSection: "runtime", focusSymbol: "SOLUSDT" },
      },
      workspaceInteraction: {
        market: { selectedCardIndex: 1 },
        plan: { selectedCardIndex: 2 },
        lab: { selectedCardIndex: 3 },
        monitor: { selectedCardIndex: 1 },
      },
      lastResults: {
        workflowSummary: {
          workflow: "backtest-cycle",
          success: true,
          summary: "Completed",
          steps: [],
        },
      },
    }, { filePath });

    const restored = await loadWorkspaceShellState({ filePath });

    expect(restored?.workspace).toBe("lab");
    expect(restored?.workspaceMemory.plan.selectedPlanId).toBe("pln_1");
    expect(restored?.workspaceMemory.monitor.focusSection).toBe("runtime");
    expect(restored?.workspaceInteraction.lab.selectedCardIndex).toBe(3);
    expect(restored?.lastResults.workflowSummary?.workflow).toBe("backtest-cycle");
  });

  it("falls back safely when the snapshot is invalid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-workspace-state-invalid-"));
    const filePath = join(dir, "workspace-shell-state.json");
    await Bun.write(filePath, "{ invalid json");

    const restored = await loadWorkspaceShellState({ filePath });
    expect(restored).toBeNull();
  });
});
