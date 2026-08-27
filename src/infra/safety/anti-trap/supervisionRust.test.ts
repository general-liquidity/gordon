import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SUPERVISION_FLAWS,
  getInjectionRate,
  shouldInjectFlaw,
  pickFlaw,
  injectFlaw,
  newSupervisionRecord,
  recordSupervisionResult,
  readSupervisionScore,
  type SupervisionFlaw,
} from "./supervisionRust.ts";

describe("supervisionRust", () => {
  let tmpPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "supervision-rust-"));
    tmpPath = join(dir, "log.jsonl");
  });

  describe("getInjectionRate", () => {
    it("returns 0 when env is unset", () => {
      expect(getInjectionRate({})).toBe(0);
    });

    it("parses valid fractions", () => {
      expect(getInjectionRate({ GORDON_SUPERVISION_RUST_RATE: "0.1" })).toBe(0.1);
    });

    it("returns 0 for invalid values", () => {
      expect(getInjectionRate({ GORDON_SUPERVISION_RUST_RATE: "foo" })).toBe(0);
      expect(getInjectionRate({ GORDON_SUPERVISION_RUST_RATE: "-1" })).toBe(0);
      expect(getInjectionRate({ GORDON_SUPERVISION_RUST_RATE: "2" })).toBe(0);
    });
  });

  describe("shouldInjectFlaw", () => {
    it("never injects when rate is 0", () => {
      expect(shouldInjectFlaw({}, () => 0)).toBe(false);
    });

    it("injects when rng < rate", () => {
      const env = { GORDON_SUPERVISION_RUST_RATE: "0.5" };
      expect(shouldInjectFlaw(env, () => 0.1)).toBe(true);
      expect(shouldInjectFlaw(env, () => 0.9)).toBe(false);
    });
  });

  describe("flaw library", () => {
    it("ships 5 flaws covering distinct categories", () => {
      expect(SUPERVISION_FLAWS).toHaveLength(5);
      const types = new Set(SUPERVISION_FLAWS.map((f) => f.type));
      expect(types.size).toBe(5);
    });

    it("wrong_direction flips long to short and vice versa", () => {
      const flaw = SUPERVISION_FLAWS.find((f) => f.flawId === "wrong_direction") as SupervisionFlaw;
      expect(flaw.apply({ direction: "long" }).direction).toBe("short");
      expect(flaw.apply({ direction: "short" }).direction).toBe("long");
    });

    it("excessive_size sets 25%", () => {
      const flaw = SUPERVISION_FLAWS.find((f) => f.flawId === "excessive_size") as SupervisionFlaw;
      expect(flaw.apply({ positionSizePct: 2 }).positionSizePct).toBe(25);
    });

    it("missing_stop deletes the stop field", () => {
      const flaw = SUPERVISION_FLAWS.find((f) => f.flawId === "missing_stop") as SupervisionFlaw;
      const out = flaw.apply({ stopLoss: 95, entry: 100 });
      expect(out.stopLoss).toBeUndefined();
      expect(out.entry).toBe(100);
    });
  });

  describe("pickFlaw", () => {
    it("returns a flaw deterministically given rng", () => {
      const f = pickFlaw(SUPERVISION_FLAWS, () => 0);
      expect(f.flawId).toBe(SUPERVISION_FLAWS[0]!.flawId);
    });
  });

  describe("injectFlaw", () => {
    it("returns the mutated plan and flaw metadata", () => {
      const flaw = SUPERVISION_FLAWS[0] as SupervisionFlaw;
      const out = injectFlaw({ direction: "long", entry: 100 }, flaw);
      expect(out.flawId).toBe(flaw.flawId);
      expect(out.flawType).toBe(flaw.type);
      expect(out.flawed.direction).toBe("short");
    });
  });

  describe("recordSupervisionResult + readSupervisionScore", () => {
    it("appends records and aggregates score", () => {
      recordSupervisionResult(
        newSupervisionRecord("wrong_direction", "wrong_direction", "p1", true),
        tmpPath,
      );
      recordSupervisionResult(
        newSupervisionRecord("excessive_size", "excessive_size", "p2", false),
        tmpPath,
      );
      recordSupervisionResult(
        newSupervisionRecord("missing_stop", "missing_stop", "p3", false),
        tmpPath,
      );

      const score = readSupervisionScore(tmpPath);
      expect(score.total).toBe(3);
      expect(score.caught).toBe(2);
      expect(score.missed).toBe(1);
      expect(score.catchRate).toBeCloseTo(2 / 3, 5);
    });

    it("returns perfect-score sentinel when file does not exist", () => {
      const missing = join(tmpPath, "..", "nonexistent.jsonl");
      const score = readSupervisionScore(missing);
      expect(score.total).toBe(0);
      expect(score.catchRate).toBe(1);
    });

    it("skips malformed JSONL lines without throwing", () => {
      recordSupervisionResult(
        newSupervisionRecord("wrong_direction", "wrong_direction", "p1", false),
        tmpPath,
      );
      // Manually append garbage
      const fs = require("node:fs");
      fs.appendFileSync(tmpPath, "not-json-at-all\n");
      const score = readSupervisionScore(tmpPath);
      expect(score.total).toBe(1);
      expect(score.caught).toBe(1);
    });
  });

  describe("newSupervisionRecord", () => {
    it("populates timestamps", () => {
      const rec = newSupervisionRecord("wrong_direction", "wrong_direction", "p1", false);
      expect(rec.planId).toBe("p1");
      expect(rec.userAccepted).toBe(false);
      expect(rec.injectedAt).toBeTruthy();
      expect(rec.decidedAt).toBeTruthy();
    });

    it("generates a planId if missing", () => {
      const rec = newSupervisionRecord("wrong_direction", "wrong_direction", "", false);
      expect(rec.planId.length).toBeGreaterThan(0);
    });
  });
});
