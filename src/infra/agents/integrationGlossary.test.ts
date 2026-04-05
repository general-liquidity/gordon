import { describe, expect, it } from "bun:test";

import { GordonConfigSchema } from "../../types/config.ts";
import { buildPromptEnvelope, clearPromptContextReports } from "./contextBudget.ts";
import {
  formatIntegrationGlossary,
  getCanonicalIntegrationGlossary,
  selectRelevantIntegrationGlossary,
} from "./integrationGlossary.ts";
import type { GordonContext } from "./types.ts";

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
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
    const synthData = glossary.find((entry) => entry.id === "synthdata");
    const dedalus = glossary.find((entry) => entry.id === "dedalus");

    expect(synthData?.summary.toLowerCase()).toContain("probabilistic");
    expect(dedalus?.summary.toLowerCase()).toContain("gateway");
  });

  it("retrieves a selective glossary slice for explicitly mentioned integrations", async () => {
    const selection = await selectRelevantIntegrationGlossary(
      "What does SynthData do for Gordon and how does Dedalus route?",
      createContext(),
    );

    expect(selection.matchedIds).toContain("synthdata");
    expect(selection.matchedIds).toContain("dedalus");
    expect(selection.entries.length).toBeLessThanOrEqual(6);
    expect(formatIntegrationGlossary(selection.entries)).toContain("SynthData");
  });

  it("builds a stable prompt envelope with only the relevant glossary slice", async () => {
    clearPromptContextReports();
    const context = createContext({
      requestedTaskScope: "analysis",
    });
    const selection = await selectRelevantIntegrationGlossary("Use SynthData for probabilistic research", context);
    const envelope = buildPromptEnvelope(
      "Use SynthData for probabilistic research",
      context,
      selection,
      formatIntegrationGlossary(selection.entries),
    );

    expect(envelope.prompt).toContain("[GORDON_PROJECT_TRUTH]");
    expect(envelope.prompt).toContain("[GORDON_INTEGRATION_GLOSSARY]");
    expect(envelope.prompt).toContain("[GORDON_PHASE_GUIDANCE]");
    expect(envelope.prompt).toContain("SynthData");
    expect(envelope.report.cache.supported).toBe(false);
    expect(envelope.report.workflowPhase).toBe("analysis");
    expect(envelope.report.sectionBudget.totalEstimated).toBeGreaterThan(0);
    expect(envelope.contextPieces.some((piece) => piece.source === "prompt-section-registry")).toBeTrue();
  });

  it("attaches transport-level Anthropic cache hints to the stable system message", async () => {
    const context = createContext({
      requestedTaskScope: "execution",
      config: GordonConfigSchema.parse({
        mode: "ARMED",
        modelConfig: { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
      }),
    });
    const selection = await selectRelevantIntegrationGlossary("Review my approved execution plan", context);
    const envelope = buildPromptEnvelope(
      "Review my approved execution plan",
      context,
      selection,
      formatIntegrationGlossary(selection.entries),
    );

    expect(envelope.messages[0]?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect((envelope.requestOptions.providerOptions as Record<string, unknown>)?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
  });
});
