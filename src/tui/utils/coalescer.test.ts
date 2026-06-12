import { describe, expect, it } from "bun:test";
import { createCoalescer } from "./coalescer.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createCoalescer", () => {
  it("batches bursts while preserving item order", async () => {
    const batches: number[][] = [];
    const coalescer = createCoalescer<number>((items) => batches.push(items), 20);
    for (let i = 0; i < 100; i++) coalescer.push(i);
    await sleep(35);
    const flattened = batches.flat();
    expect(batches.length).toBeLessThanOrEqual(2);
    expect(flattened).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("flushes immediately after idle", async () => {
    const batches: string[][] = [];
    const coalescer = createCoalescer<string>((items) => batches.push(items), 20);
    coalescer.push("a");
    expect(batches).toEqual([["a"]]);
    await sleep(25);
    coalescer.push("b");
    expect(batches.at(-1)).toEqual(["b"]);
  });

  it("dispose drops pending items", async () => {
    const batches: string[][] = [];
    const coalescer = createCoalescer<string>((items) => batches.push(items), 50);
    coalescer.push("a");
    coalescer.push("b");
    coalescer.dispose();
    await sleep(65);
    expect(batches).toEqual([["a"]]);
  });
});
