import { describe, it, expect } from "bun:test";
import { applySignalGate, newSignalGateState } from "./signalGate.ts";

describe("applySignalGate", () => {
  it("fires immediately when MA already aligns", () => {
    const r = applySignalGate({
      state: newSignalGateState(),
      rawSignal: "long",
      fastMa: 110,
      slowMa: 100,
      price: 105,
    });
    expect(r.execute).toBe("long");
    expect(r.status).toBe("executed-immediately");
    expect(r.state.pendingSignal).toBe("none");
  });

  it("parks signal when MA disagrees", () => {
    const r = applySignalGate({
      state: newSignalGateState(),
      rawSignal: "long",
      fastMa: 90,
      slowMa: 100,
      price: 95,
    });
    expect(r.execute).toBe("none");
    expect(r.status).toBe("pending");
    expect(r.state.pendingSignal).toBe("long");
    expect(r.state.pendingPrice).toBe(95);
  });

  it("fires after confirmation arrives and records the price benefit", () => {
    let s = newSignalGateState();
    // First park
    s = applySignalGate({
      state: s,
      rawSignal: "long",
      fastMa: 90,
      slowMa: 100,
      price: 95,
    }).state;
    // MA confirms; price improved (lower fill) → positive benefit
    const r = applySignalGate({
      state: s,
      rawSignal: "none",
      fastMa: 105,
      slowMa: 100,
      price: 92,
    });
    expect(r.execute).toBe("long");
    expect(r.status).toBe("executed-after-confirmation");
    expect(r.benefit).toBeCloseTo((95 - 92) / 95, 5);
    expect(r.state.benefits.length).toBe(1);
  });

  it("cancels a pending signal when an opposing raw signal fires", () => {
    let s = newSignalGateState();
    s = applySignalGate({
      state: s,
      rawSignal: "long",
      fastMa: 90,
      slowMa: 100,
      price: 95,
    }).state;
    const r = applySignalGate({
      state: s,
      rawSignal: "short",
      fastMa: 95,
      slowMa: 100,
      price: 96,
    });
    expect(r.status).toBe("cancelled");
    expect(r.execute).toBe("none");
    expect(r.state.pendingSignal).toBe("none");
  });

  it("passes through 'none' signals when no pending exists", () => {
    const r = applySignalGate({
      state: newSignalGateState(),
      rawSignal: "none",
      fastMa: 100,
      slowMa: 100,
      price: 100,
    });
    expect(r.status).toBe("passthrough");
    expect(r.execute).toBe("none");
  });

  it("caps benefits ring buffer at benefitsCap", () => {
    let s = newSignalGateState();
    for (let i = 0; i < 6; i++) {
      // park
      s = applySignalGate({
        state: s,
        rawSignal: "long",
        fastMa: 90,
        slowMa: 100,
        price: 95,
      }).state;
      // fire
      s = applySignalGate({
        state: s,
        rawSignal: "none",
        fastMa: 105,
        slowMa: 100,
        price: 92,
        benefitsCap: 3,
      }).state;
    }
    expect(s.benefits.length).toBe(3);
  });
});
