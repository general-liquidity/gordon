import { describe, it, expect } from "bun:test";
import {
  OBSERVATIONAL_MEMORY_FLAG,
  OM_THRESHOLDS,
  isObservationalMemoryEnabled,
  buildObservationalMemoryOptions,
  buildTraderProfileExtractor,
} from "./observationalMemory.ts";

describe("isObservationalMemoryEnabled", () => {
  it("is off by default (flag unset)", () => {
    expect(isObservationalMemoryEnabled({})).toBe(false);
  });

  it("is off for any value other than '1'", () => {
    expect(isObservationalMemoryEnabled({ [OBSERVATIONAL_MEMORY_FLAG]: "true" })).toBe(false);
    expect(isObservationalMemoryEnabled({ [OBSERVATIONAL_MEMORY_FLAG]: "0" })).toBe(false);
    expect(isObservationalMemoryEnabled({ [OBSERVATIONAL_MEMORY_FLAG]: "" })).toBe(false);
  });

  it("is on when set to '1'", () => {
    expect(isObservationalMemoryEnabled({ [OBSERVATIONAL_MEMORY_FLAG]: "1" })).toBe(true);
  });
});

describe("buildObservationalMemoryOptions", () => {
  const opts = buildObservationalMemoryOptions({ model: "openai/gpt-4o-mini" });

  it("passes the caller model to both Observer and Reflector via top-level model", () => {
    expect(opts.model).toBe("openai/gpt-4o-mini");
  });

  it("scopes observations per-thread", () => {
    expect(opts.scope).toBe("thread");
  });

  it("maps observation thresholds (masking/pruning intent)", () => {
    expect(opts.observation.messageTokens).toBe(OM_THRESHOLDS.observation.messageTokens);
    expect(opts.observation.bufferTokens).toBe(OM_THRESHOLDS.observation.bufferTokens);
    expect(opts.observation.bufferActivation).toBe(OM_THRESHOLDS.observation.bufferActivation);
  });

  it("maps reflection thresholds (collapse intent)", () => {
    expect(opts.reflection.observationTokens).toBe(OM_THRESHOLDS.reflection.observationTokens);
  });

  it("forces synchronous compaction as a last resort (full-summary intent)", () => {
    expect(opts.observation.blockAfter).toBe(1.2);
    expect(opts.reflection.blockAfter).toBe(1.2);
  });

  it("wires the durable trader-profile extractor", () => {
    expect(opts.observation.extract).toHaveLength(1);
    expect(opts.observation.extract[0]?.slug).toBe("trader-profile");
  });

  it("sets an idle-activation flush window", () => {
    expect(opts.activateAfterIdle).toBe(OM_THRESHOLDS.activateAfterIdle);
  });
});

describe("buildTraderProfileExtractor", () => {
  it("persists to a stable OM metadata key", () => {
    const ex = buildTraderProfileExtractor();
    expect(ex.slug).toBe("trader-profile");
    expect(ex.metadataKeyPath).toBe("extracted.trader-profile");
  });

  it("uses structured (schema) extraction", () => {
    const ex = buildTraderProfileExtractor();
    expect(ex.mode).toBe("structured");
  });
});
