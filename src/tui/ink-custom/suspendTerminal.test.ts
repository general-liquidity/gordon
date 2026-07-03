import { describe, expect, test } from "bun:test";

import { createSuspendTerminal, noopSuspendTerminal } from "./suspendTerminal.ts";

type Harness = {
  suspend: ReturnType<typeof createSuspendTerminal>;
  log: string[];
  rawMode: () => boolean;
  painting: () => boolean;
};

function makeHarness(overrides: Partial<Record<string, () => void>> = {}): Harness {
  const log: string[] = [];
  let rawMode = true;
  let painting = true;
  const suspend = createSuspendTerminal({
    pauseRender:
      (overrides.pauseRender as (() => void) | undefined) ??
      (() => {
        painting = false;
        log.push("pauseRender");
      }),
    resumeRender:
      (overrides.resumeRender as (() => void) | undefined) ??
      (() => {
        painting = true;
        log.push("resumeRender");
      }),
    pauseInput:
      (overrides.pauseInput as (() => void) | undefined) ??
      (() => {
        rawMode = false;
        log.push("pauseInput");
      }),
    resumeInput:
      (overrides.resumeInput as (() => void) | undefined) ??
      (() => {
        rawMode = true;
        log.push("resumeInput");
      }),
  });
  return { suspend, log, rawMode: () => rawMode, painting: () => painting };
}

describe("createSuspendTerminal (callback form)", () => {
  test("releases the terminal around the callback and restores it after", async () => {
    const h = makeHarness();
    let rawDuringCallback = true;
    let paintingDuringCallback = true;

    await h.suspend(() => {
      // Inside the suspension: raw mode off, painting paused.
      rawDuringCallback = h.rawMode();
      paintingDuringCallback = h.painting();
      h.log.push("external");
    });

    // Raw mode toggled off (during) then back on (after).
    expect(rawDuringCallback).toBe(false);
    expect(h.rawMode()).toBe(true);
    // Render paused (during) then resumed (after).
    expect(paintingDuringCallback).toBe(false);
    expect(h.painting()).toBe(true);
    // Order: pause both, run external, resume both.
    expect(h.log).toEqual([
      "pauseRender",
      "pauseInput",
      "external",
      "resumeInput",
      "resumeRender",
    ]);
  });

  test("restores the terminal even when the callback throws", async () => {
    const h = makeHarness();
    await expect(
      h.suspend(() => {
        throw new Error("editor blew up");
      }),
    ).rejects.toThrow("editor blew up");
    // Input + render reclaimed despite the throw.
    expect(h.rawMode()).toBe(true);
    expect(h.painting()).toBe(true);
    expect(h.log).toEqual(["pauseRender", "pauseInput", "resumeInput", "resumeRender"]);
  });

  test("awaits an async callback before restoring", async () => {
    const h = makeHarness();
    let resolved = false;
    await h.suspend(async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
    });
    expect(resolved).toBe(true);
    expect(h.log[h.log.length - 1]).toBe("resumeRender");
  });
});

describe("createSuspendTerminal (handle form)", () => {
  test("resume() reclaims the terminal", async () => {
    const h = makeHarness();
    const suspension = await h.suspend();
    expect(h.rawMode()).toBe(false);
    expect(h.painting()).toBe(false);
    await suspension.resume();
    expect(h.rawMode()).toBe(true);
    expect(h.painting()).toBe(true);
  });

  test("asyncDispose resumes the suspension", async () => {
    const h = makeHarness();
    const suspension = await h.suspend();
    await suspension[Symbol.asyncDispose]();
    expect(h.rawMode()).toBe(true);
    expect(h.painting()).toBe(true);
  });

  test("resuming twice is a no-op the second time", async () => {
    const h = makeHarness();
    const suspension = await h.suspend();
    await suspension.resume();
    const lengthAfterFirst = h.log.length;
    await suspension.resume();
    expect(h.log.length).toBe(lengthAfterFirst);
  });
});

describe("createSuspendTerminal (guards)", () => {
  test("throws when already suspended", async () => {
    const h = makeHarness();
    await h.suspend();
    await expect(h.suspend()).rejects.toThrow("already suspended");
  });

  test("reclaims input and does not strand the app if pauseInput throws", async () => {
    let resumed = false;
    const suspend = createSuspendTerminal({
      pauseRender: () => {},
      resumeRender: () => {},
      pauseInput: () => {
        throw new Error("setRawMode failed");
      },
      resumeInput: () => {
        resumed = true;
      },
    });
    await expect(suspend(() => {})).rejects.toThrow("setRawMode failed");
    expect(resumed).toBe(true);
    // Not stranded: a fresh suspend re-enters begin() (reaching pauseInput
    // again) rather than rejecting with "already suspended".
    await expect(suspend(() => {})).rejects.toThrow("setRawMode failed");
  });
});

describe("noopSuspendTerminal", () => {
  test("runs the callback without touching the terminal", async () => {
    let ran = false;
    await noopSuspendTerminal(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  test("returns a resumable handle in the handle form", async () => {
    const suspension = await noopSuspendTerminal();
    await suspension.resume();
    await suspension[Symbol.asyncDispose]();
  });
});
