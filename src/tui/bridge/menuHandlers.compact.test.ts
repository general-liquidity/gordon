import { describe, expect, it } from "bun:test";
import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import { CompactionManager } from "../../runtime/transcript/CompactionManager.ts";
import { TranscriptStore } from "../../runtime/transcript/TranscriptStore.ts";
import type { Message } from "../components/messages/MessageBubble.tsx";
import { handleThreadMenuCommand } from "./menuHandlers.ts";

describe("thread transcript compaction", () => {
  it("compacts the persisted transcript and replaces the matching TUI projection", async () => {
    const store = new TranscriptStore({ maxEntries: 200 });
    const manager = new CompactionManager();
    for (let index = 0; index < 12; index += 1) {
      store.append({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `entry-${index}`,
      });
    }

    const runtime = {
      compactTranscript: (maxEntries?: number) => manager.compactStore(store, maxEntries ?? 120),
      getTranscript: () => store.list(),
    } as unknown as SessionRuntime;
    let state: { messages: Message[] } = {
      messages: [
        {
          id: "stale-ui-only-message",
          role: "system",
          content: "This presentation-only message must not survive the transcript projection.",
        },
      ],
    };
    const setState = (updater: (previous: typeof state) => typeof state): void => {
      state = updater(state);
    };

    await expect(handleThreadMenuCommand("compact", "10", setState, runtime)).resolves.toBe(true);

    expect(store.list()).toHaveLength(10);
    expect(store.list()[0]?.metadata?.compacted).toBe(true);
    expect(state.messages).toHaveLength(11);
    expect(state.messages.some((message) => message.id === "stale-ui-only-message")).toBe(false);
    expect(state.messages.at(-1)?.content).toContain("Runtime Transcript Compacted");
  });
});
