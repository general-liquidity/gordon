import { describe, expect, test } from "bun:test";
import { supportsHyperlinks, osc8Link, linkString } from "./Link.tsx";

describe("supportsHyperlinks", () => {
  test("detects hyperlink-capable terminals via env", () => {
    expect(supportsHyperlinks({ WT_SESSION: "abc" })).toBe(true); // Windows Terminal
    expect(supportsHyperlinks({ VTE_VERSION: "6800" })).toBe(true); // GNOME/Konsole
    expect(supportsHyperlinks({ TERM_PROGRAM: "iTerm.app" })).toBe(true);
    expect(supportsHyperlinks({ TERM_PROGRAM: "WezTerm" })).toBe(true);
    expect(supportsHyperlinks({ TERM: "xterm-kitty" })).toBe(true);
    expect(supportsHyperlinks({ KITTY_WINDOW_ID: "1" })).toBe(true);
  });

  test("returns false for unknown / dumb / no-color terminals", () => {
    expect(supportsHyperlinks({ TERM: "xterm-256color" })).toBe(false);
    expect(supportsHyperlinks({ TERM: "dumb" })).toBe(false);
    expect(supportsHyperlinks({})).toBe(false);
  });

  test("NO_COLOR overrides a capable terminal", () => {
    expect(supportsHyperlinks({ WT_SESSION: "abc", NO_COLOR: "1" })).toBe(false);
  });

  test("FORCE_HYPERLINK forces support on", () => {
    expect(supportsHyperlinks({ TERM: "dumb", FORCE_HYPERLINK: "1" })).toBe(false); // dumb wins
    expect(supportsHyperlinks({ FORCE_HYPERLINK: "1" })).toBe(true);
  });
});

describe("osc8Link", () => {
  test("wraps text in the ST-terminated OSC-8 sequence", () => {
    const out = osc8Link("https://example.com/x", "Example");
    expect(out).toBe("\x1b]8;;https://example.com/x\x1b\\Example\x1b]8;;\x1b\\");
  });
});

describe("linkString", () => {
  test("emits OSC-8 when supported", () => {
    const url = "https://sec.gov/filing/1";
    const out = linkString(url, "Filing", { TERM_PROGRAM: "iTerm.app" });
    expect(out).toContain("\x1b]8;;");
    expect(out).toBe(osc8Link(url, "Filing"));
  });

  test("falls back to plain text when unsupported", () => {
    const out = linkString("https://sec.gov/filing/1", "Filing", { TERM: "xterm-256color" });
    expect(out).toBe("Filing");
    expect(out).not.toContain("\x1b]8");
  });
});
