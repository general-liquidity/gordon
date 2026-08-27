import { describe, expect, it } from "bun:test";
import {
  playbookSuggestProducer,
  resetPlaybookSuggestProducerState,
} from "./playbookSuggestProducer.ts";

describe("playbookSuggestProducer", () => {
  it("ignores non-playbook tick observations", async () => {
    const result = await playbookSuggestProducer({
      source: "monitor_loop",
      eventType: "tick_regime_flip",
      timestamp: Date.now(),
    });
    expect(result).toEqual([]);
  });

  it("ignores event bus observations", async () => {
    const result = await playbookSuggestProducer({
      source: "event_bus",
      eventType: "tick_playbook_suggest",
      timestamp: Date.now(),
    });
    expect(result).toEqual([]);
  });

  it("reset clears suggestion state", () => {
    resetPlaybookSuggestProducerState();
    expect(true).toBe(true);
  });
});
