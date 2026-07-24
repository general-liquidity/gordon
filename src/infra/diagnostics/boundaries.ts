/**
 * Architectural Boundary Check (GORDON_BOUNDARY_CHECK).
 *
 * Port of `check-boundaries.mjs` from hands-on harness engineering
 * Module 09. Enforces forbidden-import edges between directories.
 *
 * Example use: ensure `src/core/` does not depend on `src/infra/`,
 * ensure `src/events/` is leaf-only, ensure `src/tui/` cannot reach
 * into `src/app/` runtime guts.
 *
 * Discipline these rules can express:
 *   - "core stays pure" — no infra in core/
 *   - "events stay leaf" — events/ imports nothing else of ours
 *   - "tui stays UI-only" — tui/ does not import app/setup or runtime
 *   - "scripts stay project-shell" — scripts/ does not import from src/
 *
 * The checker is purely lexical — it scans relative imports in
 * `.ts` / `.tsx` files and matches them against forbidden-edge rules.
 * It does NOT resolve `tsconfig` paths or `node_modules`. That's
 * intentional: structural rules are about source directories, not
 * resolved modules.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface BoundaryRule {
  /** Glob-style prefix the rule applies to (e.g. "src/core"). */
  from: string;
  /**
   * Disallowed import prefixes. Any relative import landing inside
   * one of these prefixes from a file under `from` is a violation.
   */
  forbidden: string[];
  /** Optional human-friendly description. */
  why?: string;
}

export interface BoundaryViolation {
  rule: BoundaryRule;
  file: string;
  /** The exact import specifier from the source. */
  importSpec: string;
  /** Resolved repo-relative target path. */
  resolvedTarget: string;
}

export interface BoundaryCheckResult {
  filesScanned: number;
  importsScanned: number;
  violations: BoundaryViolation[];
}

export interface BoundaryCheckOptions {
  /** Repo root. Default: cwd. */
  rootDir?: string;
  /** Source dirs to walk. Default: ["src"]. */
  sourceDirs?: string[];
  /** File extensions considered. Default: [".ts", ".tsx"]. */
  extensions?: string[];
  /**
   * Skip dirs (relative segments, case-sensitive). Default skips
   * `node_modules`, `dist`, `.git`.
   */
  skipDirs?: string[];
}

/**
 * Default rules tuned for Gordon's directory layout. Not enforced by
 * default — callers (scripts/check-boundaries, CI) pass these to
 * `checkBoundaries`.
 */
export const GORDON_DEFAULT_RULES: readonly BoundaryRule[] = [
  {
    from: "src/core",
    forbidden: ["src/infra", "src/app", "src/tui", "src/runtime", "src/gateway"],
    why: "core/ stays pure — no infra, no UI, no runtime/permission orchestration",
  },
  {
    from: "src/events",
    forbidden: ["src/infra", "src/app", "src/tui", "src/runtime", "src/core", "src/backtest", "src/gateway"],
    why: "events/ is a leaf type module — must not depend on any other src/ subtree",
  },
  {
    from: "src/tui",
    forbidden: ["src/app/setup", "src/runtime/permissions", "src/infra/exchange", "src/infra/broker"],
    why: "tui/ renders state — must not reach into runtime/permission or broker wiring directly",
  },
] as const;

function shouldSkipDir(name: string, skipDirs: string[]): boolean {
  return skipDirs.includes(name);
}

function listSourceFiles(
  dir: string,
  extensions: string[],
  skipDirs: string[],
  acc: string[],
): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (shouldSkipDir(entry, skipDirs)) continue;
      listSourceFiles(full, extensions, skipDirs, acc);
      continue;
    }
    if (st.isFile() && extensions.some((e) => entry.endsWith(e))) {
      acc.push(full);
    }
  }
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export function extractImports(source: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    out.push(m[1]!);
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(source)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
}

/**
 * Normalize to forward-slash repo-relative path, regardless of platform.
 */
function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function pathStartsWith(path: string, prefix: string): boolean {
  const a = toPosix(path);
  const b = toPosix(prefix);
  if (a === b) return true;
  return a.startsWith(b.endsWith("/") ? b : b + "/");
}

export function checkBoundaries(
  rules: readonly BoundaryRule[],
  opts: BoundaryCheckOptions = {},
): BoundaryCheckResult {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  const sourceDirs = opts.sourceDirs ?? ["src"];
  const extensions = opts.extensions ?? [".ts", ".tsx"];
  const skipDirs = opts.skipDirs ?? ["node_modules", "dist", ".git", "build"];

  const files: string[] = [];
  for (const dir of sourceDirs) {
    listSourceFiles(join(rootDir, dir), extensions, skipDirs, files);
  }

  const violations: BoundaryViolation[] = [];
  let importsScanned = 0;

  for (const file of files) {
    const relFile = toPosix(relative(rootDir, file));
    const applicableRules = rules.filter((r) => pathStartsWith(relFile, r.from));
    if (applicableRules.length === 0) continue;

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const specs = extractImports(source);
    importsScanned += specs.length;

    for (const spec of specs) {
      if (!isRelative(spec)) continue;
      // Strip a trailing `.ts` / `.tsx` extension for comparison.
      const stripped = spec.replace(/\.tsx?$/, "");
      const resolvedAbs = resolve(dirname(file), stripped);
      const resolvedRel = toPosix(relative(rootDir, resolvedAbs));

      for (const rule of applicableRules) {
        for (const forbidden of rule.forbidden) {
          if (pathStartsWith(resolvedRel, forbidden)) {
            violations.push({
              rule,
              file: relFile,
              importSpec: spec,
              resolvedTarget: resolvedRel,
            });
          }
        }
      }
    }
  }

  return { filesScanned: files.length, importsScanned, violations };
}

export function formatBoundaryResult(result: BoundaryCheckResult): string {
  const lines: string[] = [];
  lines.push(`Boundary check: ${result.filesScanned} files, ${result.importsScanned} imports`);
  if (result.violations.length === 0) {
    lines.push("  no violations");
    return lines.join("\n");
  }
  lines.push(`  ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    lines.push(`  ${v.file} → ${v.resolvedTarget}`);
    lines.push(`    forbidden by rule: ${v.rule.from} ↛ ${v.rule.forbidden.join("|")}`);
    if (v.rule.why) lines.push(`    why: ${v.rule.why}`);
  }
  return lines.join("\n");
}

export function boundaryResultToPayload(result: BoundaryCheckResult): Record<string, unknown> {
  return {
    kind: "boundary.check_recorded",
    filesScanned: result.filesScanned,
    importsScanned: result.importsScanned,
    violationCount: result.violations.length,
    violations: result.violations.map((v) => ({
      from: v.rule.from,
      file: v.file,
      target: v.resolvedTarget,
      importSpec: v.importSpec,
    })),
  };
}
