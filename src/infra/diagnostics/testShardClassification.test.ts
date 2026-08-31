import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findReachableBunModuleMock,
  sourceUsesBunModuleMock,
} from "../../../scripts/dev/checks/test-shard-mocks.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("release test-shard mock classification", () => {
  test("comments and strings cannot place a real-store suite in the mock shard", () => {
    expect(
      sourceUsesBunModuleMock(`
        // mock.module("./store.ts", () => ({}));
        const example = 'mock.module("./store.ts", () => ({}))';
      `),
    ).toBe(false);
  });

  test("recognizes named-import aliases and namespace imports semantically", () => {
    expect(
      sourceUsesBunModuleMock(`
        import { mock as bunMock } from "bun:test";
        bunMock.module("./store.ts", () => ({}));
      `),
    ).toBe(true);
    expect(
      sourceUsesBunModuleMock(`
        import * as bunTest from "bun:test";
        bunTest.mock.module("./store.ts", () => ({}));
      `),
    ).toBe(true);
  });

  test("follows runtime helper imports but ignores type-only imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-shard-classification-"));
    tempDirs.push(dir);
    const helper = join(dir, "mock-helper.ts");
    const types = join(dir, "types.ts");
    const mocked = join(dir, "mocked.test.ts");
    const real = join(dir, "real.test.ts");
    writeFileSync(
      helper,
      'import { mock as bunMock } from "bun:test"; bunMock.module("./store.ts", () => ({}));',
    );
    writeFileSync(types, 'import { mock } from "bun:test"; export type MockType = typeof mock;');
    writeFileSync(mocked, 'import "./mock-helper.ts";');
    writeFileSync(real, 'import type { MockType } from "./types.ts"; const value = 1;');

    expect(findReachableBunModuleMock(mocked)).toBe(helper);
    expect(findReachableBunModuleMock(real)).toBeNull();
  });
});
