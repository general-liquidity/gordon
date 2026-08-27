import { describe, expect, it } from "bun:test";

import { GordonConfigSchema } from "../../types/config.ts";
import { buildPromptEnvelope, clearPromptContextReports } from "./context/contextBudget.ts";
import {
  formatIntegrationGlossary,
  getCanonicalIntegrationGlossary,
  selectRelevantIntegrationGlossary,
} from "./integrationGlossary.ts";
import type { GordonContext } from "./types.ts";

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    exchange: null,
    broker: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({
      modelConfig: { provider: "openai", model: "gpt-5.4" },
    }),
    portfolioValue: 0,
    availableCash: 0,
    threadId: "thread-test",
    ...overrides,
  };
}

describe("integration glossary grounding", () => {
  it("builds canonical glossary entries from taxonomy/discovery metadata", async () => {
    const glossary = await getCanonicalIntegrationGlossary(GordonConfigSchema.parse({}));
    const hyperliquid = glossary.find((entry) => entry.id === "hyperliquid");
    const anthropic = glossary.find((entry) => entry.id === "anthropic");

    expect(hyperliquid).toBeDefined();
    expect(hyperliquid?.summary.length ?? 0).toBeGreaterThan(0);
    expect(anthropic?.summary.length ?? 0).toBeGreaterThan(0);
  });

  it("retrieves a selective glossary slice for explicitly mentioned integrations", async () => {
    const selection = await selectRelevantIntegrationGlossary(
      "What does Hyperliquid do for Gordon and how does Anthropic route?",
      createContext(),
    );

    expect(selection.matchedIds).toContain("hyperliquid");
    expect(selection.matchedIds).toContain("anthropic");
    expect(selection.entries.length).toBeLessThanOrEqual(10);
    expect(formatIntegrationGlossary(selection.entries)).toContain("Hyperliquid");
  });

  it("builds a stable prompt envelope with only the relevant glossary slice", async () => {
    clearPromptContextReports();
    const context = createContext({
      requestedTaskScope: "analysis",
    });
    const selection = await selectRelevantIntegrationGlossary(
      "Use Hyperliquid for perps trading",
      context,
    );
    const envelope = buildPromptEnvelope(
      "Use Hyperliquid for perps trading",
      context,
      selection,
      formatIntegrationGlossary(selection.entries),
    );

    expect(envelope.prompt).toContain("[GORDON_PROJECT_TRUTH]");
    expect(envelope.prompt).toContain("[GORDON_INTEGRATION_GLOSSARY]");
    expect(envelope.prompt).toContain("[GORDON_PHASE_GUIDANCE]");
    expect(envelope.prompt).toContain("Hyperliquid");
    expect(envelope.report.cache.supported).toBe(false);
    expect(envelope.report.workflowPhase).toBe("analysis");
    expect(envelope.report.sectionBudget.totalEstimated).toBeGreaterThan(0);
    expect(
      envelope.contextPieces.some((piece) => piece.source === "prompt-section-registry"),
    ).toBeTrue();
  });

  it("attaches transport-level Anthropic cache hints to the stable system message", async () => {
    const context = createContext({
      requestedTaskScope: "execution",
      config: GordonConfigSchema.parse({
        permissionMode: "auto",
        modelConfig: { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
      }),
    });
    const selection = await selectRelevantIntegrationGlossary(
      "Review my approved execution plan",
      context,
    );
    const envelope = buildPromptEnvelope(
      "Review my approved execution plan",
      context,
      selection,
      formatIntegrationGlossary(selection.entries),
    );

    expect(envelope.messages[0]?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect((envelope.requestOptions.providerOptions as Record<string, unknown>)?.anthropic).toEqual(
      {
        cacheControl: { type: "ephemeral" },
      },
    );
  });
});
