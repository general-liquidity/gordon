import { describe, expect, test } from "bun:test";

import { applyCompactionIfNeeded } from "./compactionHandler.ts";

describe("applyCompactionIfNeeded", () => {
  test("returns the generated summary and recent tail instead of an original-history prefix", async () => {
    const messages = Array.from({ length: 21 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: index === 20 ? "recent request" : `old turn ${index}`,
    }));
    const result = await applyCompactionIfNeeded({
      action: "compact",
      messages,
      // Deterministic model double: no local or remote model inference.
      llm: {
        chatWithConfig: async () => ({
          content: "## Conversation Summary\n- retained decision",
        }),
      } as never,
    });

    expect(result.applied).toBe(true);
    expect(
      result.messages.some((message) =>
        String(message.content).includes("## Conversation Summary"),
      ),
    ).toBe(true);
    expect(result.messages.at(-1)?.content).toBe("recent request");
    expect(result.messages).not.toEqual(messages.slice(0, 5));
  });
});
