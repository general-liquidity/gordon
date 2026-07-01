import { describe, expect, it } from "bun:test";
import {
  applyHysteresis,
  createHysteresisState,
  RegimeHysteresisGate,
  isRegimeHysteresisEnabled,
  regimeHysteresisConfigFromEnv,
  type HysteresisState,
} from "./hysteresisGate.ts";
import type { MarketRegime } from "./types.ts";

function feed(
  seq: MarketRegime[],
  config: Parameters<typeof applyHysteresis>[2] = { confirmBars: 3 },
): { accepted: MarketRegime[]; state: HysteresisState } {
  let state = createHysteresisState();
  const accepted: MarketRegime[] = [];
  for (const r of seq) {
    const res = applyHysteresis(state, r, config);
    state = res.state;
    accepted.push(res.regime);
  }
  return { accepted, state };
}

describe("applyHysteresis", () => {
  it("accepts the first detection immediately", () => {
    const res = applyHysteresis(createHysteresisState(), "ranging", { confirmBars: 3 });
    expect(res.regime).toBe("ranging");
    expect(res.shifted).toBe(true);
    expect(res.state.acceptedRegime).toBe("ranging");
  });

  it("absorbs a single-bar flicker, holding the prior regime", () => {
    const { accepted } = feed(["ranging", "volatile", "ranging", "ranging"], { confirmBars: 3 });
    // the lone `volatile` never reaches 3 consecutive -> held as ranging throughout.
    expect(accepted).toEqual(["ranging", "ranging", "ranging", "ranging"]);
  });

  it("accepts a shift once it persists confirmBars consecutive detections", () => {
    const { accepted, state } = feed(
      ["ranging", "volatile", "volatile", "volatile"],
      { confirmBars: 3 },
    );
    expect(accepted).toEqual(["ranging", "ranging", "ranging", "volatile"]);
    expect(state.acceptedRegime).toBe("volatile");
  });

  it("resets the pending count when the candidate is interrupted", () => {
    // volatile,volatile then a ranging (accepted) breaks the run; needs 3 fresh.
    const { accepted, state } = feed(
      ["ranging", "volatile", "volatile", "ranging", "volatile", "volatile"],
      { confirmBars: 3 },
    );
    expect(state.acceptedRegime).toBe("ranging");
    expect(accepted[accepted.length - 1]).toBe("ranging");
  });

  it("switches between two distinct pending candidates without confirming either", () => {
    const { accepted, state } = feed(
      ["ranging", "volatile", "breakout", "volatile", "breakout"],
      { confirmBars: 3 },
    );
    expect(state.acceptedRegime).toBe("ranging");
    expect(accepted.every((r) => r === "ranging")).toBe(true);
  });

  it("confirmBars=1 accepts every change immediately (hysteresis off)", () => {
    const { accepted } = feed(["ranging", "volatile", "ranging"], { confirmBars: 1 });
    expect(accepted).toEqual(["ranging", "volatile", "ranging"]);
  });

  it("confirms via the time gate when confirmMs elapses", () => {
    let state = createHysteresisState();
    const config = { confirmBars: 100, confirmMs: 60_000 };
    // t=0 accept ranging
    state = applyHysteresis(state, "ranging", config, 0).state;
    // t=1000 first volatile (pending)
    let res = applyHysteresis(state, "volatile", config, 1_000);
    state = res.state;
    expect(res.regime).toBe("ranging");
    // t=70_000 second volatile: 69s >= 60s dwell -> confirmed despite bars<100.
    res = applyHysteresis(state, "volatile", config, 70_000);
    expect(res.regime).toBe("volatile");
    expect(res.shifted).toBe(true);
  });
});

describe("RegimeHysteresisGate", () => {
  it("tracks independent state per key", () => {
    const gate = new RegimeHysteresisGate({ confirmBars: 2 });
    expect(gate.accept("BTC:1h", "ranging").regime).toBe("ranging");
    expect(gate.accept("ETH:1h", "volatile").regime).toBe("volatile");
    // BTC flicker held; ETH independent.
    expect(gate.accept("BTC:1h", "volatile").regime).toBe("ranging");
    expect(gate.accept("BTC:1h", "volatile").regime).toBe("volatile"); // 2 consecutive
    expect(gate.current("BTC:1h")).toBe("volatile");
    expect(gate.current("ETH:1h")).toBe("volatile");
  });

  it("resets a key", () => {
    const gate = new RegimeHysteresisGate({ confirmBars: 2 });
    gate.accept("BTC:1h", "ranging");
    gate.reset("BTC:1h");
    expect(gate.current("BTC:1h")).toBeNull();
  });
});

describe("env config", () => {
  it("is disabled by default", () => {
    expect(isRegimeHysteresisEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("reads bars and minutes from env", () => {
    const cfg = regimeHysteresisConfigFromEnv({
      GORDON_REGIME_HYSTERESIS_BARS: "4",
      GORDON_REGIME_HYSTERESIS_MINUTES: "5",
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.confirmBars).toBe(4);
    expect(cfg.confirmMs).toBe(5 * 60 * 1000);
  });
});
