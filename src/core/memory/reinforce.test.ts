import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore } from "./store.ts";
import { TradeJournal } from "./trade-journal.ts";
import type { EmbeddingProvider } from "./embeddings.ts";

// Embedding-free provider — reinforcement + importance don't need vectors,
// and this keeps the test deterministic and offline.
const stubEmbedder: EmbeddingProvider = {
  name: "stub",
  dimensions: 0,
  embed: async () => {
    throw new Error("no embeddings in test");
  },
  embedBatch: async () => {
    throw new Error("no embeddings in test");
  },
};

describe("outcome -> memory reinforcement", () => {
  let dir: string;
  let store: MemoryStore;
  let journal: TradeJournal;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gordon-reinforce-"));
    store = new MemoryStore(join(dir, "memory.db"));
    await store.init();
    journal = new TradeJournal(store, stubEmbedder);
  });

  afterEach(() => {
    store.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort — Windows can briefly hold the SQLite WAL lock.
    }
  });

  async function addMemory(importance: number): Promise<string> {
    return store.add({
      type: "agent_insight",
      content: "cited insight",
      metadata: {},
      tokens: ["cited", "insight"],
      importance,
    });
  }

  it("reinforceImportance bumps a memory's importance, clamped to [0,1]", async () => {
    const id = await addMemory(0.4);
    const next = await store.reinforceImportance(id, 0.2);
    expect(next).toBeCloseTo(0.6, 6);
    const stored = await store.get(id);
    expect(stored?.importance).toBeCloseTo(0.6, 6);
  });

  it("reinforceImportance clamps at the ceiling and returns null for missing ids", async () => {
    const id = await addMemory(0.95);
    expect(await store.reinforceImportance(id, 0.5)).toBe(1);
    expect(await store.reinforceImportance("mem_does_not_exist", 0.2)).toBeNull();
  });

  it("reinforce bumps cited memories on a positive reward, scaled by reward", async () => {
    const a = await addMemory(0.4);
    const b = await addMemory(0.4);
    const updated = await journal.reinforce([a, b], 0.5); // half-strength
    expect(updated).toBe(2);
    // REINFORCE_MAX_DELTA (0.2) * reward (0.5) = +0.1
    expect((await store.get(a))?.importance).toBeCloseTo(0.5, 6);
    expect((await store.get(b))?.importance).toBeCloseTo(0.5, 6);
  });

  it("reinforce is a no-op on non-positive reward (losing lineage keeps decaying)", async () => {
    const id = await addMemory(0.4);
    expect(await journal.reinforce([id], 0)).toBe(0);
    expect(await journal.reinforce([id], -1)).toBe(0);
    expect((await store.get(id))?.importance).toBeCloseTo(0.4, 6);
  });

  it("reinforce caps the reward factor at 1 (a big win can't over-bump)", async () => {
    const id = await addMemory(0.4);
    await journal.reinforce([id], 10); // reward >> 1 → capped at +0.2
    expect((await store.get(id))?.importance).toBeCloseTo(0.6, 6);
  });
});
