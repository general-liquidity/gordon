import { describe, test, expect } from "bun:test";
import {
  ResearcherContextFilter,
  isResearcherLeastContextEnabled,
} from "./researcher-context-filter.ts";

// Proves the tested HandoffCoordinator redaction works through the Mastra
// InputProcessor seam — i.e. when the researcher's model is about to see the
// context, account financials + secrets are stripped, and the processor returns
// a valid message array (it must not break the researcher input pipeline).
describe("ResearcherContextFilter (researcher inputProcessor)", () => {
  const filter = new ResearcherContextFilter();
  const run = (messages: unknown[]): Promise<unknown[]> =>
    filter.processInput({ messages, abort: () => {} } as never) as Promise<unknown[]>;

  test("redacts account balance + equity from the researcher's input", async () => {
    const out = await run([
      { role: "user", content: "Account balance: $124,500.00 and net equity: $130,000" },
    ]);
    const text = JSON.stringify(out);
    expect(text).not.toContain("124,500");
    expect(text).not.toContain("130,000");
    expect(text).toContain("REDACTED_BALANCE");
    expect(text).toContain("REDACTED_EQUITY");
  });

  test("redacts API-key-shaped secrets", async () => {
    const key = `sk_live_${"a".repeat(40)}`;
    const out = await run([{ role: "user", content: `api key ${key}` }]);
    const text = JSON.stringify(out);
    expect(text).not.toContain(key);
    expect(text).toContain("REDACTED_SECRET");
  });

  test("preserves the task prompt + multi-part (parts array) text content", async () => {
    const out = await run([
      { role: "user", content: [{ type: "text", text: "Research the BTC 4h breakout setup" }] },
    ]);
    expect(JSON.stringify(out)).toContain("Research the BTC 4h breakout setup");
  });

  test("returns the messages array unchanged in shape (valid processor output)", async () => {
    const out = await run([{ role: "user", content: "hello there" }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
  });

  test("default-on, opt-out via GORDON_LEAST_CONTEXT_RESEARCHER=0", () => {
    const prev = process.env.GORDON_LEAST_CONTEXT_RESEARCHER;
    delete process.env.GORDON_LEAST_CONTEXT_RESEARCHER;
    expect(isResearcherLeastContextEnabled()).toBe(true);
    process.env.GORDON_LEAST_CONTEXT_RESEARCHER = "0";
    expect(isResearcherLeastContextEnabled()).toBe(false);
    if (prev === undefined) delete process.env.GORDON_LEAST_CONTEXT_RESEARCHER;
    else process.env.GORDON_LEAST_CONTEXT_RESEARCHER = prev;
  });
});
