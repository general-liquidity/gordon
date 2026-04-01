import { describe, expect, it } from "bun:test";
import { ScratchpadStore } from "./ScratchpadStore.ts";

describe("ScratchpadStore", () => {
  it("records handoffs and worker notes", () => {
    const store = new ScratchpadStore();
    store.recordHandoff({
      fromWorker: "Planner",
      toWorker: "Executor",
      reason: "Plan approved",
      toolName: "execute_plan",
    });
    store.appendEntry({
      worker: "Executor",
      kind: "note",
      content: "Execution prepared",
    });

    expect(store.listHandoffs()).toHaveLength(1);
    expect(store.listEntries("Executor")).toHaveLength(2);
  });
});
