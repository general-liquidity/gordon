import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectSafetyRelaxations,
  loadRemoteSyncLayer,
  pullSettings,
  pushSettings,
  signSnapshot,
  verifySnapshot,
  writeSyncCache,
  type RemoteSettingsClient,
  type SettingsSnapshot,
} from "./index.ts";
import { loadLayeredSettings } from "../settingsLayers.ts";

const KEY = "operator-shared-key-deadbeef";

/** In-memory fake remote — the injected transport for round-trip tests. */
function fakeRemote(): RemoteSettingsClient & { stored: SettingsSnapshot | null } {
  const state = { stored: null as SettingsSnapshot | null };
  return {
    stored: null,
    async getSnapshot() {
      return state.stored;
    },
    async putSnapshot(snapshot) {
      state.stored = snapshot;
      this.stored = snapshot;
    },
  };
}

describe("settings-sync push→pull round-trip", () => {
  test("pushed values come back verified and intact", async () => {
    const remote = fakeRemote();
    const values = { risk: { maxRiskPerTrade: 0.01 }, venue: "binance" };

    const pushed = await pushSettings({
      client: remote,
      values,
      key: KEY,
      origin: "desktop",
      now: () => 1000,
    });
    expect(pushed.signature).toBeTruthy();
    expect(pushed.signedAt).toBe(1000);

    const result = await pullSettings({ client: remote, key: KEY });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.snapshot.values).toEqual(values);
      expect(result.relaxations).toEqual([]);
    }
  });

  test("pull returns 'none' when nothing was pushed", async () => {
    const remote = fakeRemote();
    const result = await pullSettings({ client: remote, key: KEY });
    expect(result.status).toBe("none");
  });
});

describe("signature rejection", () => {
  test("unsigned snapshot is rejected", async () => {
    const remote = fakeRemote();
    // bypass signing — push a raw unsigned snapshot
    await remote.putSnapshot({
      version: 1,
      origin: "x",
      signedAt: 1,
      values: { risk: { maxRiskPerTrade: 0.5 } },
      signature: "",
    });
    const result = await pullSettings({ client: remote, key: KEY });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("unsigned");
  });

  test("tampered values invalidate the signature", async () => {
    const signed = signSnapshot(
      { version: 1, origin: "x", signedAt: 1, values: { risk: { maxRiskPerTrade: 0.01 } } },
      KEY,
    );
    const tampered = { ...signed, values: { risk: { maxRiskPerTrade: 0.9 } } };
    const v = verifySnapshot(tampered, KEY);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("signature_mismatch");
  });

  test("wrong key rejects an otherwise-valid snapshot", async () => {
    const remote = fakeRemote();
    await pushSettings({ client: remote, values: { a: 1 }, key: KEY, now: () => 1 });
    const result = await pullSettings({ client: remote, key: "different-key" });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("signature_mismatch");
  });
});

describe("safety-relax guard", () => {
  test("a pulled value that RAISES a risk limit is flagged", () => {
    const violations = detectSafetyRelaxations(
      { risk: { maxRiskPerTrade: 0.01 } },
      { risk: { maxRiskPerTrade: 0.05 } },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe("limit_relaxed");
    expect(violations[0]!.path).toBe("risk.maxRiskPerTrade");
  });

  test("tightening a risk limit is NOT flagged", () => {
    const violations = detectSafetyRelaxations(
      { risk: { maxRiskPerTrade: 0.05 } },
      { risk: { maxRiskPerTrade: 0.01 } },
    );
    expect(violations).toEqual([]);
  });

  test("changing venue / account type / base currency is flagged", () => {
    const violations = detectSafetyRelaxations(
      { venue: "binance", accountType: "paper", baseCurrency: "USD" },
      { venue: "okx", accountType: "live", baseCurrency: "EUR" },
    );
    expect(violations.map((v) => v.path).sort()).toEqual([
      "accountType",
      "baseCurrency",
      "venue",
    ]);
    expect(violations.every((v) => v.kind === "identity_changed")).toBe(true);
  });

  test("blockOnRelax rejects a relaxing pull; default surfaces but applies", async () => {
    const remote = fakeRemote();
    await pushSettings({
      client: remote,
      values: { risk: { maxRiskPerTrade: 0.5 } },
      key: KEY,
      now: () => 1,
    });
    const current = { risk: { maxRiskPerTrade: 0.01 } };

    const blocked = await pullSettings({ client: remote, key: KEY, current, blockOnRelax: true, warn: () => {} });
    expect(blocked.status).toBe("blocked");

    const surfaced = await pullSettings({ client: remote, key: KEY, current, warn: () => {} });
    expect(surfaced.status).toBe("ok");
    if (surfaced.status === "ok") expect(surfaced.relaxations).toHaveLength(1);
  });
});

describe("flag-gated layer in settingsLayers", () => {
  let tmp: string;
  let cachePath: string;
  const saved: Record<string, string | undefined> = {};

  function setEnv(k: string, v: string | undefined) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gordon-sync-"));
    cachePath = join(tmp, "settings.synced.json");
    setEnv("GORDON_SETTINGS_SYNC_KEY", KEY);
    setEnv("GORDON_SETTINGS_SYNC_CACHE_PATH", cachePath);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) setEnv(k, v);
    for (const k of Object.keys(saved)) delete saved[k];
    rmSync(tmp, { recursive: true, force: true });
  });

  test("flag OFF: no synced layer, behavior unchanged", () => {
    setEnv("GORDON_SETTINGS_SYNC", undefined);
    const snapshot = signSnapshot(
      { version: 1, origin: "vps", signedAt: 1, values: { syncedMarker: true } },
      KEY,
    );
    writeSyncCache(snapshot);

    expect(loadRemoteSyncLayer()).toBeNull();
    const merged = loadLayeredSettings();
    expect(merged.layers.some((l) => l.layer === "synced")).toBe(false);
    expect(merged.config.syncedMarker).toBeUndefined();
  });

  test("flag ON: verified cached snapshot becomes a 'synced' layer", () => {
    setEnv("GORDON_SETTINGS_SYNC", "1");
    const snapshot = signSnapshot(
      { version: 1, origin: "vps", signedAt: 1, values: { syncedMarker: true } },
      KEY,
    );
    writeSyncCache(snapshot);

    const layer = loadRemoteSyncLayer();
    expect(layer).not.toBeNull();
    expect(layer!.layer).toBe("synced");

    const merged = loadLayeredSettings();
    expect(merged.config.syncedMarker).toBe(true);
    expect(merged.provenance.syncedMarker).toBe("synced");
  });

  test("flag ON but cached snapshot tampered: layer rejected", () => {
    setEnv("GORDON_SETTINGS_SYNC", "1");
    const snapshot = signSnapshot(
      { version: 1, origin: "vps", signedAt: 1, values: { syncedMarker: true } },
      KEY,
    );
    // tamper after signing
    writeSyncCache({ ...snapshot, values: { syncedMarker: false } });

    expect(loadRemoteSyncLayer()).toBeNull();
  });
});
