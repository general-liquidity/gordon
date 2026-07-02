import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore, defaultKindForType } from "./store.ts";

describe("CoALA kind — default mapping", () => {
  it("routes storage types to episodic / semantic / procedural", () => {
    expect(defaultKindForType("trade_journal")).toBe("episodic");
    expect(defaultKindForType("market_observation")).toBe("episodic");
    expect(defaultKindForType("analysis")).toBe("episodic");
    expect(defaultKindForType("strategy_note")).toBe("procedural");
    expect(defaultKindForType("agent_insight")).toBe("semantic");
    expect(defaultKindForType("user_note")).toBe("semantic");
  });
});

describe("CoALA kind — store write + type-routed recall", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gordon-kind-"));
    store = new MemoryStore(join(dir, "memory.db"));
    await store.init();
  });

  afterEach(() => {
    store.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort — Windows can briefly hold the SQLite WAL lock.
    }
  });

  it("labels a write with the type-derived kind and persists it", async () => {
    const id = await store.add({
      type: "strategy_note",
      content: "scale out in thirds into resistance",
      metadata: {},
      tokens: ["scale", "out", "resistance"],
      importance: 0.5,
    });
    const stored = await store.get(id);
    expect(stored?.kind).toBe("procedural");
  });

  it("honors an explicit kind override at write time", async () => {
    const id = await store.add({
      type: "analysis",
      kind: "procedural",
      content: "checklist: confirm regime before sizing",
      metadata: {},
      tokens: ["checklist", "regime", "sizing"],
      importance: 0.5,
    });
    expect((await store.get(id))?.kind).toBe("procedural");
  });

  it("recall can be routed to a single kind", async () => {
    await store.add({
      type: "trade_journal",
      content: "longed ETH breakout and it worked",
      metadata: {},
      tokens: ["longed", "eth", "breakout", "worked"],
      importance: 0.6,
    });
    await store.add({
      type: "strategy_note",
      content: "ETH breakout playbook: enter on retest",
      metadata: {},
      tokens: ["eth", "breakout", "playbook", "retest"],
      importance: 0.6,
    });

    const procedural = await store.getByKind("procedural");
    expect(procedural.length).toBe(1);
    expect(procedural[0]!.content).toContain("playbook");

    const episodic = await store.searchKeyword("breakout", { kind: "episodic" });
    expect(episodic.length).toBe(1);
    expect(episodic[0]!.entry.content).toContain("longed ETH");
  });
});
