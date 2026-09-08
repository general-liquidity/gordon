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

  // Three shapes the tracer used to miss. The first two are the dangerous
  // direction: a mocking file that reads as clean sits in a real-store shard
  // and reproduces the process-wide leak the split exists to prevent. The
  // third made the gate throw a parser error instead of returning a verdict.
  test("follows a helper reached through a dynamic import", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-shard-dynamic-"));
    tempDirs.push(dir);
    const helper = join(dir, "mock-helper.ts");
    const entry = join(dir, "dynamic.test.ts");
    writeFileSync(
      helper,
      'import { mock } from "bun:test"; mock.module("./store.ts", () => ({}));',
    );
    writeFileSync(entry, 'const h = await import("./mock-helper.ts"); export { h };');

    expect(findReachableBunModuleMock(entry)).toBe(helper);
  });

  test("binds mock re-exported from bun:test through a local module", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-shard-reexport-"));
    tempDirs.push(dir);
    const barrel = join(dir, "barrel.ts");
    const entry = join(dir, "reexport.test.ts");
    writeFileSync(barrel, 'export { mock } from "bun:test";');
    writeFileSync(
      entry,
      'import { mock } from "./barrel.ts"; mock.module("./store.ts", () => ({}));',
    );

    expect(findReachableBunModuleMock(entry)).toBe(entry);
  });

  test("parses a tsx dependency instead of throwing on its markup", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-shard-tsx-"));
    tempDirs.push(dir);
    const widget = join(dir, "widget.tsx");
    const entry = join(dir, "tsx.test.ts");
    writeFileSync(widget, 'export const W = () => <div className="a">hi</div>;');
    writeFileSync(entry, 'import { W } from "./widget.tsx"; export { W };');

    expect(findReachableBunModuleMock(entry)).toBeNull();
  });
});
