import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isVisibleAsOf, filterAsOf, toEpochMs } from "./asOf.ts";
import { MemoryStore } from "./store.ts";

describe("as-of guard — pure primitive", () => {
  it("normalizes epoch-ms, ISO strings, and unknowns", () => {
    expect(toEpochMs(1000)).toBe(1000);
    expect(toEpochMs("2026-07-01T00:00:00.000Z")).toBe(Date.parse("2026-07-01T00:00:00.000Z"));
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs("not-a-date")).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
  });

  it("disables filtering when there is no as-of bound", () => {
    expect(isVisibleAsOf(5000, null)).toBe(true);
    expect(isVisibleAsOf(5000, undefined)).toBe(true);
  });

  it("treats an unknown known-at as evergreen (always visible)", () => {
    expect(isVisibleAsOf(null, 1000)).toBe(true);
    expect(isVisibleAsOf(undefined, 1000)).toBe(true);
  });

  it("excludes records learned strictly after the decision time", () => {
    expect(isVisibleAsOf(999, 1000)).toBe(true); // before → visible
    expect(isVisibleAsOf(1000, 1000)).toBe(true); // at the instant → visible
    expect(isVisibleAsOf(1001, 1000)).toBe(false); // after → excluded (lookahead)
  });

  it("filterAsOf keeps only visible records, and is a passthrough with no bound", () => {
    const rows = [
      { id: "past", learned: 100 },
      { id: "at", learned: 200 },
      { id: "future", learned: 300 },
    ];
    const asOf200 = filterAsOf(rows, 200, (r) => r.learned);
    expect(asOf200.map((r) => r.id)).toEqual(["past", "at"]);
    // No bound → unchanged.
    expect(filterAsOf(rows, undefined, (r) => r.learned).map((r) => r.id)).toEqual([
      "past",
      "at",
      "future",
    ]);
  });
});

describe("as-of guard — MemoryStore recall", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gordon-asof-"));
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

  // Reach the underlying db to backdate created_at (the known-at time), which
  // the public API sets to "now" on write.
  function backdate(id: string, createdAt: string): void {
    const raw = store as unknown as {
      db: { prepare(sql: string): { run(...args: unknown[]): unknown } };
    };
    raw.db.prepare("UPDATE memories SET created_at = ? WHERE id = ?").run(createdAt, id);
  }

  async function addAt(content: string, createdAt: string): Promise<string> {
    const id = await store.add({
      type: "market_observation",
      content,
      metadata: {},
      tokens: content.toLowerCase().split(/\s+/),
      importance: 0.5,
    });
    backdate(id, createdAt);
    return id;
  }

  it("no as-of recall returns records learned both before and after T", async () => {
    await addAt("BTC broke resistance at forty thousand", "2026-06-01T00:00:00.000Z");
    await addAt("BTC broke resistance again later", "2026-07-01T00:00:00.000Z");

    const all = await store.searchKeyword("resistance");
    expect(all.length).toBe(2);
  });

  it("as-of-T recall excludes any record learned after T (no lookahead)", async () => {
    await addAt("BTC broke resistance at forty thousand", "2026-06-01T00:00:00.000Z");
    await addAt("BTC broke resistance again in the future", "2026-07-01T00:00:00.000Z");

    const asOf = await store.searchKeyword("resistance", {
      asOf: "2026-06-15T00:00:00.000Z",
    });
    expect(asOf.length).toBe(1);
    expect(asOf[0]!.entry.content).toContain("forty thousand");
    // The future record never leaks in.
    expect(asOf.some((r) => r.entry.content.includes("future"))).toBe(false);
  });
});
