import { describe, it, expect } from "bun:test";
import { installTempGordonHome } from "../../test-utils/tempGordonHome.ts";
import { archivePhantomPositions, PHANTOM_ARCHIVE_REASON } from "./cleanup.ts";
import { getPositionStore, PHANTOM_GRACE_MS } from "./store.ts";
import type { PositionRecord } from "./types.ts";

installTempGordonHome("gordon-poscleanup-test-");

function agedRecord(id: string, symbol: string, overrides: Partial<PositionRecord> = {}): PositionRecord {
  const ts = new Date(Date.now() - PHANTOM_GRACE_MS - 60_000).toISOString();
  return {
    id,
    symbol,
    exchangeId: "default",
    side: "long",
    state: "idea",
    stateHistory: [],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe("archivePhantomPositions", () => {
  it("archives aged zero-qty positions with no exchange orders into terminal 'cancelled'", async () => {
    const store = await getPositionStore();
    await store.save(agedRecord("pos_ph_1", "BTCUSDT"));
    await store.save(agedRecord("pos_ph_2", "GORDONTESTUSDT"));
    await store.save(agedRecord("pos_real", "ETHUSDT", {
      state: "filled",
      entryPrice: 3_000,
      quantity: 1,
    }));

    const result = await archivePhantomPositions(async () => false);
    expect(result.archived).toBe(2);
    expect(result.skipped).toBe(0);

    const ph1 = await store.get("pos_ph_1");
    const ph2 = await store.get("pos_ph_2");
    expect(ph1?.state).toBe("cancelled");
    expect(ph1?.cancelReason).toBe(PHANTOM_ARCHIVE_REASON);
    expect(ph2?.state).toBe("cancelled");

    // Archived, not deleted — rows survive for the audit trail.
    expect(await store.get("pos_ph_1")).not.toBeNull();
    // Real position untouched.
    expect((await store.get("pos_real"))?.state).toBe("filled");
  });

  it("skips symbols that still have open exchange orders", async () => {
    const store = await getPositionStore();
    await store.save(agedRecord("pos_pending", "SOLUSDT"));

    const result = await archivePhantomPositions(async (symbol) => symbol === "SOLUSDT");
    expect(result.archived).toBe(0);
    expect(result.skipped).toBe(1);
    expect((await store.get("pos_pending"))?.state).toBe("idea");
  });

  it("fail-safe: skips rows when the exchange order check throws", async () => {
    const store = await getPositionStore();
    await store.save(agedRecord("pos_unknown", "ADAUSDT"));

    const result = await archivePhantomPositions(async () => {
      throw new Error("exchange unreachable");
    });
    expect(result.archived).toBe(0);
    expect(result.skipped).toBe(1);
    expect((await store.get("pos_unknown"))?.state).toBe("idea");
  });

  it("ignores fresh pre-fill positions inside the grace window", async () => {
    const store = await getPositionStore();
    const now = new Date().toISOString();
    await store.save(agedRecord("pos_fresh", "BTCUSDT", { createdAt: now, updatedAt: now }));

    const result = await archivePhantomPositions(async () => false);
    expect(result.archived).toBe(0);
    expect((await store.get("pos_fresh"))?.state).toBe("idea");
  });
});
