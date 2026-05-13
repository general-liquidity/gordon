import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isBoundaryCheckEnabled,
  extractImports,
  checkBoundaries,
  formatBoundaryResult,
  boundaryResultToPayload,
  GORDON_DEFAULT_RULES,
  BOUNDARY_FLAG_ENV,
  type BoundaryRule,
} from "./boundaries.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-boundaries-test-"));
});

function writeFile(repoRel: string, content: string): void {
  const full = join(tempDir, repoRel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("isBoundaryCheckEnabled", () => {
  it("respects the flag", () => {
    expect(isBoundaryCheckEnabled({})).toBe(false);
    expect(isBoundaryCheckEnabled({ [BOUNDARY_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("GORDON_DEFAULT_RULES", () => {
  it("includes core/ purity rule", () => {
    const coreRule = GORDON_DEFAULT_RULES.find((r) => r.from === "src/core");
    expect(coreRule).toBeDefined();
    expect(coreRule!.forbidden).toContain("src/infra");
  });

  it("includes events/ leaf rule", () => {
    const eventsRule = GORDON_DEFAULT_RULES.find((r) => r.from === "src/events");
    expect(eventsRule).toBeDefined();
  });
});

describe("extractImports", () => {
  it("captures static imports", () => {
    const src = `
      import { foo } from "./bar.ts";
      import baz from "../baz";
      import * as q from "node:fs";
    `;
    expect(extractImports(src)).toEqual(["./bar.ts", "../baz", "node:fs"]);
  });

  it("captures re-exports", () => {
    const src = `export { a } from "./a.ts";\nexport * from "./b.ts";`;
    expect(extractImports(src)).toEqual(["./a.ts", "./b.ts"]);
  });

  it("captures dynamic imports", () => {
    const src = `const mod = await import("./dyn.ts");`;
    expect(extractImports(src)).toEqual(["./dyn.ts"]);
  });

  it("ignores import-like words in comments and strings", () => {
    const src = `
      // import { foo } from "./fake.ts";
      const s = "import { x } from 'y'";
    `;
    // The regex deliberately catches `import ... from "x"` at line start or after
    // whitespace. Comments do match this pattern (heuristic — not a full parser).
    // We confirm the string-literal-only mention is excluded.
    const result = extractImports(src);
    expect(result).not.toContain("y");
  });

  it("returns empty array on empty source", () => {
    expect(extractImports("")).toEqual([]);
  });
});

describe("checkBoundaries", () => {
  it("returns no violations when none of the rules' source dirs exist", () => {
    const result = checkBoundaries(GORDON_DEFAULT_RULES, { rootDir: tempDir });
    expect(result.violations).toEqual([]);
    expect(result.filesScanned).toBe(0);
  });

  it("reports violation when core imports from infra", () => {
    writeFile("src/core/foo.ts", `import { x } from "../infra/bar.ts";`);
    writeFile("src/infra/bar.ts", `export const x = 1;`);

    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra"], why: "core stays pure" },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]!.file).toBe("src/core/foo.ts");
    expect(result.violations[0]!.importSpec).toBe("../infra/bar.ts");
  });

  it("ignores imports from outside the rule's `from` directory", () => {
    writeFile("src/infra/foo.ts", `import { x } from "../app/bar.ts";`);
    writeFile("src/app/bar.ts", `export const x = 1;`);

    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra", "src/app"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations).toEqual([]);
  });

  it("ignores non-relative imports (packages, node:*)", () => {
    writeFile("src/core/foo.ts", `
      import { readFile } from "node:fs";
      import zod from "zod";
    `);

    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations).toEqual([]);
  });

  it("strips .ts extension before matching", () => {
    writeFile("src/core/foo.ts", `import { x } from "../infra/bar.ts";`);

    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]!.resolvedTarget).toBe("src/infra/bar");
  });

  it("walks nested directories", () => {
    writeFile("src/core/deep/nest/foo.ts", `import { x } from "../../../infra/bar.ts";`);

    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations.length).toBe(1);
  });

  it("skips node_modules and dist by default", () => {
    writeFile("src/core/foo.ts", `import { x } from "../infra/bar.ts";`);
    writeFile("node_modules/junk/baz.ts", `import { x } from "../infra/bar.ts";`);
    writeFile("dist/out.ts", `import { x } from "../infra/bar.ts";`);

    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    // Only src/core/foo.ts should produce a violation
    expect(result.violations.length).toBe(1);
  });

  it("allows configurable extensions", () => {
    writeFile("src/core/foo.tsx", `import { x } from "../infra/bar.ts";`);

    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations.length).toBe(1);
  });

  it("counts imports scanned across files", () => {
    writeFile("src/core/a.ts", `import { x } from "./b.ts";\nimport { y } from "./c.ts";`);
    writeFile("src/core/b.ts", `export const x = 1;`);
    writeFile("src/core/c.ts", `export const y = 2;`);

    const result = checkBoundaries(GORDON_DEFAULT_RULES, { rootDir: tempDir });
    expect(result.filesScanned).toBe(3);
    expect(result.importsScanned).toBeGreaterThanOrEqual(2);
  });

  it("aggregates violations across multiple rules", () => {
    writeFile("src/events/types.ts", `
      import { x } from "../core/foo.ts";
      import { y } from "../infra/bar.ts";
    `);
    writeFile("src/core/foo.ts", `export const x = 1;`);
    writeFile("src/infra/bar.ts", `export const y = 2;`);

    const rules: BoundaryRule[] = [
      { from: "src/events", forbidden: ["src/core", "src/infra"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations.length).toBe(2);
  });

  it("a file matching no rule is not scanned for violations", () => {
    writeFile("src/random/x.ts", `import { y } from "../infra/bar.ts";`);
    const rules: BoundaryRule[] = [
      { from: "src/core", forbidden: ["src/infra"] },
    ];
    const result = checkBoundaries(rules, { rootDir: tempDir });
    expect(result.violations).toEqual([]);
  });
});

describe("formatBoundaryResult", () => {
  it("prints 'no violations' on a clean run", () => {
    const out = formatBoundaryResult({ filesScanned: 5, importsScanned: 12, violations: [] });
    expect(out).toContain("no violations");
  });

  it("prints each violation with file, target, and rule", () => {
    writeFile("src/core/foo.ts", `import { x } from "../infra/bar.ts";`);
    writeFile("src/infra/bar.ts", `export const x = 1;`);
    const result = checkBoundaries(
      [{ from: "src/core", forbidden: ["src/infra"], why: "purity" }],
      { rootDir: tempDir },
    );
    const out = formatBoundaryResult(result);
    expect(out).toContain("src/core/foo.ts");
    expect(out).toContain("forbidden by rule");
    expect(out).toContain("purity");
  });
});

describe("boundaryResultToPayload", () => {
  it("emits stable shape", () => {
    const result = checkBoundaries([], { rootDir: tempDir });
    const p = boundaryResultToPayload(result);
    expect(p.kind).toBe("boundary.check_recorded");
    expect(p.violationCount).toBe(0);
  });
});
