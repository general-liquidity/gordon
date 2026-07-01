import { describe, expect, it } from "bun:test";
import {
  canTransition,
  closePosition,
  completeReview,
  createThesis,
  enterPosition,
  isReviewDue,
  isTerminal,
  markEntryReady,
  recordPartialClose,
  reviewsDue,
  terminate,
  transition,
  updateExcursion,
} from "./thesisLifecycle.ts";

const DAY = 24 * 60 * 60 * 1000;
const t = (iso: string) => iso;

describe("thesis FSM transitions", () => {
  it("walks the happy path idea -> entry_ready -> active -> partial -> closed", () => {
    let thesis = createThesis(
      { symbol: "BTC", side: "long", rationale: "breakout", reviewEveryMs: DAY },
      "2026-01-01T00:00:00.000Z",
    );
    expect(thesis.state).toBe("IDEA");
    thesis = markEntryReady(thesis, "2026-01-01T01:00:00.000Z");
    expect(thesis.state).toBe("ENTRY_READY");
    thesis = enterPosition(thesis, { entryPrice: 100, quantity: 10 }, "2026-01-02T00:00:00.000Z");
    expect(thesis.state).toBe("ACTIVE");
    expect(thesis.openQuantity).toBe(10);
    expect(thesis.nextReviewAt).toBe("2026-01-03T00:00:00.000Z");

    thesis = recordPartialClose(thesis, { quantity: 4, exitPrice: 120 }, "2026-01-04T00:00:00.000Z");
    expect(thesis.state).toBe("PARTIALLY_CLOSED");
    expect(thesis.openQuantity).toBe(6);
    expect(thesis.realizedPnl).toBeCloseTo((120 - 100) * 4, 9);

    thesis = closePosition(thesis, 130, "2026-01-05T00:00:00.000Z");
    expect(thesis.state).toBe("CLOSED");
    expect(thesis.openQuantity).toBe(0);
    expect(thesis.realizedPnl).toBeCloseTo((120 - 100) * 4 + (130 - 100) * 6, 9);
    expect(thesis.nextReviewAt).toBeUndefined();
    expect(isTerminal(thesis)).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("IDEA", "ACTIVE")).toBe(false);
    expect(canTransition("CLOSED", "ACTIVE")).toBe(false);
    const idea = createThesis(
      { symbol: "ETH", side: "long", rationale: "x" },
      "2026-01-01T00:00:00.000Z",
    );
    expect(() => transition(idea, "ACTIVE", "2026-01-01T00:00:00.000Z")).toThrow();
  });

  it("computes short-side realized PnL correctly", () => {
    let thesis = createThesis(
      { symbol: "SOL", side: "short", rationale: "reversal" },
      "2026-01-01T00:00:00.000Z",
    );
    thesis = markEntryReady(thesis, "2026-01-01T01:00:00.000Z");
    thesis = enterPosition(thesis, { entryPrice: 200, quantity: 5 }, "2026-01-02T00:00:00.000Z");
    thesis = closePosition(thesis, 180, "2026-01-03T00:00:00.000Z");
    // Short profits when price falls: (200 - 180) * 5.
    expect(thesis.realizedPnl).toBeCloseTo(100, 9);
  });

  it("rejects over-closing the open quantity", () => {
    let thesis = createThesis(
      { symbol: "BTC", side: "long", rationale: "x" },
      "2026-01-01T00:00:00.000Z",
    );
    thesis = enterPosition(markEntryReady(thesis, t("2026-01-01T01:00:00.000Z")), { entryPrice: 100, quantity: 2 }, "2026-01-02T00:00:00.000Z");
    expect(() =>
      recordPartialClose(thesis, { quantity: 3, exitPrice: 110 }, "2026-01-03T00:00:00.000Z"),
    ).toThrow(RangeError);
  });
});

describe("MAE / MFE tracking", () => {
  it("records best and worst directional excursions for a long", () => {
    let thesis = createThesis(
      { symbol: "BTC", side: "long", rationale: "x" },
      "2026-01-01T00:00:00.000Z",
    );
    thesis = enterPosition(markEntryReady(thesis, t("2026-01-01T01:00:00.000Z")), { entryPrice: 100, quantity: 1 }, "2026-01-02T00:00:00.000Z");
    thesis = updateExcursion(thesis, 90, "2026-01-02T06:00:00.000Z"); // -10 adverse
    thesis = updateExcursion(thesis, 115, "2026-01-02T12:00:00.000Z"); // +15 favorable
    thesis = updateExcursion(thesis, 105, "2026-01-02T18:00:00.000Z");
    expect(thesis.mfe).toBeCloseTo(15, 9);
    expect(thesis.mae).toBeCloseTo(-10, 9);
  });
});

describe("review scheduler", () => {
  it("surfaces only open theses whose review is due", () => {
    const base = "2026-01-01T00:00:00.000Z";
    let active = createThesis({ symbol: "A", side: "long", rationale: "x", reviewEveryMs: DAY }, base);
    active = enterPosition(markEntryReady(active, base), { entryPrice: 10, quantity: 1 }, base);
    // nextReviewAt = base + 1 day.

    let closed = createThesis({ symbol: "B", side: "long", rationale: "x", reviewEveryMs: DAY }, base);
    closed = enterPosition(markEntryReady(closed, base), { entryPrice: 10, quantity: 1 }, base);
    closed = closePosition(closed, 12, base);

    const before = new Date("2026-01-01T12:00:00.000Z");
    const after = new Date("2026-01-02T12:00:00.000Z");
    expect(isReviewDue(active, before)).toBe(false);
    expect(isReviewDue(active, after)).toBe(true);

    const due = reviewsDue([active, closed], after);
    expect(due.map((x) => x.symbol)).toEqual(["A"]);
  });

  it("reschedules on completeReview", () => {
    const base = "2026-01-01T00:00:00.000Z";
    let thesis = createThesis({ symbol: "A", side: "long", rationale: "x", reviewEveryMs: DAY }, base);
    thesis = enterPosition(markEntryReady(thesis, base), { entryPrice: 10, quantity: 1 }, base);
    thesis = completeReview(thesis, "2026-01-02T00:00:00.000Z");
    expect(thesis.nextReviewAt).toBe("2026-01-03T00:00:00.000Z");
  });
});

describe("termination", () => {
  it("moves to TERMINATED and clears the review schedule", () => {
    const base = "2026-01-01T00:00:00.000Z";
    let thesis = createThesis({ symbol: "A", side: "long", rationale: "x", reviewEveryMs: DAY }, base);
    thesis = enterPosition(markEntryReady(thesis, base), { entryPrice: 10, quantity: 1 }, base);
    thesis = terminate(thesis, "thesis invalidated by regime shift", "2026-01-02T00:00:00.000Z");
    expect(thesis.state).toBe("TERMINATED");
    expect(thesis.nextReviewAt).toBeUndefined();
    expect(isTerminal(thesis)).toBe(true);
  });
});
