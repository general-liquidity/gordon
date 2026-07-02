import { describe, it, expect } from "bun:test";
import {
  BeliefLedger,
  makeBelief,
  flipBar,
  tensionVerdict,
  renderBeliefTensionsBlock,
  DEFAULT_BAR,
} from "./beliefLedger.ts";

describe("belief tension — counter mechanics", () => {
  it("a contradicting observation increments the against counter", () => {
    const ledger = new BeliefLedger();
    ledger.addBelief(makeBelief("b1", "BTC macro uptrend intact"));

    const verdict = ledger.observe("b1", "contradicts");
    const tension = ledger.tension("b1")!;
    expect(tension.againstCount).toBe(1);
    expect(tension.forCount).toBe(0);
    expect(tension.updates).toBe(1);
    // One contradiction is below the default bar of 3.
    expect(verdict).toBe("hold");
  });

  it("crossing the bar recommends a flip and resolving applies it", () => {
    const ledger = new BeliefLedger(); // bar = 3
    ledger.addBelief(makeBelief("b1", "funding stays positive"));

    expect(ledger.observe("b1", "contradicts")).toBe("hold");
    expect(ledger.observe("b1", "contradicts")).toBe("hold");
    // Third net contradiction crosses the bar.
    expect(ledger.observe("b1", "contradicts")).toBe("flip");

    expect(ledger.resolve("b1")).toBe("flip");
    expect(ledger.belief("b1")!.status).toBe("flipped");
    expect(ledger.tension("b1")).toBeUndefined();
  });

  it("supporting observations can reconfirm a challenged belief", () => {
    const ledger = new BeliefLedger(); // bar = 3
    ledger.addBelief(makeBelief("b1", "range holds"));

    // A contradiction opens the tension, then support outweighs it.
    expect(ledger.observe("b1", "contradicts")).toBe("hold");
    for (let i = 0; i < 3; i++) ledger.observe("b1", "supports");
    // for=3, against=1 → net support weight 2, still below the bar.
    expect(tensionVerdict(ledger.tension("b1")!)).toBe("hold");
    // One more support: for=4, against=1 → net support weight 3 >= bar.
    ledger.observe("b1", "supports");
    expect(tensionVerdict(ledger.tension("b1")!)).toBe("reconfirm");

    expect(ledger.resolve("b1")).toBe("reconfirm");
    expect(ledger.belief("b1")!.status).toBe("reconfirmed");
  });

  it("support without an open tension is a no-op", () => {
    const ledger = new BeliefLedger();
    ledger.addBelief(makeBelief("b1", "unchallenged"));
    expect(ledger.observe("b1", "supports")).toBeUndefined();
    expect(ledger.tension("b1")).toBeUndefined();
  });

  it("observing an unknown belief returns undefined", () => {
    const ledger = new BeliefLedger();
    expect(ledger.observe("missing", "contradicts")).toBeUndefined();
    expect(ledger.tensions.length).toBe(0);
  });
});

describe("belief tension — adjustable bar", () => {
  it("skepticism lowers the flip bar", () => {
    expect(flipBar(DEFAULT_BAR, 0.0)).toBe(3);
    expect(flipBar(DEFAULT_BAR, 1.0)).toBe(1);
    // Halfway rounds to a bar of 2.
    expect(flipBar(DEFAULT_BAR, 0.5)).toBe(2);
  });

  it("the bar changes the flip point", () => {
    // Neutral skepticism: two contradictions do NOT flip (bar 3).
    const calm = new BeliefLedger().withSkepticism(0.0);
    calm.addBelief(makeBelief("b", "claim"));
    calm.observe("b", "contradicts");
    expect(calm.observe("b", "contradicts")).toBe("hold");

    // High skepticism lowers the bar to 2: the same two contradictions flip.
    const skeptical = new BeliefLedger().withSkepticism(0.5);
    skeptical.addBelief(makeBelief("b", "claim"));
    skeptical.observe("b", "contradicts");
    expect(skeptical.observe("b", "contradicts")).toBe("flip");
  });
});

describe("belief tension — injection block", () => {
  it("lists only crossed tensions", () => {
    const ledger = new BeliefLedger();
    ledger.addBelief(makeBelief("flip", "will flip"));
    ledger.addBelief(makeBelief("hold", "still contested"));

    for (let i = 0; i < 3; i++) ledger.observe("flip", "contradicts");
    ledger.observe("hold", "contradicts");

    const block = renderBeliefTensionsBlock(ledger)!;
    expect(block).toContain('FLIP: "will flip"');
    expect(block).not.toContain("still contested");
  });

  it("is undefined when nothing has crossed the bar", () => {
    const ledger = new BeliefLedger();
    ledger.addBelief(makeBelief("b", "claim"));
    ledger.observe("b", "contradicts");
    expect(renderBeliefTensionsBlock(ledger)).toBeUndefined();
  });
});

describe("belief tension — JSON round-trip", () => {
  it("serializes and restores an equivalent ledger", () => {
    const ledger = new BeliefLedger().withSkepticism(0.5);
    ledger.addBelief(
      makeBelief("b1", "BTC macro uptrend intact", {
        symbol: "BTCUSDT",
        provenance: "regime-scan:2026-07-01",
        createdAt: 1_000,
      }),
    );
    ledger.observe("b1", "contradicts");
    ledger.observe("b1", "supports");

    const json = JSON.stringify(ledger);
    const back = BeliefLedger.fromJSON(JSON.parse(json));
    expect(back.toJSON()).toEqual(ledger.toJSON());
  });
});
