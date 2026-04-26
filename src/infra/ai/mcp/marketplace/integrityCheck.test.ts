import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyExtensionIntegrity } from "./integrityCheck.ts";

let testDir: string;

function fileWith(name: string, contents: string): string {
  const path = join(testDir, name);
  writeFileSync(path, contents);
  return path;
}

function sha256Of(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("verifyExtensionIntegrity", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "integrity-"));
  });
  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {/* ignore */}
  });

  it("returns file_missing when the path doesn't exist", async () => {
    const r = await verifyExtensionIntegrity({
      filePath: join(testDir, "ghost"),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("file_missing");
  });

  it("computes the SHA-256 of the file when no expected hash is supplied", async () => {
    const path = fileWith("a.bin", "hello gordon");
    const r = await verifyExtensionIntegrity({ filePath: path });
    expect(r.ok).toBe(true);
    expect(r.computedSha256).toBe(sha256Of("hello gordon"));
  });

  it("passes when computed hash matches the expected one", async () => {
    const contents = "an exact-match payload";
    const path = fileWith("b.bin", contents);
    const r = await verifyExtensionIntegrity({
      filePath: path,
      expectedSha256: sha256Of(contents),
    });
    expect(r.ok).toBe(true);
  });

  it("flags hash_mismatch when expected hash differs", async () => {
    const path = fileWith("c.bin", "actual content");
    const r = await verifyExtensionIntegrity({
      filePath: path,
      expectedSha256: sha256Of("expected content"),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("hash_mismatch");
    expect(r.computedSha256).toBe(sha256Of("actual content"));
    expect(r.message).toContain("Possible tamper");
  });

  it("normalises 0x-prefixed and uppercase expected hashes", async () => {
    const contents = "case-test";
    const path = fileWith("d.bin", contents);
    const upperExpected = "0x" + sha256Of(contents).toUpperCase();
    const r = await verifyExtensionIntegrity({
      filePath: path,
      expectedSha256: upperExpected,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks denylisted hashes even when expected matches", async () => {
    const contents = "compromised";
    const path = fileWith("e.bin", contents);
    const hash = sha256Of(contents);
    const r = await verifyExtensionIntegrity({
      filePath: path,
      expectedSha256: hash,
      denylist: new Set([hash]),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("denylisted");
  });

  it("flags file_too_large when over the cap", async () => {
    const path = fileWith("big.bin", "x".repeat(2000));
    const r = await verifyExtensionIntegrity({
      filePath: path,
      maxFileSizeBytes: 1000,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("file_too_large");
  });

  it("structured message includes both expected and computed hashes on mismatch", async () => {
    const path = fileWith("f.bin", "real");
    const expected = sha256Of("fake");
    const r = await verifyExtensionIntegrity({
      filePath: path,
      expectedSha256: expected,
    });
    expect(r.message).toContain(expected);
    expect(r.message).toContain(sha256Of("real"));
  });
});
