import { describe, expect, it } from "bun:test";
import { createStreamFlusher } from "./streamFlusher.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createStreamFlusher", () => {
  it("batches burst pushes and flushNow delivers the full buffer", async () => {
    const flushed: string[] = [];
    const flusher = createStreamFlusher((buffer) => flushed.push(buffer), 20);
    for (let i = 0; i < 50; i++) flusher.push("x");
    await sleep(35);
    flusher.flushNow();
    expect(flushed.length).toBeLessThanOrEqual(3);
    expect(flushed.at(-1)).toBe("x".repeat(50));
  });

  it("flushes immediately on the leading edge after idle", async () => {
    const flushed: string[] = [];
    const flusher = createStreamFlusher((buffer) => flushed.push(buffer), 20);
    flusher.push("a");
    expect(flushed).toEqual(["a"]);
    await sleep(25);
    flusher.push("b");
    expect(flushed.at(-1)).toBe("ab");
  });

  it("dispose drops a pending trailing flush", async () => {
    const flushed: string[] = [];
    const flusher = createStreamFlusher((buffer) => flushed.push(buffer), 50);
    flusher.push("a");
    flusher.push("b");
    flusher.dispose();
    await sleep(65);
    expect(flushed).toEqual(["a"]);
  });
});
