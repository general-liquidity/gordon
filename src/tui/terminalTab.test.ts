import { describe, expect, it } from "bun:test";
import { stripTitleAnsi } from "./terminalTab.ts";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("stripTitleAnsi", () => {
  it("leaves plain title text unchanged", () => {
    expect(stripTitleAnsi("gordon (opus) [BTC]")).toBe("gordon (opus) [BTC]");
  });

  it("strips an embedded OSC title-injection sequence", () => {
    const injected = "BTC " + ESC + "]0;pwned" + BEL + "USD";
    const clean = stripTitleAnsi(injected);
    expect(clean.includes(ESC)).toBe(false);
    expect(clean.includes(BEL)).toBe(false);
    expect(clean).toBe("BTC USD");
  });

  it("strips CSI/SGR color codes", () => {
    const colored = ESC + "[31mred" + ESC + "[0m";
    expect(stripTitleAnsi(colored)).toBe("red");
  });
});
