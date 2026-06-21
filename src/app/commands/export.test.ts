import { describe, expect, it } from "bun:test";
import path from "path";

import { resolveOutputPath } from "./export.ts";

const baseDir = path.join(process.cwd(), "exports");

describe("resolveOutputPath path-traversal confinement", () => {
  it("confines a traversal filename to baseDir", () => {
    const { filePath, dir } = resolveOutputPath("scan", "csv", "../../x");
    expect(filePath).toBe(path.join(baseDir, "x.csv"));
    expect(dir).toBe(baseDir);
    expect(filePath.startsWith(baseDir + path.sep)).toBe(true);
  });

  it("confines an absolute path to baseDir", () => {
    const abs = path.join(path.parse(process.cwd()).root, "tmp", "evil.json");
    const { filePath, dir } = resolveOutputPath("session", "json", abs);
    expect(filePath).toBe(path.join(baseDir, "evil.json"));
    expect(dir).toBe(baseDir);
    expect(filePath.startsWith(baseDir + path.sep)).toBe(true);
  });

  it("writes a normal name under baseDir, preserving an explicit extension", () => {
    const { filePath, dir } = resolveOutputPath("scan", "csv", "report.csv");
    expect(filePath).toBe(path.join(baseDir, "report.csv"));
    expect(dir).toBe(baseDir);
  });

  it("appends the default extension when the name has none", () => {
    const { filePath } = resolveOutputPath("scan", "csv", "report");
    expect(filePath).toBe(path.join(baseDir, "report.csv"));
  });

  it("uses the timestamped default name when no filename is given", () => {
    const { filePath, dir } = resolveOutputPath("scan", "csv");
    expect(dir).toBe(baseDir);
    expect(path.dirname(filePath)).toBe(baseDir);
    expect(path.basename(filePath)).toMatch(/^scan-\d{8}-\d{6}\.csv$/);
  });
});
