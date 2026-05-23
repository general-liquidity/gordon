import { describe, it, expect } from "bun:test";
import {
  getAuctionWindowsForVenue,
  getNextAuctionAt,
  suggestAuctionDeferral,
} from "./auctionWindow.ts";

describe("getAuctionWindowsForVenue", () => {
  it("returns opening + closing cross for nasdaq", () => {
    const ws = getAuctionWindowsForVenue("nasdaq");
    expect(ws.length).toBe(2);
    expect(ws.map((w) => w.kind).sort()).toEqual(["closing_cross", "opening_cross"]);
  });

  it("returns continuous batch for cow_swap", () => {
    const ws = getAuctionWindowsForVenue("cow_swap");
    expect(ws.length).toBe(1);
    expect(ws[0]!.kind).toBe("batch_continuous");
    expect(ws[0]!.cadenceSeconds).toBe(30);
  });

  it("returns empty array for unknown venue", () => {
    expect(getAuctionWindowsForVenue("madeup")).toEqual([]);
  });
});

describe("getNextAuctionAt", () => {
  it("returns null for unknown venue", () => {
    expect(getNextAuctionAt("madeup", new Date("2026-05-27T13:00:00Z"))).toBeNull();
  });

  it("returns near-future time for continuous-batch venue", () => {
    const now = new Date("2026-05-27T13:00:00Z");
    const next = getNextAuctionAt("cow_swap", now)!;
    expect(next).not.toBeNull();
    expect(next.getTime() - now.getTime()).toBe(30 * 1000);
  });

  it("returns today's opening cross when called before 14:30 UTC on a weekday", () => {
    // 2026-05-27 is a Wednesday
    const now = new Date("2026-05-27T13:00:00Z");
    const next = getNextAuctionAt("nasdaq", now)!;
    expect(next).not.toBeNull();
    expect(next.getUTCHours()).toBe(14);
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getUTCDate()).toBe(27);
  });

  it("returns today's closing cross when called after opening", () => {
    const now = new Date("2026-05-27T15:00:00Z"); // Wed, after 14:30 open
    const next = getNextAuctionAt("nasdaq", now)!;
    expect(next.getUTCHours()).toBe(21);
    expect(next.getUTCDate()).toBe(27);
  });

  it("skips weekends — Friday 22:00 UTC returns Monday's opening", () => {
    // 2026-05-29 is a Friday; 22:00 UTC is after closing cross
    const now = new Date("2026-05-29T22:00:00Z");
    const next = getNextAuctionAt("nasdaq", now)!;
    expect(next.getUTCDay()).toBe(1); // Monday
  });
});

describe("suggestAuctionDeferral", () => {
  it("does not defer when operator marks urgent", () => {
    const s = suggestAuctionDeferral("nasdaq", {
      forceImmediate: true,
      now: new Date("2026-05-27T13:00:00Z"),
    });
    expect(s.shouldDefer).toBe(false);
    expect(s.reason).toContain("urgent");
  });

  it("does not defer when no auction scheduled for the venue", () => {
    const s = suggestAuctionDeferral("madeup_venue", {
      now: new Date("2026-05-27T13:00:00Z"),
    });
    expect(s.shouldDefer).toBe(false);
    expect(s.reason).toContain("No auction scheduled");
  });

  it("defers when auction is within max deferral horizon", () => {
    // 14:00 → 14:30 = 30 min = 1800s, within default 1800s horizon
    const s = suggestAuctionDeferral("nasdaq", {
      now: new Date("2026-05-27T14:00:00Z"),
    });
    expect(s.shouldDefer).toBe(true);
    expect(s.estimatedSavingsBps).toBeDefined();
  });

  it("does not defer when auction is beyond max deferral horizon", () => {
    // 13:00 → 14:30 = 90 min, exceeds default 30 min horizon
    const s = suggestAuctionDeferral("nasdaq", {
      now: new Date("2026-05-27T13:00:00Z"),
    });
    expect(s.shouldDefer).toBe(false);
    expect(s.reason).toContain("exceeds max deferral");
  });

  it("respects custom maxDeferralSeconds", () => {
    // 90 min until next auction, but allow 2 hours
    const s = suggestAuctionDeferral("nasdaq", {
      now: new Date("2026-05-27T13:00:00Z"),
      maxDeferralSeconds: 7200,
    });
    expect(s.shouldDefer).toBe(true);
  });

  it("respects custom estimatedSavingsBps", () => {
    const s = suggestAuctionDeferral("nasdaq", {
      now: new Date("2026-05-27T14:00:00Z"),
      estimatedSavingsBps: 5,
    });
    expect(s.estimatedSavingsBps).toBe(5);
    expect(s.reason).toContain("5bps");
  });

  it("always suggests deferring to continuous-batch venues with default horizon", () => {
    // CoW Swap is 30s away — always within default 30-min horizon
    const s = suggestAuctionDeferral("cow_swap", {
      now: new Date("2026-05-27T13:00:00Z"),
    });
    expect(s.shouldDefer).toBe(true);
    expect(s.secondsUntilNextAuction).toBeLessThanOrEqual(30);
  });

  it("populates nextAuctionAt + secondsUntilNextAuction", () => {
    const s = suggestAuctionDeferral("nasdaq", {
      now: new Date("2026-05-27T14:00:00Z"),
    });
    expect(s.nextAuctionAt).not.toBeNull();
    expect(s.secondsUntilNextAuction).toBeCloseTo(1800, 0);
  });
});
