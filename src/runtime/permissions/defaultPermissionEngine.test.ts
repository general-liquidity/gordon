import { describe, expect, test } from "bun:test";
import {
  getDefaultPermissionEngine,
  resetDefaultPermissionEngineForTesting,
} from "./defaultPermissionEngine.ts";

describe("getDefaultPermissionEngine", () => {
  test("returns a singleton PermissionEngine with trust hook", () => {
    resetDefaultPermissionEngineForTesting();
    const a = getDefaultPermissionEngine();
    const b = getDefaultPermissionEngine();
    expect(a).toBe(b);
    expect(typeof a.prependHook).toBe("function");
  });
});
