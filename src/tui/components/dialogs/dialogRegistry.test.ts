import { describe, expect, test } from "bun:test";
import { DIALOG_IDS, DIALOG_REGISTRY } from "./dialogRegistry.tsx";

describe("dialogRegistry", () => {
  test("has one valid entry for every dialog id", () => {
    expect(new Set(DIALOG_IDS).size).toBe(DIALOG_IDS.length);
    for (const id of DIALOG_IDS) {
      expect(DIALOG_REGISTRY[id]).toBeTruthy();
      expect(["overlay", "replace"]).toContain(DIALOG_REGISTRY[id].mode);
    }
  });
});
