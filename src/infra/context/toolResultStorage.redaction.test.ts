import { describe, it, expect, afterEach } from "bun:test";
import { readFileSync, rmSync, existsSync } from "node:fs";

import { persistLargeResult } from "./toolResultStorage.ts";

const SECRET = "sk-ant-api01-AAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const written: string[] = [];

afterEach(() => {
  for (const p of written) {
    if (existsSync(p)) rmSync(p, { force: true });
  }
  written.length = 0;
});

describe("persistLargeResult — disk redaction", () => {
  it("redacts credential-shaped values before writing the spill file and preview", () => {
    const payload = `large orderbook dump...\nleaked credential ${SECRET}\n...more rows`;
    const result = persistLargeResult("get_orderbook", "call_123", payload);
    written.push(result.filePath);

    const onDisk = readFileSync(result.filePath, "utf-8");
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).toContain("[REDACTED]");

    // The in-context preview must also be redacted.
    expect(result.preview).not.toContain(SECRET);
  });

  it("originalSize reflects the redacted payload (no raw secret length leak)", () => {
    const payload = `prefix ${SECRET} suffix`;
    const result = persistLargeResult("scan", "call_xyz", payload);
    written.push(result.filePath);
    const onDisk = readFileSync(result.filePath, "utf-8");
    expect(result.originalSize).toBe(onDisk.length);
  });
});
