import { describe, expect, it } from "bun:test";
import { isXtermJsTerminal, targetChalkLevel } from "./colorize.ts";

describe("isXtermJsTerminal", () => {
  it("detects TERM_PROGRAM=vscode (VS Code / Cursor)", () => {
    expect(isXtermJsTerminal({ TERM_PROGRAM: "vscode" })).toBe(true);
  });

  it("detects a VSCODE_ prefixed env var (integrated terminal / code-server)", () => {
    expect(isXtermJsTerminal({ VSCODE_GIT_ASKPASS_NODE: "/x" })).toBe(true);
  });

  it("is false for a plain iTerm2 env", () => {
    expect(isXtermJsTerminal({ TERM_PROGRAM: "iTerm.app" })).toBe(false);
  });

  it("is false for an empty env", () => {
    expect(isXtermJsTerminal({})).toBe(false);
  });
});

describe("targetChalkLevel", () => {
  it("boosts xterm.js from level 2 to truecolor (3)", () => {
    expect(targetChalkLevel(2, { TERM_PROGRAM: "vscode" })).toBe(3);
  });

  it("boosts via VSCODE_ prefix too", () => {
    expect(targetChalkLevel(2, { VSCODE_PID: "123" })).toBe(3);
  });

  it("does NOT boost level 0 — respects NO_COLOR / FORCE_COLOR=0", () => {
    expect(targetChalkLevel(0, { TERM_PROGRAM: "vscode" })).toBe(0);
  });

  it("does NOT boost level 1", () => {
    expect(targetChalkLevel(1, { TERM_PROGRAM: "vscode" })).toBe(1);
  });

  it("clamps tmux truecolor (3) down to 256-color (2)", () => {
    expect(targetChalkLevel(3, { TMUX: "/tmp/tmux-1000/default,1,0" })).toBe(2);
  });

  it("leaves tmux at level 2 unchanged", () => {
    expect(targetChalkLevel(2, { TMUX: "/tmp/tmux" })).toBe(2);
  });

  it("tmux-inside-VS-Code boosts then re-clamps to 2 (passthrough limit wins)", () => {
    expect(targetChalkLevel(2, { TERM_PROGRAM: "vscode", TMUX: "/tmp/tmux" })).toBe(2);
  });

  it("leaves a plain truecolor terminal at level 3", () => {
    expect(targetChalkLevel(3, { TERM_PROGRAM: "iTerm.app" })).toBe(3);
  });
});
