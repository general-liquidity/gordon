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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { isCostHalted, getCostTracker } from "../platform/costTracker.ts";
import { MAX_WORKING_MEMORY_CHARS } from "../agents/memoryGate.ts";
import { isSafetyCritical } from "../../runtime/permissions/trustTrajectory.ts";
import { getACELessonsPath } from "../agents/ace/index.ts";
import { defaultReviewQueuePath } from "../domain/evals/harness/reviewQueue.ts";
import { defaultAgentFeedbackPath } from "../agents/tools/agent-feedback.ts";

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
    "place_order",
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
    const usesCritique = src.includes('resolveLegacyModelRouteForWorkflowPhase("critique")');
    const usesCompaction = src.includes('resolveLegacyModelRouteForWorkflowPhase("compaction")');
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
        message: "critiquePhase.ts doesn't reference resolveLegacyModelRouteForWorkflowPhase('critique') — file may have been refactored. Verify routing manually.",
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
  ];
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
  resolveMastraStoragePath,
  resolveVectorStoragePath,
};
