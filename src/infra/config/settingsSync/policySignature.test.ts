import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  POLICY_KEY_ENV,
  POLICY_PATH_ENV,
  inspectPolicyLayer,
  loadPolicyLayer,
  resetPolicyWarnings,
  writeSignedPolicy,
} from "./policySignature.ts";
import { loadLayeredSettings } from "../settingsLayers.ts";

const KEY = "org-policy-key-cafebabe";

describe("policy layer integrity", () => {
  let tmp: string;
  let path: string;
  const saved: Record<string, string | undefined> = {};

  function setEnv(k: string, v: string | undefined) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    path = join(tmp, "policy.json");
    setEnv(POLICY_PATH_ENV, path);
    setEnv(POLICY_KEY_ENV, KEY);
    resetPolicyWarnings();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) setEnv(k, v);
    for (const k of Object.keys(saved)) delete saved[k];
    rmSync(tmp, { recursive: true, force: true });
    resetPolicyWarnings();
  });

  test("a MISSING policy file is absent and silent", () => {
    const warnings: string[] = [];
    expect(inspectPolicyLayer().state).toBe("absent");
    expect(loadPolicyLayer(process.env, (m) => warnings.push(m))).toBeNull();
    expect(warnings).toEqual([]);
  });

  test("a missing policy file with no key configured is still silent", () => {
    setEnv(POLICY_KEY_ENV, undefined);
    const warnings: string[] = [];
    expect(loadPolicyLayer(process.env, (m) => warnings.push(m))).toBeNull();
    expect(warnings).toEqual([]);
  });

  test("a correctly signed policy file loads as the policy layer", () => {
    writeSignedPolicy({ flags: { GORDON_SANDBOX_SUBPROCESS: "1" } }, KEY, {
      origin: "desk",
      now: () => 42,
    });
    const state = inspectPolicyLayer();
    expect(state.state).toBe("applied");
    if (state.state === "applied") {
      expect(state.origin).toBe("desk");
      expect(state.signedAt).toBe(42);
      expect(state.keys).toEqual(["flags"]);
    }
    const layer = loadPolicyLayer(process.env, () => {});
    expect(layer).not.toBeNull();
    expect(layer!.layer).toBe("policy");
    expect(layer!.values).toEqual({ flags: { GORDON_SANDBOX_SUBPROCESS: "1" } });
  });

  test("a TAMPERED policy file does not take effect", () => {
    writeSignedPolicy({ flags: { GORDON_SANDBOX_SUBPROCESS: "1" } }, KEY, { now: () => 1 });
    const snapshot = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    (snapshot.values as Record<string, unknown>).flags = { GORDON_SANDBOX_SUBPROCESS: "0" };
    writeFileSync(path, JSON.stringify(snapshot));

    const state = inspectPolicyLayer();
    expect(state.state).toBe("refused");
    if (state.state === "refused") expect(state.reason).toBe("signature_mismatch");

    const warnings: string[] = [];
    expect(loadPolicyLayer(process.env, (m) => warnings.push(m))).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  test("an UNSIGNED (legacy flat) policy file is refused, not applied", () => {
    writeFileSync(path, JSON.stringify({ flags: { GORDON_SANDBOX_SUBPROCESS: "0" } }));
    const state = inspectPolicyLayer();
    expect(state.state).toBe("refused");
    if (state.state === "refused") expect(state.reason).toBe("malformed");
    expect(loadPolicyLayer(process.env, () => {})).toBeNull();
  });

  test("a signed policy file with no key configured is refused", () => {
    writeSignedPolicy({ flags: { GORDON_ACE_ENABLED: "true" } }, KEY, { now: () => 1 });
    setEnv(POLICY_KEY_ENV, undefined);
    const state = inspectPolicyLayer();
    expect(state.state).toBe("refused");
    if (state.state === "refused") expect(state.reason).toBe("no_key");
    expect(loadPolicyLayer(process.env, () => {})).toBeNull();
  });

  test("a policy file signed with the WRONG key is refused", () => {
    writeSignedPolicy({ flags: { GORDON_ACE_ENABLED: "true" } }, "some-other-key", {
      now: () => 1,
    });
    const state = inspectPolicyLayer();
    expect(state.state).toBe("refused");
    if (state.state === "refused") expect(state.reason).toBe("signature_mismatch");
  });

  test("unparseable policy file is refused as unreadable", () => {
    writeFileSync(path, "{not json");
    const state = inspectPolicyLayer();
    expect(state.state).toBe("refused");
    if (state.state === "refused") expect(state.reason).toBe("unreadable");
  });

  test("refusal warns once per path+reason, not on every settings load", () => {
    writeFileSync(path, JSON.stringify({ flags: {} }));
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    loadPolicyLayer(process.env, warn);
    loadPolicyLayer(process.env, warn);
    loadPolicyLayer(process.env, warn);
    expect(warnings).toHaveLength(1);
  });
});

describe("policy layer in the settings chain", () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};

  function setEnv(k: string, v: string | undefined) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gordon-policy-chain-"));
    setEnv(POLICY_PATH_ENV, join(tmp, "policy.json"));
    setEnv(POLICY_KEY_ENV, KEY);
    resetPolicyWarnings();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) setEnv(k, v);
    for (const k of Object.keys(saved)) delete saved[k];
    rmSync(tmp, { recursive: true, force: true });
    resetPolicyWarnings();
  });

  test("no policy file: the chain is unchanged and carries no policy layer", () => {
    const merged = loadLayeredSettings();
    expect(merged.layers.some((l) => l.layer === "policy")).toBe(false);
    expect(merged.config.permissionMode).toBe("ask");
  });

  test("a verified policy layer still outranks local (managed deployment)", () => {
    writeSignedPolicy({ policyMarker: "org" }, KEY, { now: () => 1 });
    const merged = loadLayeredSettings();
    expect(merged.layers.some((l) => l.layer === "policy")).toBe(true);
    expect(merged.config.policyMarker).toBe("org");
    expect(merged.provenance.policyMarker).toBe("policy");
  });

  test("a tampered policy file contributes nothing to the merged config", () => {
    writeSignedPolicy({ policyMarker: "org" }, "wrong-key", { now: () => 1 });
    const merged = loadLayeredSettings();
    expect(merged.layers.some((l) => l.layer === "policy")).toBe(false);
    expect(merged.config.policyMarker).toBeUndefined();
  });
});
