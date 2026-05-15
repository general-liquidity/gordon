import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isInitializerAgentEnabled,
  defaultInitializerMarkerPath,
  isInitialized,
  loadInitializationMarker,
  writeInitializationMarker,
  runInitializer,
  hashInitConfig,
  markerToPayload,
  INITIALIZER_AGENT_FLAG_ENV,
  INITIALIZER_MARKER_PATH_ENV,
  type InitializationMarker,
} from "./initializerAgent.ts";

let tempDir: string;
let markerPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-initializer-test-"));
  markerPath = join(tempDir, "initialized.json");
});

describe("isInitializerAgentEnabled", () => {
  it("respects the flag", () => {
    expect(isInitializerAgentEnabled({})).toBe(false);
    expect(isInitializerAgentEnabled({ [INITIALIZER_AGENT_FLAG_ENV]: "1" })).toBe(true);
    expect(isInitializerAgentEnabled({ [INITIALIZER_AGENT_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("defaultInitializerMarkerPath", () => {
  it("honors env override", () => {
    expect(
      defaultInitializerMarkerPath({ [INITIALIZER_MARKER_PATH_ENV]: "/x.json" }),
    ).toBe("/x.json");
  });
  it("falls back to home-dir default", () => {
    expect(defaultInitializerMarkerPath({})).toContain("initialized.json");
  });
});

describe("isInitialized", () => {
  it("returns false when marker is absent", () => {
    expect(isInitialized(markerPath)).toBe(false);
  });

  it("returns true after a marker is written", () => {
    writeInitializationMarker(
      {
        initializedAt: "2026-05-13T00:00:00.000Z",
        version: 1,
        configHash: "abc",
        artifactsWritten: ["/x"],
      },
      markerPath,
    );
    expect(isInitialized(markerPath)).toBe(true);
  });

  it("returns false on corrupt marker", () => {
    writeFileSync(markerPath, "not-json{", "utf8");
    expect(isInitialized(markerPath)).toBe(false);
  });

  it("returns false on missing fields", () => {
    writeFileSync(markerPath, JSON.stringify({ initializedAt: 123 }), "utf8");
    expect(isInitialized(markerPath)).toBe(false);
  });
});

describe("loadInitializationMarker", () => {
  it("returns null when missing", () => {
    expect(loadInitializationMarker(markerPath)).toBeNull();
  });

  it("returns the parsed marker", () => {
    const m: InitializationMarker = {
      initializedAt: "2026-05-13T00:00:00.000Z",
      version: 1,
      configHash: "abc",
      artifactsWritten: ["/x"],
    };
    writeInitializationMarker(m, markerPath);
    expect(loadInitializationMarker(markerPath)).toEqual(m);
  });
});

describe("runInitializer — one-shot semantics", () => {
  it("runs on first call (no existing marker)", () => {
    const result = runInitializer(
      { configHash: "abc", artifactsWritten: ["/a", "/b"] },
      { markerPath, now: "2026-05-13T00:00:00.000Z" },
    );
    expect(result.ran).toBe(true);
    expect(result.reason).toBe("first_session");
    expect(result.marker?.configHash).toBe("abc");
    expect(existsSync(markerPath)).toBe(true);
  });

  it("does NOT run on subsequent calls (no-op when initialized)", () => {
    runInitializer(
      { configHash: "abc", artifactsWritten: ["/a"] },
      { markerPath, now: "2026-05-13T00:00:00.000Z" },
    );
    const second = runInitializer(
      { configHash: "abc", artifactsWritten: ["/a"] },
      { markerPath, now: "2026-05-13T01:00:00.000Z" },
    );
    expect(second.ran).toBe(false);
    expect(second.reason).toBe("already_initialized");
    // Marker preserved from first run
    expect(second.marker?.initializedAt).toBe("2026-05-13T00:00:00.000Z");
  });

  it("force=true re-runs and replaces the marker", () => {
    runInitializer(
      { configHash: "abc", artifactsWritten: ["/a"] },
      { markerPath, now: "2026-05-13T00:00:00.000Z" },
    );
    const forced = runInitializer(
      { configHash: "xyz", artifactsWritten: ["/b"] },
      {
        markerPath,
        now: "2026-05-13T02:00:00.000Z",
        force: true,
        forceReason: "operator triggered /reinit",
      },
    );
    expect(forced.ran).toBe(true);
    expect(forced.reason).toBe("forced");
    expect(forced.marker?.configHash).toBe("xyz");
    expect(forced.marker?.notes).toContain("re-initialized: operator triggered /reinit");
  });

  it("merges supplied notes into the marker", () => {
    const result = runInitializer(
      { configHash: "abc", artifactsWritten: [], notes: ["fresh install"] },
      { markerPath, now: "2026-05-13T00:00:00.000Z" },
    );
    expect(result.marker?.notes).toContain("fresh install");
  });

  it("records every artifact path", () => {
    const result = runInitializer(
      {
        configHash: "abc",
        artifactsWritten: [
          "/sprint-contract.json",
          "/mandate.json",
          "/feature-list.json",
        ],
      },
      { markerPath, now: "2026-05-13T00:00:00.000Z" },
    );
    expect(result.marker?.artifactsWritten.length).toBe(3);
  });
});

describe("hashInitConfig", () => {
  it("returns the same hash for equal inputs", () => {
    const a = hashInitConfig({ x: 1, y: "a" });
    const b = hashInitConfig({ x: 1, y: "a" });
    expect(a).toBe(b);
  });

  it("returns different hashes for different inputs", () => {
    expect(hashInitConfig({ x: 1 })).not.toBe(hashInitConfig({ x: 2 }));
  });

  it("returns an 8-char hex string", () => {
    expect(hashInitConfig({ x: 1 })).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("markerToPayload", () => {
  it("emits stable shape", () => {
    const m: InitializationMarker = {
      initializedAt: "2026-05-13T00:00:00.000Z",
      version: 1,
      configHash: "abc",
      artifactsWritten: ["/x", "/y"],
    };
    const p = markerToPayload(m);
    expect(p.kind).toBe("initializer.marker_recorded");
    expect(p.artifactCount).toBe(2);
  });
});
