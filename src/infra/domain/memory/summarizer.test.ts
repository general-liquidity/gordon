import { describe, expect, it } from "bun:test";

import { ConversationSummarizer } from "./summarizer.ts";
import {
  INTEGRATION_GLOSSARY_MARKER,
  PROJECT_TRUTH_MARKER,
} from "../../agents/contextBudget.ts";

describe("ConversationSummarizer", () => {
  it("preserves stable project-truth and glossary messages outside compaction", async () => {
    const summarizer = new ConversationSummarizer(
      {
        chatWithConfig: async () => ({
          content: "## Conversation Summary\n\n### Key Decisions Made:\n- None in this conversation.\n\n### Active Positions/Analysis:\n- None.\n\n### Important Context:\n- None.",
        }),
      } as never,
      {
        messageThreshold: 3,
        recentMessagesToKeep: 1,
      },
    );

    const result = await summarizer.summarize([
      { role: "system", content: `${PROJECT_TRUTH_MARKER}\n- Gordon supports crypto and stocks.` },
      { role: "system", content: `${INTEGRATION_GLOSSARY_MARKER}\n- SynthData: Research analytics.` },
      { role: "user", content: "Analyze BTC." },
      { role: "assistant", content: "Working on it." },
    ]);

    expect(result.summarized).toBe(true);
    expect(result.messages[0]?.content).toContain(PROJECT_TRUTH_MARKER);
    expect(result.messages[1]?.content).toContain(INTEGRATION_GLOSSARY_MARKER);
    expect(result.messages.some((message) => message.content.includes("[GORDON_ARTIFACT_INDEX]"))).toBeTrue();
    expect(result.compactionStage).toBeDefined();
  });
});
