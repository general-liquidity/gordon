import { afterEach, describe, expect, it } from "bun:test";
import { initSyncOutputFromEnv, isSyncOutputEnabled, enableSyncOutput } from "./syncOutput.ts";

afterEach(() => {
  // Restore module state from the real env so ordering can't leak between tests.
  initSyncOutputFromEnv();
});

describe("syncOutput enablement via shared detectTerminalCapability", () => {
  it("disables BSU/ESU under tmux (parses DEC 2026 but breaks atomicity)", () => {
    initSyncOutputFromEnv({ TMUX: "/tmp/tmux-1000/default,1,0", TERM_PROGRAM: "iTerm.app" });
    expect(isSyncOutputEnabled()).toBe(false);
  });

  it("disables BSU/ESU under GNU screen", () => {
    initSyncOutputFromEnv({ STY: "12345.pts-0.host" });
    expect(isSyncOutputEnabled()).toBe(false);
  });

  it("enables BSU/ESU on a supporting terminal (iTerm2)", () => {
    initSyncOutputFromEnv({ TERM_PROGRAM: "iTerm.app" });
    expect(isSyncOutputEnabled()).toBe(true);
  });

  it("disables BSU/ESU on a dumb terminal", () => {
    initSyncOutputFromEnv({ TERM: "dumb" });
    expect(isSyncOutputEnabled()).toBe(false);
  });

  it("manual enable override still works", () => {
    initSyncOutputFromEnv({ TMUX: "/tmp/tmux" });
    expect(isSyncOutputEnabled()).toBe(false);
    enableSyncOutput();
    expect(isSyncOutputEnabled()).toBe(true);
  });
});
