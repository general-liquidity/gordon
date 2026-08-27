import { afterEach, describe, expect, it } from "bun:test";
import { wrapForMultiplexer } from "./osc.ts";

const SEQ = "\x1b]0;gordon\x07";

const savedTmux = process.env.TMUX;
const savedSty = process.env.STY;

afterEach(() => {
  if (savedTmux === undefined) delete process.env.TMUX;
  else process.env.TMUX = savedTmux;
  if (savedSty === undefined) delete process.env.STY;
  else process.env.STY = savedSty;
});

describe("wrapForMultiplexer", () => {
  it("returns the sequence unchanged outside a multiplexer", () => {
    delete process.env.TMUX;
    delete process.env.STY;
    expect(wrapForMultiplexer(SEQ)).toBe(SEQ);
  });

  it("wraps in tmux DCS passthrough and doubles inner ESC when $TMUX is set", () => {
    delete process.env.STY;
    process.env.TMUX = "/tmp/tmux-1000/default,1,0";
    // ESC ] 0 ; gordon BEL  ->  ESC P tmux ; ESC ESC ] 0 ; gordon BEL ESC \
    expect(wrapForMultiplexer(SEQ)).toBe(`\x1bPtmux;\x1b\x1b]0;gordon\x07\x1b\\`);
  });

  it("wraps in screen DCS passthrough when $STY is set", () => {
    delete process.env.TMUX;
    process.env.STY = "12345.pts-0.host";
    expect(wrapForMultiplexer(SEQ)).toBe(`\x1bP${SEQ}\x1b\\`);
  });

  it("prefers the tmux wrapping when both $TMUX and $STY are set", () => {
    process.env.TMUX = "/tmp/tmux";
    process.env.STY = "12345.pts-0.host";
    expect(wrapForMultiplexer(SEQ).startsWith("\x1bPtmux;")).toBe(true);
  });
});
