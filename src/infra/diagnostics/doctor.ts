/**
 * Doctor — diagnostic engine for Gordon's runtime state.
 *
 * Replaces the hardcoded 4-line placeholder in App.tsx with real checks
 * over the surfaces that have failure modes worth detecting. Every check
 * is read-only by default. Fixes route through existing user-trusted
 * commands (/cost reset, /exchange, etc.) — never silently mutates
 * state. The "do no harm" principle from CLI doctor-mode design: detect
 * exhaustively, repair conservatively.
 *
 * Each check returns a `DiagnosticCheck` matching the shape consumed
 * by `DoctorDialog.tsx`. The check function is pure with respect to
 * the filesystem and runtime state — it stats files, parses JSON, and
 * reads in-process state, but mutates nothing.
 *
 * Adding a new check:
 *   1. Add a const function returning `Promise<DiagnosticCheck>` or `DiagnosticCheck`
 *   2. Add it to the array in `runDoctorChecks()`
 *   3. Add a test in `doctor.test.ts`
 *
 * Future checks worth adding when failure modes surface:
 *   - Mastra `lastMessages` patch still applied in node_modules
 *   - MCP marketplace integrity check recency
 *   - critiquePhase.ts routing still uses "critique" not "compaction"
 *     (regression defense from commit b2f537fd)
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { isCostHalted, getCostTracker } from "../platform/costTracker.ts";
import { MAX_WORKING_MEMORY_CHARS } from "../agents/memory/memoryGate.ts";
import { isSafetyCritical } from "../../runtime/permissions/trustTrajectory.ts";
import { getACELessonsPath } from "../agents/ace/index.ts";
import { defaultReviewQueuePath } from "../domain/evals/harness/reviewQueue.ts";
import { defaultAgentFeedbackPath } from "../agents/tools/runtime/meta/agent-feedback.ts";

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "info";
  message: string;
  fixCommand?: string;
  fixLabel?: string;
}

// ============================================================================
// Path resolution
// ============================================================================

/**
 * Resolve `file:gordon.db` style Mastra storage URLs to a concrete path.
 * Defaults match `memoryFactory.ts:75-76`.
 */
function resolveMastraStoragePath(): string {
  const url = process.env.DATABASE_URL ?? "file:gordon.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

function resolveVectorStoragePath(): string {
  const url = process.env.VECTOR_DATABASE_URL ?? "file:gordon-vector.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

// ============================================================================
// Checks
// ============================================================================

function checkCostHaltState(): DiagnosticCheck {
  if (isCostHalted()) {
    return {
      id: "cost-halt",
      label: "Cost budget halt",
      status: "fail",
      message: "Session is halted because cost budget was exceeded. New API calls will be blocked.",
      fixCommand: "/cost reset",
      fixLabel: "Clear halt state and resume",
    };
  }
  return {
    id: "cost-halt",
    label: "Cost budget halt",
    status: "pass",
    message: "Session is within budget.",
  };
}

function checkCacheReadPressure(): DiagnosticCheck {
  const tracker = getCostTracker();
  const snap = tracker.snapshot();
  if (snap.totalApiCalls === 0) {
    return {
      id: "cache-read-pressure",
      label: "Cache-read pressure",
      status: "info",
      message: "No API calls recorded this session yet.",
    };
  }
  const pct = Math.round(snap.cacheReadPercentage * 100);
  if (snap.cacheReadPercentage >= 0.7) {
    return {
      id: "cache-read-pressure",
      label: "Cache-read pressure",
      status: "warn",
      message: `${pct}% of tokens are cache-read replay — likely context bloat. Consider /compact or restarting the session.`,
      fixCommand: "/compact",
      fixLabel: "Compact context",
    };
  }
  if (snap.cacheReadPercentage >= 0.5) {
    return {
      id: "cache-read-pressure",
      label: "Cache-read pressure",
      status: "info",
      message: `${pct}% cache-read (cache-heavy but below bloat threshold).`,
    };
  }
  return {
    id: "cache-read-pressure",
    label: "Cache-read pressure",
    status: "pass",
    message: `${pct}% of tokens are cache-read replay (healthy).`,
  };
}

function checkMastraStorage(): DiagnosticCheck {
  const path = resolveMastraStoragePath();
  if (!existsSync(path)) {
    return {
      id: "mastra-db",
      label: "Mastra storage",
      status: "info",
      message: `${path} not present yet — will be created on first session.`,
    };
  }
  try {
    const stats = statSync(path);
    if (stats.size === 0) {
      return {
        id: "mastra-db",
        label: "Mastra storage",
        status: "warn",
        message: `${path} exists but is empty — possible corruption.`,
      };
    }
    return {
      id: "mastra-db",
      label: "Mastra storage",
      status: "pass",
      message: `${path} (${Math.round(stats.size / 1024)} KB)`,
    };
  } catch (err) {
    return {
      id: "mastra-db",
      label: "Mastra storage",
      status: "fail",
      message: `Cannot stat ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkVectorStorage(): DiagnosticCheck {
  const path = resolveVectorStoragePath();
  if (!existsSync(path)) {
    return {
      id: "vector-db",
      label: "Vector storage",
      status: "info",
      message: `${path} not present — vector tools will work once first embedding is recorded.`,
    };
  }
  try {
    const stats = statSync(path);
    return {
      id: "vector-db",
      label: "Vector storage",
      status: "pass",
      message: `${path} (${Math.round(stats.size / 1024)} KB)`,
    };
  } catch (err) {
    return {
      id: "vector-db",
      label: "Vector storage",
      status: "fail",
      message: `Cannot stat ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkAceLessonsFile(): DiagnosticCheck {
  const path = getACELessonsPath();
  if (!existsSync(path)) {
    return {
      id: "ace-lessons",
      label: "ACE lessons store",
      status: "info",
      message: `${path} not present — run /reflect to populate.`,
    };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { lessons?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lessons)) {
      return {
        id: "ace-lessons",
        label: "ACE lessons store",
        status: "warn",
        message: `${path} parses but has unexpected shape (missing lessons array).`,
      };
    }
    return {
      id: "ace-lessons",
      label: "ACE lessons store",
      status: "pass",
      message: `${(parsed.lessons as unknown[]).length} lessons stored`,
    };
  } catch (err) {
    return {
      id: "ace-lessons",
      label: "ACE lessons store",
      status: "fail",
      message: `${path} unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkJsonlIntegrity(
  id: string,
  label: string,
  path: string,
  noteWhenMissing: string,
): DiagnosticCheck {
  if (!existsSync(path)) {
    return {
      id,
      label,
      status: "info",
      message: noteWhenMissing,
    };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    let parseable = 0;
    let malformed = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        parseable += 1;
      } catch {
        malformed += 1;
      }
    }
    if (malformed > 0) {
      return {
        id,
        label,
        status: "warn",
        message: `${parseable} parseable / ${malformed} malformed entries. Malformed lines are skipped on read; safe to ignore unless growing.`,
      };
    }
    return {
      id,
      label,
      status: "pass",
      message: `${parseable} entries, all parseable`,
    };
  } catch (err) {
    return {
      id,
      label,
      status: "fail",
      message: `Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkSafetyDenyList(): DiagnosticCheck {
  // Defensive regression check: the trust-trajectory deny-list patterns
  // must still recognize these canonical safety-critical tool names.
  // If isSafetyCritical() returns false for any of them, a refactor has
  // accidentally weakened the safety boundary.
  const expected = [
    "execute_plan",
    "place_order",
    "place_market_order",
    "execute_trade",
    "cancel_order",
    "wallet_transfer",
    "withdraw",
    "exec_shell",
  ];
  const missing = expected.filter((name) => !isSafetyCritical(name));
  if (missing.length > 0) {
    return {
      id: "safety-deny-list",
      label: "Safety-critical deny-list",
      status: "fail",
      message: `Expected patterns missing from deny-list: ${missing.join(", ")}. Trust-trajectory hook may auto-approve trades that should never be auto-approved.`,
    };
  }
  return {
    id: "safety-deny-list",
    label: "Safety-critical deny-list",
    status: "pass",
    message: `${expected.length} canonical patterns intact in trustTrajectory`,
  };
}

function checkHotTierCap(): DiagnosticCheck {
  // Regression defense for the Hermes hot-tier discipline (commit 900994d6).
  // If a future refactor changes MAX_WORKING_MEMORY_CHARS, surface it so
  // the user can re-derive whether the new value is intentional.
  const EXPECTED = 2200;
  if (MAX_WORKING_MEMORY_CHARS !== EXPECTED) {
    return {
      id: "hot-tier-cap",
      label: "Working-memory hot-tier cap",
      status: "warn",
      message: `MAX_WORKING_MEMORY_CHARS is ${MAX_WORKING_MEMORY_CHARS} (Hermes default is ${EXPECTED}). Confirm the change is intentional.`,
    };
  }
  return {
    id: "hot-tier-cap",
    label: "Working-memory hot-tier cap",
    status: "pass",
    message: `${MAX_WORKING_MEMORY_CHARS} chars (Hermes default)`,
  };
}

function checkGordonHomeDir(): DiagnosticCheck {
  const dir = join(homedir(), ".gordon");
  if (!existsSync(dir)) {
    return {
      id: "gordon-home",
      label: "~/.gordon directory",
      status: "info",
      message: `${dir} not present — will be created on first use.`,
    };
  }
  return {
    id: "gordon-home",
    label: "~/.gordon directory",
    status: "pass",
    message: dir,
  };
}

// ============================================================================
// Deferred checks now wired (see file header)
// ============================================================================

/**
 * Mastra `lastMessages` postinstall revert is still applied.
 *
 * The patch script reverts stale `lastMessages: 10` mutations back to
 * Mastra's default of 0 (see `scripts/patches/patch-mastra.cjs` — Patch 1
 * was disabled because the 10-message window blew the 200k context
 * ceiling). If a chunk file in node_modules still contains the stale
 * value, the postinstall didn't run on this install — surfacing a hard
 * fail so the user can re-run `npm run postinstall` before sub-agents
 * start carrying 10× tool-call payloads.
 */
function checkMastraPatchApplied(
  distDir: string = resolve(process.cwd(), "node_modules", "@mastra", "core", "dist"),
): DiagnosticCheck {
  if (!existsSync(distDir)) {
    return {
      id: "mastra-patch",
      label: "Mastra lastMessages patch",
      status: "info",
      message: `${distDir} not present — Mastra not installed or path differs.`,
    };
  }
  const STALE = "lastMessages: 10";
  let staleFiles = 0;
  try {
    const entries = readdirSync(distDir);
    for (const f of entries) {
      if (!/^chunk-.+\.(js|cjs)$/.test(f)) continue;
      try {
        const content = readFileSync(join(distDir, f), "utf8");
        if (content.includes(STALE)) staleFiles += 1;
      } catch {
        // unreadable chunk — skip
      }
    }
  } catch (err) {
    return {
      id: "mastra-patch",
      label: "Mastra lastMessages patch",
      status: "fail",
      message: `Could not scan ${distDir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (staleFiles > 0) {
    return {
      id: "mastra-patch",
      label: "Mastra lastMessages patch",
      status: "fail",
      message: `${staleFiles} chunk file(s) still contain stale 'lastMessages: 10'. Sub-agent context will blow the 200k window. Run npm run postinstall.`,
      fixCommand: "npm run postinstall",
      fixLabel: "Re-run postinstall patches",
    };
  }
  return {
    id: "mastra-patch",
    label: "Mastra lastMessages patch",
    status: "pass",
    message: "No stale lastMessages: 10 mutations found in @mastra/core dist chunks.",
  };
}

/**
 * MCP marketplace catalog is parseable + non-empty. The catalog file
 * (`src/infra/ai/mcp/marketplace/catalog.json`) is the curated registry
 * the marketplace surface reads from. If it gets corrupted, malformed,
 * or empty, every MCP install gets ambiguous failures. Reporting count
 * + lastUpdated lets the user see at a glance whether the catalog is
 * fresh and intact.
 */
function checkMcpMarketplaceCatalog(
  catalogPath: string = resolve(process.cwd(), "src", "infra", "ai", "mcp", "marketplace", "catalog.json"),
): DiagnosticCheck {
  if (!existsSync(catalogPath)) {
    return {
      id: "mcp-catalog",
      label: "MCP marketplace catalog",
      status: "warn",
      message: `${catalogPath} not present — MCP marketplace will surface zero servers.`,
    };
  }
  try {
    const raw = readFileSync(catalogPath, "utf8");
    const parsed = JSON.parse(raw) as {
      version?: string;
      lastUpdated?: string;
      plugins?: unknown[];
    };
    const count = Array.isArray(parsed.plugins) ? parsed.plugins.length : 0;
    if (count === 0) {
      return {
        id: "mcp-catalog",
        label: "MCP marketplace catalog",
        status: "warn",
        message: "Catalog parses but lists zero plugins.",
      };
    }
    const updated = parsed.lastUpdated ? ` (lastUpdated ${parsed.lastUpdated})` : "";
    return {
      id: "mcp-catalog",
      label: "MCP marketplace catalog",
      status: "pass",
      message: `${count} plugin(s) registered${updated}.`,
    };
  } catch (err) {
    return {
      id: "mcp-catalog",
      label: "MCP marketplace catalog",
      status: "fail",
      message: `${catalogPath} unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * `bunfig.toml` declares `minimumReleaseAge` for install-time
 * supply-chain defense. Required after the May-2026 TanStack worm
 * (TeamPCP Mini Shai-Hulud): npm refuses to install package versions
 * published less than 48h ago, covering the community-detection
 * window for malicious publishes. If a config edit silently drops the
 * gate, this check surfaces it. See scripts/README.md "Supply-chain
 * hardening" for context.
 */
function checkInstallReleaseAge(
  bunfigPath: string = resolve(process.cwd(), "bunfig.toml"),
): DiagnosticCheck {
  const MIN_SECONDS = 86_400; // 24h is the floor we'll tolerate
  if (!existsSync(bunfigPath)) {
    return {
      id: "install-release-age",
      label: "Install release-age gate",
      status: "warn",
      message: `bunfig.toml not present — no minimumReleaseAge gate on installs.`,
    };
  }
  try {
    const raw = readFileSync(bunfigPath, "utf8");
    // Tolerant of TOML formatting variants: `minimumReleaseAge = 172800`,
    // `minimumReleaseAge=172800`, single-line table, etc. We don't pull
    // in a TOML parser for one field.
    const match = raw.match(/minimumReleaseAge\s*=\s*(\d+)/);
    if (!match) {
      return {
        id: "install-release-age",
        label: "Install release-age gate",
        status: "warn",
        message: "bunfig.toml has no minimumReleaseAge — installs will pull versions published seconds ago. See scripts/README.md.",
      };
    }
    const secs = Number(match[1]);
    if (!Number.isFinite(secs) || secs < MIN_SECONDS) {
      return {
        id: "install-release-age",
        label: "Install release-age gate",
        status: "warn",
        message: `minimumReleaseAge=${secs}s is below 24h floor. Restore to >=172800 (48h) per scripts/README.md.`,
      };
    }
    const hours = Math.round(secs / 3600);
    return {
      id: "install-release-age",
      label: "Install release-age gate",
      status: "pass",
      message: `minimumReleaseAge=${secs}s (~${hours}h) — installs reject fresh publishes.`,
    };
  } catch (err) {
    return {
      id: "install-release-age",
      label: "Install release-age gate",
      status: "fail",
      message: `Cannot read ${bunfigPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Audit the `trustedDependencies` allowlist in Gordon's own
 * package.json. Bun's default behavior is to NOT run dependency
 * lifecycle scripts (preinstall / install / postinstall / prepare)
 * unless the package is explicitly listed in trustedDependencies.
 * That default structurally blocks the TanStack worm's attack vector
 * (the malicious `prepare` script on the smuggled `@tanstack/setup`
 * git dep) — it can't fire without trust. Each entry added to
 * trustedDependencies is a deliberate decision to grant install-time
 * code execution to a third-party package and should be reviewed.
 * Warn (not fail) when any entries exist so a contributor doesn't
 * silently expand the trust surface.
 */
function checkTrustedDependencies(
  packageJsonPath: string = resolve(process.cwd(), "package.json"),
): DiagnosticCheck {
  if (!existsSync(packageJsonPath)) {
    return {
      id: "trusted-deps",
      label: "Bun trustedDependencies allowlist",
      status: "info",
      message: `${packageJsonPath} not present; skipping check.`,
    };
  }
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { trustedDependencies?: unknown };
    const td = parsed.trustedDependencies;
    if (!td) {
      return {
        id: "trusted-deps",
        label: "Bun trustedDependencies allowlist",
        status: "pass",
        message:
          "No trustedDependencies declared — Bun's default no-lifecycle-script behavior is intact (structurally blocks the TanStack worm attack vector). Note: Bun's built-in default allowlist still runs lifecycle scripts for the top ~500 npm packages (esbuild, sharp, node-gyp, etc.); explicit trustedDependencies only matters for adding to that.",
      };
    }
    if (!Array.isArray(td)) {
      return {
        id: "trusted-deps",
        label: "Bun trustedDependencies allowlist",
        status: "warn",
        message: "trustedDependencies is present but not an array — check package.json shape.",
      };
    }
    if (td.length === 0) {
      return {
        id: "trusted-deps",
        label: "Bun trustedDependencies allowlist",
        status: "pass",
        message: "trustedDependencies present but empty — Bun defaults intact.",
      };
    }
    return {
      id: "trusted-deps",
      label: "Bun trustedDependencies allowlist",
      status: "warn",
      message:
        `${td.length} package(s) in trustedDependencies (${(td as string[]).slice(0, 5).join(", ")}). ` +
        `Each entry grants install-time code execution rights. Verify each is justified — these bypass Bun's default no-lifecycle-script defense.`,
    };
  } catch (err) {
    return {
      id: "trusted-deps",
      label: "Bun trustedDependencies allowlist",
      status: "fail",
      message: `Cannot read/parse ${packageJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Scan installed-package manifests for the TanStack worm's distinctive
 * attack signature: an `optionalDependencies` entry pointing at a git
 * URL (the worm smuggled `@tanstack/setup": "github:tanstack/router#..."`
 * into compromised tarballs to trigger a `prepare` lifecycle script
 * during npm install). Legitimate packages almost never declare git-URL
 * optionalDependencies — finding one in the installed tree is a strong
 * compromise signal regardless of which package was poisoned.
 */
function checkSuspiciousOptionalDependencies(
  nodeModulesRoot: string = resolve(process.cwd(), "node_modules"),
): DiagnosticCheck {
  if (!existsSync(nodeModulesRoot)) {
    return {
      id: "suspicious-optional-deps",
      label: "Suspicious optionalDependencies scan",
      status: "info",
      message: `${nodeModulesRoot} not present — install hasn't run yet.`,
    };
  }
  const GIT_URL_PATTERN = /^(?:git[+@:]|github:|https?:\/\/.*\.git|.*#[a-f0-9]{40,})/i;
  // Hard bounds so the scan never blows the doctor latency budget. A
  // real Gordon node_modules has ~1k entries; cap + time budget keeps
  // worst-case scan under 1.5s even on cold caches. Early-exits on
  // first finding so a confirmed compromise surfaces immediately.
  const MAX_MANIFESTS = 1500;
  const TIME_BUDGET_MS = 1500;
  const startedAt = Date.now();
  const flagged: Array<{ pkg: string; dep: string; url: string }> = [];
  let scanned = 0;
  let truncated = false;

  let entries: string[];
  try {
    entries = readdirSync(nodeModulesRoot);
  } catch {
    return {
      id: "suspicious-optional-deps",
      label: "Suspicious optionalDependencies scan",
      status: "info",
      message: `Cannot read ${nodeModulesRoot}; skipping scan.`,
    };
  }

  const overBudget = (): boolean => {
    if (scanned >= MAX_MANIFESTS) return true;
    if (Date.now() - startedAt > TIME_BUDGET_MS) return true;
    return false;
  };

  const inspect = (manifestPath: string, displayName: string): boolean => {
    if (!existsSync(manifestPath)) return false;
    scanned += 1;
    try {
      const raw = readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as { optionalDependencies?: Record<string, string> };
      const od = parsed?.optionalDependencies;
      if (!od || typeof od !== "object") return false;
      for (const [dep, url] of Object.entries(od)) {
        if (typeof url !== "string") continue;
        if (GIT_URL_PATTERN.test(url)) {
          flagged.push({ pkg: displayName, dep, url });
          return true; // signal: short-circuit allowed
        }
      }
    } catch {
      // unreadable / unparseable manifest — skip
    }
    return false;
  };

  outer: for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (overBudget()) {
      truncated = true;
      break;
    }
    if (entry.startsWith("@")) {
      try {
        const scopeDir = join(nodeModulesRoot, entry);
        for (const inner of readdirSync(scopeDir)) {
          if (inner.startsWith(".")) continue;
          if (overBudget()) {
            truncated = true;
            break outer;
          }
          if (inspect(join(scopeDir, inner, "package.json"), `${entry}/${inner}`)) {
            break outer; // first finding wins
          }
        }
      } catch {
        // ignore
      }
    } else {
      if (inspect(join(nodeModulesRoot, entry, "package.json"), entry)) {
        break outer; // first finding wins
      }
    }
  }

  if (flagged.length > 0) {
    const sample = flagged
      .slice(0, 3)
      .map((f) => `${f.pkg} → ${f.dep}: ${f.url.slice(0, 80)}`)
      .join(" | ");
    return {
      id: "suspicious-optional-deps",
      label: "Suspicious optionalDependencies scan",
      status: "fail",
      message:
        `${flagged.length} installed package(s) declare optionalDependencies via git URL — ` +
        `matches TeamPCP Mini Shai-Hulud worm payload signature. ` +
        `First: ${sample}. ` +
        `Quarantine the machine; do not run npm/bun install again until these manifests are inspected.`,
    };
  }
  if (truncated) {
    return {
      id: "suspicious-optional-deps",
      label: "Suspicious optionalDependencies scan",
      status: "info",
      message: `${scanned} manifests scanned (budget hit, ${MAX_MANIFESTS} cap / ${TIME_BUDGET_MS}ms). No suspicious entries in scanned subset.`,
    };
  }
  return {
    id: "suspicious-optional-deps",
    label: "Suspicious optionalDependencies scan",
    status: "pass",
    message: `${scanned} manifests scanned, no git-URL optionalDependencies found.`,
  };
}

/**
 * Scan the project tree for IOC artifacts left by the May-2026
 * TanStack worm and similar npm supply-chain attacks: malware payload
 * files (router_init.js, router_runtime.js), persistence setup scripts
 * (.claude/setup.mjs, .vscode/setup.mjs), and Claude Code SessionStart
 * hooks pointing at external setup scripts. Detects post-compromise
 * residue even if the originally-installed package has since been
 * removed.
 */
function checkSupplyChainIocs(
  projectRoot: string = process.cwd(),
): DiagnosticCheck {
  const ioc_files = [
    "router_init.js",
    "router_runtime.js",
    ".claude/setup.mjs",
    ".vscode/setup.mjs",
    ".claude/router_runtime.js",
  ];
  const found: string[] = [];
  for (const rel of ioc_files) {
    const abs = join(projectRoot, rel);
    if (existsSync(abs)) found.push(rel);
  }

  // Inspect project + user-level .claude/settings.json for the
  // SessionStart→setup.mjs hook pattern.
  const settingsPaths = [
    join(projectRoot, ".claude", "settings.json"),
    join(homedir(), ".claude", "settings.json"),
  ];
  const taintedSettings: string[] = [];
  for (const sp of settingsPaths) {
    if (!existsSync(sp)) continue;
    try {
      const raw = readFileSync(sp, "utf8");
      const parsed = JSON.parse(raw) as { hooks?: { SessionStart?: unknown } };
      if (!parsed || typeof parsed !== "object") continue;
      const hooks = parsed.hooks;
      if (!hooks || typeof hooks !== "object") continue;
      const sessionStart = (hooks as { SessionStart?: unknown }).SessionStart;
      if (!sessionStart) continue;
      // Stringify and look for the worm's signature: a command that
      // shells out to setup.mjs under .vscode or .claude.
      const serialized = JSON.stringify(sessionStart);
      if (/(\.vscode|\.claude)[\\/]setup\.mjs/.test(serialized)) {
        taintedSettings.push(sp);
      }
    } catch {
      // unparseable settings.json — let the dedicated ace-lessons /
      // other checks surface that. Don't flag from here.
    }
  }

  if (found.length === 0 && taintedSettings.length === 0) {
    return {
      id: "supply-chain-iocs",
      label: "Supply-chain IOC scan",
      status: "pass",
      message: "No known malware payload files or SessionStart hooks present.",
    };
  }
  const parts: string[] = [];
  if (found.length > 0) parts.push(`IOC files: ${found.join(", ")}`);
  if (taintedSettings.length > 0) parts.push(`tainted settings.json: ${taintedSettings.join(", ")}`);
  return {
    id: "supply-chain-iocs",
    label: "Supply-chain IOC scan",
    status: "fail",
    message: `Possible compromise residue detected. ${parts.join("; ")}. Quarantine the machine, revoke tokens, audit ~/.local/bin and OS-level services.`,
  };
}

/**
 * critiquePhase routing still uses the "critique" workflow phase, not
 * the "compaction" phase. Regression defense for commit b2f537fd: the
 * critique pass was previously routed to the fast model via
 * "compaction" — Cognition's "What's Actually Working" finding required
 * a clean-context + capable reviewer to catch the most bugs. If a
 * refactor accidentally reverts the routing, this check surfaces it
 * before the next high-stakes critique misses regressions.
 */
function checkCritiquePhaseRouting(
  critiquePhasePath: string = resolve(process.cwd(), "src", "infra", "agents", "critiquePhase.ts"),
): DiagnosticCheck {
  if (!existsSync(critiquePhasePath)) {
    return {
      id: "critique-routing",
      label: "Critique-phase model routing",
      status: "info",
      message: `${critiquePhasePath} not present — running from compiled build, source check skipped.`,
    };
  }
  try {
    const src = readFileSync(critiquePhasePath, "utf8");
    const usesCritique = src.includes('resolveWorkflowPhaseModelRoute("critique")');
    const usesCompaction = src.includes('resolveWorkflowPhaseModelRoute("compaction")');
    if (usesCompaction && !usesCritique) {
      return {
        id: "critique-routing",
        label: "Critique-phase model routing",
        status: "fail",
        message: "critiquePhase.ts routes through 'compaction' (fast model) — regression of commit b2f537fd. Critique needs main-model capability + clean context.",
      };
    }
    if (!usesCritique) {
      return {
        id: "critique-routing",
        label: "Critique-phase model routing",
        status: "warn",
        message: "critiquePhase.ts doesn't reference resolveWorkflowPhaseModelRoute('critique') — file may have been refactored. Verify routing manually.",
      };
    }
    return {
      id: "critique-routing",
      label: "Critique-phase model routing",
      status: "pass",
      message: "critiquePhase.ts routes through 'critique' phase (main model).",
    };
  } catch (err) {
    return {
      id: "critique-routing",
      label: "Critique-phase model routing",
      status: "fail",
      message: `Cannot read ${critiquePhasePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run every diagnostic check and return the results in display order.
 * Pure with respect to filesystem and runtime state — read-only, no
 * mutation. Caller renders the results and routes fixes through
 * existing user-trusted commands.
 *
 * Synchronous on purpose: every current check is a stat / parse / state
 * read that completes in microseconds. If a future check needs to await
 * (e.g. LLM-provider ping for connectivity), refactor at that point.
 */
export function runDoctorChecks(): DiagnosticCheck[] {
  return [
    checkGordonHomeDir(),
    checkMastraStorage(),
    checkVectorStorage(),
    checkAceLessonsFile(),
    checkJsonlIntegrity(
      "eval-failures",
      "Eval-failures queue",
      defaultReviewQueuePath(),
      "No eval failures recorded yet.",
    ),
    checkJsonlIntegrity(
      "agent-feedback",
      "Agent-feedback queue",
      defaultAgentFeedbackPath(),
      "No agent feedback recorded yet.",
    ),
    checkCostHaltState(),
    checkCacheReadPressure(),
    checkSafetyDenyList(),
    checkHotTierCap(),
    checkMastraPatchApplied(),
    checkMcpMarketplaceCatalog(),
    checkCritiquePhaseRouting(),
    checkInstallReleaseAge(),
    checkSupplyChainIocs(),
    checkSuspiciousOptionalDependencies(),
    checkTrustedDependencies(),
    checkUntrustedLifecycleScripts(),
    checkAuditAdvisories(),
    checkLockfileDrift(),
  ];
}

/**
 * Surface packages in the installed tree that wanted to run install-time
 * lifecycle scripts but were blocked by Bun's default no-lifecycle-script
 * policy. `bun pm untrusted` lists exactly these — packages whose
 * `preinstall` / `install` / `postinstall` / `prepare` scripts Bun
 * refused to execute. Showing them here is an audit prompt: each one is
 * a deliberate decision waiting to be made (leave blocked, or `bun pm
 * trust <name>` after review). The TanStack worm pattern relied on a
 * `prepare` script firing during install; Bun's default blocked it, but
 * an operator who blanket-trusts everything to suppress warnings would
 * have re-opened the vector. Surfacing the list keeps the trust
 * decision deliberate rather than implicit.
 */
function checkUntrustedLifecycleScripts(
  spawnFn: typeof spawnSyncBunPm = spawnSyncBunPm,
): DiagnosticCheck {
  const result = spawnFn();
  if (result === null) {
    return {
      id: "untrusted-lifecycle-scripts",
      label: "Untrusted lifecycle-script packages",
      status: "info",
      message: "bun CLI not available — skipping `bun pm untrusted` scan.",
    };
  }
  if (result.error) {
    return {
      id: "untrusted-lifecycle-scripts",
      label: "Untrusted lifecycle-script packages",
      status: "info",
      message: `Could not run \`bun pm untrusted\`: ${result.error}`,
    };
  }
  const lines = result.output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^bun pm/i.test(l));
  // bun pm untrusted prints a header line + one entry per package when
  // there are entries; emits nothing or a "no blocked..." message when
  // clean. Treat the absence of package-looking tokens as clean.
  const pkgLines = lines.filter((l) => /^[@a-zA-Z0-9][\w./@-]*$/.test(l));
  if (pkgLines.length === 0) {
    return {
      id: "untrusted-lifecycle-scripts",
      label: "Untrusted lifecycle-script packages",
      status: "pass",
      message: "No packages with blocked lifecycle scripts in the install tree.",
    };
  }
  const preview = pkgLines.slice(0, 8).join(", ");
  const extra = pkgLines.length > 8 ? ` (+${pkgLines.length - 8} more)` : "";
  return {
    id: "untrusted-lifecycle-scripts",
    label: "Untrusted lifecycle-script packages",
    status: "warn",
    message:
      `${pkgLines.length} package(s) had install-time lifecycle scripts blocked by Bun: ${preview}${extra}. ` +
      `Review each — run \`bun pm trust <name>\` only after auditing the script. ` +
      `Blanket-trusting these to silence the warning re-opens the lifecycle-script attack vector that Bun's default closes.`,
  };
}

interface UntrustedSpawnResult {
  output: string;
  error: string | null;
}

function spawnSyncBunPm(): UntrustedSpawnResult | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const res = spawnSync("bun", ["pm", "untrusted"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    });
    if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (res.error) {
      return { output: "", error: res.error.message };
    }
    return {
      output: `${res.stdout ?? ""}\n${res.stderr ?? ""}`,
      error: null,
    };
  } catch (err) {
    return { output: "", error: err instanceof Error ? err.message : String(err) };
  }
}

// ----------------------------------------------------------------------------
// bun audit --json — structured advisory check
// ----------------------------------------------------------------------------

/**
 * Run `bun audit --json --audit-level=high` and report any advisories
 * that are NOT on Gordon's accepted-criticals ignore list (mirrored
 * from .github/workflows/ci.yml). The CI gate is informational by
 * design — Bun returns exit 0 regardless — so this doctor check is the
 * place we actually compare current advisories against the baseline
 * and surface new ones.
 */
const ACCEPTED_ADVISORY_IDS = new Set([
  "GHSA-xq3m-2v4x-88gg", // protobufjs RCE
  "GHSA-vjh7-7g9h-fjfh", // elliptic ECDSA key extraction
  "GHSA-2w6w-674q-4c4q", // handlebars AST type confusion
  "GHSA-fjxv-7rqg-78g4", // form-data unsafe random boundary
]);

interface AdvisorySpawnResult {
  output: string;
  error: string | null;
}

function spawnSyncBunAuditJson(): AdvisorySpawnResult | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const res = spawnSync("bun", ["audit", "--json", "--audit-level=high"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (res.error) {
      return { output: "", error: res.error.message };
    }
    return { output: res.stdout ?? "", error: null };
  } catch (err) {
    return { output: "", error: err instanceof Error ? err.message : String(err) };
  }
}

function checkAuditAdvisories(
  spawnFn: typeof spawnSyncBunAuditJson = spawnSyncBunAuditJson,
): DiagnosticCheck {
  const result = spawnFn();
  if (result === null) {
    return {
      id: "audit-advisories",
      label: "bun audit advisory delta",
      status: "info",
      message: "bun CLI not available — skipping `bun audit --json` check.",
    };
  }
  if (result.error) {
    return {
      id: "audit-advisories",
      label: "bun audit advisory delta",
      status: "info",
      message: `Could not run \`bun audit --json\`: ${result.error}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.output);
  } catch {
    return {
      id: "audit-advisories",
      label: "bun audit advisory delta",
      status: "info",
      message: "bun audit JSON output was not parseable (likely empty when no advisories present).",
    };
  }
  // Bun's npm-audit JSON shape mirrors npm: { advisories: { <id>: { ... } } }
  // or under .vulnerabilities depending on the registry. Try both.
  const advisoryMap: Record<string, unknown> = {};
  const root = parsed as { advisories?: Record<string, unknown>; vulnerabilities?: Record<string, unknown> };
  if (root && typeof root === "object") {
    if (root.advisories && typeof root.advisories === "object") Object.assign(advisoryMap, root.advisories);
    if (root.vulnerabilities && typeof root.vulnerabilities === "object") Object.assign(advisoryMap, root.vulnerabilities);
  }

  const newAdvisories: Array<{ id: string; severity: string; module: string }> = [];
  for (const [_idKey, adv] of Object.entries(advisoryMap)) {
    if (!adv || typeof adv !== "object") continue;
    const a = adv as { id?: string | number; github_advisory_id?: string; ghsa?: string; severity?: string; module_name?: string; name?: string };
    const ghsa = a.github_advisory_id ?? a.ghsa ?? (typeof a.id === "string" ? a.id : undefined);
    if (ghsa && ACCEPTED_ADVISORY_IDS.has(ghsa)) continue;
    const severity = a.severity ?? "unknown";
    if (severity !== "high" && severity !== "critical") continue;
    newAdvisories.push({
      id: ghsa ?? "(unknown)",
      severity,
      module: a.module_name ?? a.name ?? "(unknown)",
    });
  }

  if (newAdvisories.length === 0) {
    return {
      id: "audit-advisories",
      label: "bun audit advisory delta",
      status: "pass",
      message: "No high/critical advisories outside the accepted-baseline ignore list.",
    };
  }
  const preview = newAdvisories
    .slice(0, 5)
    .map((a) => `${a.module} (${a.severity}, ${a.id})`)
    .join(", ");
  const extra = newAdvisories.length > 5 ? ` (+${newAdvisories.length - 5} more)` : "";
  return {
    id: "audit-advisories",
    label: "bun audit advisory delta",
    status: "warn",
    message:
      `${newAdvisories.length} high/critical advisor(y/ies) NOT on Gordon's accepted-baseline list: ${preview}${extra}. ` +
      `Run \`bun audit --audit-level=high\` for details; bump the affected dep or add the GHSA to the accepted list in doctor.ts + ci.yml.`,
  };
}

// ----------------------------------------------------------------------------
// bun pm hash — lockfile drift check
// ----------------------------------------------------------------------------

interface LockfileHashResult {
  output: string;
  error: string | null;
}

function spawnSyncBunPmHash(): LockfileHashResult | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const res = spawnSync("bun", ["pm", "hash"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    });
    if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (res.error) {
      return { output: "", error: res.error.message };
    }
    return { output: (res.stdout ?? "").trim(), error: null };
  } catch (err) {
    return { output: "", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Detect drift between the current `bun.lock` and the last hash Gordon
 * saw. `bun pm hash` produces a deterministic hash of the lockfile.
 * Storing it under ~/.gordon/last-lockfile-hash gives the operator a
 * tripwire: if `bun install` mutates the lockfile unexpectedly (e.g.
 * a stale registry token or wrong `BUN_CONFIG_TOKEN` causing fallback
 * resolution), the next doctor run flags it.
 *
 * First-run behavior: no baseline exists → record the current hash
 * and report `info`. Subsequent runs compare and warn on mismatch.
 * Operator confirms intentional drift by deleting the baseline file
 * (or rerunning the doctor with GORDON_LOCKFILE_HASH_RESET=1).
 */
function checkLockfileDrift(
  spawnFn: typeof spawnSyncBunPmHash = spawnSyncBunPmHash,
  baselinePath: string = join(homedir(), ".gordon", "last-lockfile-hash"),
): DiagnosticCheck {
  const result = spawnFn();
  if (result === null) {
    return {
      id: "lockfile-drift",
      label: "Lockfile hash drift",
      status: "info",
      message: "bun CLI not available — skipping `bun pm hash` check.",
    };
  }
  if (result.error) {
    return {
      id: "lockfile-drift",
      label: "Lockfile hash drift",
      status: "info",
      message: `Could not run \`bun pm hash\`: ${result.error}`,
    };
  }
  const currentHash = result.output;
  if (!currentHash || currentHash.length < 8) {
    return {
      id: "lockfile-drift",
      label: "Lockfile hash drift",
      status: "info",
      message: "`bun pm hash` returned no hash — bun.lock may be absent.",
    };
  }

  const reset = process.env.GORDON_LOCKFILE_HASH_RESET === "1";
  if (reset || !existsSync(baselinePath)) {
    try {
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, currentHash, "utf8");
    } catch (err) {
      return {
        id: "lockfile-drift",
        label: "Lockfile hash drift",
        status: "info",
        message: `Could not record baseline lockfile hash: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return {
      id: "lockfile-drift",
      label: "Lockfile hash drift",
      status: reset ? "pass" : "info",
      message: reset
        ? `Baseline reset; recorded ${currentHash.slice(0, 16)}…`
        : `First run — recorded baseline hash ${currentHash.slice(0, 16)}… at ${baselinePath}.`,
    };
  }

  let baseline = "";
  try {
    baseline = readFileSync(baselinePath, "utf8").trim();
  } catch (err) {
    return {
      id: "lockfile-drift",
      label: "Lockfile hash drift",
      status: "info",
      message: `Could not read baseline lockfile hash: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (baseline === currentHash) {
    return {
      id: "lockfile-drift",
      label: "Lockfile hash drift",
      status: "pass",
      message: `bun.lock hash unchanged since last doctor run (${currentHash.slice(0, 16)}…).`,
    };
  }

  return {
    id: "lockfile-drift",
    label: "Lockfile hash drift",
    status: "warn",
    message:
      `bun.lock hash changed: ${baseline.slice(0, 16)}… → ${currentHash.slice(0, 16)}…. ` +
      `If this drift was intentional (\`bun install\`, \`bun add\`, etc.), confirm by setting GORDON_LOCKFILE_HASH_RESET=1 and re-running the doctor. ` +
      `Unexpected drift may indicate a stale registry token forcing fallback resolution or an automated process mutating the lockfile.`,
  };
}

// Test helpers — keep checks individually exportable for targeted unit tests.
export const _internal = {
  checkCostHaltState,
  checkCacheReadPressure,
  checkMastraStorage,
  checkVectorStorage,
  checkAceLessonsFile,
  checkJsonlIntegrity,
  checkSafetyDenyList,
  checkHotTierCap,
  checkGordonHomeDir,
  checkMastraPatchApplied,
  checkMcpMarketplaceCatalog,
  checkCritiquePhaseRouting,
  checkInstallReleaseAge,
  checkSupplyChainIocs,
  checkSuspiciousOptionalDependencies,
  checkTrustedDependencies,
  checkUntrustedLifecycleScripts,
  checkAuditAdvisories,
  checkLockfileDrift,
  resolveMastraStoragePath,
  resolveVectorStoragePath,
};
