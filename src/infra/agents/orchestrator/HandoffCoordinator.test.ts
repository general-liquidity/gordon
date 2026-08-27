import { describe, expect, it } from "bun:test";
import { HandoffCoordinator, type FilterableMessage } from "./HandoffCoordinator.ts";

describe("HandoffCoordinator", () => {
  it("allows valid finance-native handoffs", () => {
    const coordinator = new HandoffCoordinator();
    const validation = coordinator.validate("Planner", "Executor", {
      permissionMode: "auto",
      handoffBudget: {
        maxNotionalUsd: 10_000,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(validation.valid).toBe(true);
  });

  it("blocks invalid handoffs", () => {
    const coordinator = new HandoffCoordinator();
    const validation = coordinator.validate("Teacher", "Executor", { permissionMode: "auto" });
    expect(validation.valid).toBe(false);
  });
});

describe("HandoffCoordinator.filterContextForSubagent (least-context handoff)", () => {
  const apiKey = "sk_live_AB12cd34EF56gh78IJ90kl12MN34op56QR78st90UV"; // 32+ chars
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34Gkx…snip…\n-----END RSA PRIVATE KEY-----";

  it("scrubs account state AND secrets when delegating to the researcher", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [
      {
        role: "user",
        content:
          `Account balance: $12,345.67 and net equity = 250000. ` +
          `Open position LONG 0.5 BTC. API key ${apiKey}.`,
      },
    ];

    const result = coordinator.filterContextForSubagent("researcher", messages);
    const scrubbed = result.messages[0]!.content as string;

    expect(result.filteredAgent).toBe(true);
    expect(result.redacted).toBe(true);
    // Account state stripped
    expect(scrubbed).not.toContain("12,345.67");
    expect(scrubbed).not.toContain("250000");
    expect(scrubbed).not.toContain("0.5 BTC");
    expect(scrubbed).toContain("[REDACTED_BALANCE]");
    expect(scrubbed).toContain("[REDACTED_EQUITY]");
    expect(scrubbed).toContain("[REDACTED_POSITION]");
    // Secret stripped
    expect(scrubbed).not.toContain(apiKey);
    expect(scrubbed).toContain("[REDACTED_SECRET]");
  });

  it("matches the Researcher worker role case-insensitively", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [{ role: "user", content: "balance: 9999.00 USDT" }];
    const result = coordinator.filterContextForSubagent("Researcher", messages);
    expect(result.filteredAgent).toBe(true);
    expect(result.messages[0]!.content).not.toContain("9999.00");
  });

  it("scrubs PEM private-key blocks for the researcher", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [{ role: "user", content: pem }];
    const result = coordinator.filterContextForSubagent("researcher", messages);
    expect(result.messages[0]!.content).toBe("[REDACTED_PEM_BLOCK]");
    expect(result.messages[0]!.content).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("preserves executor account state but still strips raw credentials", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [
      {
        role: "user",
        content: `Account balance: $12,345.67. Position LONG 0.5 BTC. Key ${apiKey}.`,
      },
    ];

    const result = coordinator.filterContextForSubagent("executor", messages);
    const scrubbed = result.messages[0]!.content as string;

    expect(result.filteredAgent).toBe(false);
    // Executor KEEPS the financials it needs to size orders…
    expect(scrubbed).toContain("12,345.67");
    expect(scrubbed).toContain("0.5 BTC");
    expect(scrubbed).not.toContain("[REDACTED_BALANCE]");
    // …but loses the raw credential.
    expect(scrubbed).not.toContain(apiKey);
    expect(scrubbed).toContain("[REDACTED_SECRET]");
  });

  it("redacts text inside multi-part content arrays", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "equity: $99,000" },
          { type: "text", text: `token ${apiKey}` },
          { type: "image", url: "https://example.com/chart.png" },
        ],
      },
    ];

    const result = coordinator.filterContextForSubagent("researcher", messages);
    const parts = result.messages[0]!.content as Array<Record<string, unknown>>;
    expect(parts[0]!.text).toContain("[REDACTED_EQUITY]");
    expect(parts[1]!.text).toContain("[REDACTED_SECRET]");
    // Non-text part untouched
    expect(parts[2]!.url).toBe("https://example.com/chart.png");
  });

  it("does not mutate the input messages", () => {
    const coordinator = new HandoffCoordinator();
    const original = "balance: 1000.00 USDT";
    const messages: FilterableMessage[] = [{ role: "user", content: original }];
    coordinator.filterContextForSubagent("researcher", messages);
    expect(messages[0]!.content).toBe(original);
  });

  it("leaves ordinary prose untouched (no false-positive redaction)", () => {
    const coordinator = new HandoffCoordinator();
    const messages: FilterableMessage[] = [
      { role: "user", content: "Scan BTC and ETH and rank by momentum." },
    ];
    const result = coordinator.filterContextForSubagent("researcher", messages);
    expect(result.redacted).toBe(false);
    expect(result.messages[0]!.content).toBe("Scan BTC and ETH and rank by momentum.");
  });

  it("supports runtime per-agent filtering config", () => {
    const coordinator = new HandoffCoordinator();
    expect(coordinator.isLeastContextAgent("executor")).toBe(false);
    coordinator.setLeastContextFiltering("executor", true);
    expect(coordinator.isLeastContextAgent("executor")).toBe(true);
    coordinator.setLeastContextFiltering("executor", false);
    expect(coordinator.isLeastContextAgent("executor")).toBe(false);
  });
});

describe("HandoffCoordinator post-delegation feedback", () => {
  it("records a feedback note retrievable for the next iteration", () => {
    const coordinator = new HandoffCoordinator();
    coordinator.recordDelegationFeedback(
      "Gordon",
      "researcher",
      "researcher returned no risk section — revise",
    );

    const pending = coordinator.getDelegationFeedback("Gordon");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.note).toContain("no risk section");
    expect(pending[0]!.subagentAgent).toBe("researcher");
  });

  it("drains feedback exactly once via consume", () => {
    const coordinator = new HandoffCoordinator();
    coordinator.recordDelegationFeedback("Gordon", "researcher", "first note");
    coordinator.recordDelegationFeedback("Gordon", "executor", "second note");

    const drained = coordinator.consumeDelegationFeedback("gordon"); // case-insensitive
    expect(drained).toHaveLength(2);
    expect(coordinator.getDelegationFeedback("Gordon")).toHaveLength(0);
  });

  it("clear() resets feedback alongside history", () => {
    const coordinator = new HandoffCoordinator();
    coordinator.recordDelegationFeedback("Gordon", "researcher", "note");
    coordinator.clear();
    expect(coordinator.getDelegationFeedback("Gordon")).toHaveLength(0);
  });
});
