import { describe, expect, it } from "bun:test";
import { HandoffCoordinator, type FilterableMessage } from "./HandoffCoordinator.ts";
import {
  assembleSubagentContext,
  recordSubagentFeedback,
  collectSupervisorFeedback,
} from "./toolAgentMap.ts";

const apiKey = "sk_live_AB12cd34EF56gh78IJ90kl12MN34op56QR78st90UV";

describe("assembleSubagentContext (toolAgentMap seam)", () => {
  it("scrubs balances/positions/secrets for the researcher target", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [
      {
        role: "user",
        content: `balance: $50,000. Position SHORT 2 ETH. key ${apiKey}.`,
      },
    ];

    const result = assembleSubagentContext("researcher", messages, coordinator);
    const scrubbed = result.messages[0]!.content as string;

    expect(result.filteredAgent).toBe(true);
    expect(result.redacted).toBe(true);
    expect(scrubbed).not.toContain("50,000");
    expect(scrubbed).not.toContain("2 ETH");
    expect(scrubbed).not.toContain(apiKey);
  });

  it("keeps executor financials but strips its credentials", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [
      { role: "user", content: `balance: $50,000. key ${apiKey}.` },
    ];
    const result = assembleSubagentContext("executor", messages, coordinator);
    const scrubbed = result.messages[0]!.content as string;

    expect(result.filteredAgent).toBe(false);
    expect(scrubbed).toContain("50,000");
    expect(scrubbed).not.toContain(apiKey);
  });
});

describe("post-delegation feedback (toolAgentMap seam)", () => {
  it("records and renders feedback for the supervisor's next iteration", () => {
    const coordinator = new HandoffCoordinator();
    recordSubagentFeedback(
      "Gordon",
      "researcher",
      "researcher returned no risk section — revise",
      undefined,
      coordinator,
    );

    const collected = collectSupervisorFeedback("Gordon", coordinator);
    expect(collected.notes).toHaveLength(1);
    expect(collected.text).toContain("researcher");
    expect(collected.text).toContain("no risk section");
    // Drained — second collect is empty.
    expect(collectSupervisorFeedback("Gordon", coordinator).notes).toHaveLength(0);
  });

  it("returns undefined text when there is no pending feedback", () => {
    const coordinator = new HandoffCoordinator();
    const collected = collectSupervisorFeedback("Gordon", coordinator);
    expect(collected.notes).toHaveLength(0);
    expect(collected.text).toBeUndefined();
  });
});
