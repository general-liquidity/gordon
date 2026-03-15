import { describe, expect, it } from "bun:test";

import {
  clearSessionCostLedger,
  getSessionCostLedgerEntry,
  recordSessionCostUsage,
} from "./sessionCostLedger.ts";

describe("sessionCostLedger", () => {
  it("persists cumulative usage totals by thread", () => {
    const threadId = "thread-cost-ledger-test";
    clearSessionCostLedger(threadId);

    recordSessionCostUsage({
      threadId,
      provider: "openai",
      model: "gpt-5.4",
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
    });
    recordSessionCostUsage({
      threadId,
      provider: "openai",
      model: "gpt-5.4",
      promptTokens: 60,
      completionTokens: 20,
      totalTokens: 80,
    });

    const entry = getSessionCostLedgerEntry(threadId);
    expect(entry?.requestCount).toBe(2);
    expect(entry?.promptTokens).toBe(160);
    expect(entry?.completionTokens).toBe(60);
    expect(entry?.totalTokens).toBe(220);
  });
});
