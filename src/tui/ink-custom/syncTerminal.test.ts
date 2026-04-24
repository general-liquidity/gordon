import { describe, expect, it } from "bun:test";

import { createSyncTerminal, detectTerminalCapability } from "./syncTerminal.ts";

// Build an isolated env bag so tests never touch the real process.env.
// Each field is explicitly listed so a stray inherited value can't leak in.
function makeEnv(
  overrides: Partial<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const base: Record<string, string> = {};
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe("detectTerminalCapability", () => {
  it("recognizes iTerm2 as sync + hyperlink capable", () => {
    const env = makeEnv({
      TERM: "xterm-256color",
      TERM_PROGRAM: "iTerm.app",
      TERM_PROGRAM_VERSION: "3.5.0",
    });
    const cap = detectTerminalCapability(env);

    expect(cap.supportsSyncUpdate).toBe(true);
    expect(cap.hasAlternateScreen).toBe(true);
    expect(cap.supportsHyperlink).toBe(true);
    expect(cap.detectedAs.toLowerCase()).toContain("iterm");
  });

  it("recognizes Windows Terminal via WT_SESSION", () => {
    const env = makeEnv({
      TERM: "xterm-256color",
      WT_SESSION: "abcdef12-3456-7890-abcd-ef1234567890",
    });
    const cap = detectTerminalCapability(env);

    expect(cap.supportsSyncUpdate).toBe(true);
    expect(cap.hasAlternateScreen).toBe(true);
    expect(cap.supportsHyperlink).toBe(true);
    expect(cap.detectedAs).toContain("WindowsTerminal");
  });

  it("recognizes kitty as sync capable", () => {
    const env = makeEnv({
      TERM: "xterm-kitty",
      TERM_PROGRAM: "kitty",
      TERM_PROGRAM_VERSION: "0.33.0",
    });
    const cap = detectTerminalCapability(env);

    expect(cap.supportsSyncUpdate).toBe(true);
    expect(cap.supportsHyperlink).toBe(true);
    expect(cap.detectedAs.toLowerCase()).toContain("kitty");
  });

  it("recognizes WezTerm and Ghostty as sync capable", () => {
    const wez = detectTerminalCapability(
      makeEnv({ TERM: "xterm-256color", TERM_PROGRAM: "WezTerm" }),
    );
    const ghostty = detectTerminalCapability(
      makeEnv({ TERM: "xterm-256color", TERM_PROGRAM: "ghostty" }),
    );
    expect(wez.supportsSyncUpdate).toBe(true);
    expect(ghostty.supportsSyncUpdate).toBe(true);
  });

  it("disables sync under tmux (multiplexer strips BSU)", () => {
    const env = makeEnv({
      TERM: "screen-256color",
      TERM_PROGRAM: "iTerm.app",
      TERM_PROGRAM_VERSION: "3.5.0",
      TMUX: "/tmp/tmux-1000/default,12345,0",
    });
    const cap = detectTerminalCapability(env);

    expect(cap.supportsSyncUpdate).toBe(false);
    expect(cap.detectedAs).toContain("tmux");
  });

  it("disables sync under GNU screen", () => {
    const env = makeEnv({
      TERM: "screen",
      TERM_PROGRAM: "iTerm.app",
      STY: "12345.pts-0.hostname",
    });
    const cap = detectTerminalCapability(env);

    expect(cap.supportsSyncUpdate).toBe(false);
  });

  it("flags TERM=dumb as minimal — no sync, no alt-screen, no hyperlinks", () => {
    const env = makeEnv({ TERM: "dumb" });
    const cap = detectTerminalCapability(env);

    expect(cap.supportsSyncUpdate).toBe(false);
    expect(cap.hasAlternateScreen).toBe(false);
    expect(cap.supportsHyperlink).toBe(false);
    expect(cap.detectedAs).toBe("dumb");
  });

  it("recognizes modern xterm hyperlinks based on version gate", () => {
    const supported = detectTerminalCapability(
      makeEnv({ TERM: "xterm-256color", TERM_PROGRAM: "xterm", TERM_PROGRAM_VERSION: "380" }),
    );
    const tooOld = detectTerminalCapability(
      makeEnv({ TERM: "xterm-256color", TERM_PROGRAM: "xterm", TERM_PROGRAM_VERSION: "340" }),
    );
    expect(supported.supportsHyperlink).toBe(true);
    expect(tooOld.supportsHyperlink).toBe(false);
  });

  it("falls back cleanly when no env vars are set", () => {
    const cap = detectTerminalCapability(makeEnv());
    expect(cap.supportsSyncUpdate).toBe(false);
    expect(cap.hasAlternateScreen).toBe(true);
    expect(cap.supportsHyperlink).toBe(false);
  });
});

describe("createSyncTerminal.wrapFrame", () => {
  it("brackets the payload with BSU/ESU on a supporting terminal", () => {
    const term = createSyncTerminal(
      makeEnv({ TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" }),
    );
    expect(term.capability.supportsSyncUpdate).toBe(true);
    expect(term.wrapFrame("HELLO")).toBe("\x1b[?2026hHELLO\x1b[?2026l");
  });

  it("returns the payload unchanged on a dumb terminal", () => {
    const term = createSyncTerminal(makeEnv({ TERM: "dumb" }));
    expect(term.capability.supportsSyncUpdate).toBe(false);
    expect(term.wrapFrame("HELLO")).toBe("HELLO");
  });

  it("returns the payload unchanged under tmux", () => {
    const term = createSyncTerminal(
      makeEnv({
        TERM: "screen-256color",
        TERM_PROGRAM: "iTerm.app",
        TMUX: "/tmp/tmux-1000/default,12345,0",
      }),
    );
    expect(term.capability.supportsSyncUpdate).toBe(false);
    expect(term.wrapFrame("FRAME")).toBe("FRAME");
  });

  it("exposes the detected capability on the returned object", () => {
    const term = createSyncTerminal(
      makeEnv({ TERM: "xterm-256color", WT_SESSION: "deadbeef" }),
    );
    expect(term.capability.supportsSyncUpdate).toBe(true);
    expect(term.capability.hasAlternateScreen).toBe(true);
    expect(term.capability.detectedAs).toContain("WindowsTerminal");
  });
});
