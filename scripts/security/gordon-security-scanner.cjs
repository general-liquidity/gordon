#!/usr/bin/env node
/**
 * Gordon security scanner — Bun `install.security.scanner` implementation.
 *
 * Bun's package-manager security-scanner API expects an npm package that
 * exports a `{ scanner: { version, scan({ packages }) } }` shape. This
 * file implements that shape against checks Gordon already runs through
 * the doctor + npm-pack-content audit, packaged in the format
 * `bun install` invokes during dependency resolution.
 *
 * Behavior:
 *   - WARN on `optionalDependencies` declared via git URL — the TanStack
 *     May-2026 worm signature. Legitimate packages almost never publish
 *     git-URL optional deps; finding one in the resolved manifest is a
 *     strong compromise signal.
 *   - WARN on tarball name matches against the known compromised set
 *     (Shai-Hulud, TanStack worm victims) at versions known to be
 *     poisoned. Static list; expand as new IOCs are documented.
 *   - INFO on `prepare` / `postinstall` lifecycle scripts touching the
 *     network. Doesn't block — only flags so a reviewer notices that
 *     the package would run install-time code (already blocked by
 *     Bun's default no-lifecycle-script policy unless explicitly
 *     trusted).
 *
 * Importantly: this scanner never returns `fatal` advisories. Bun aborts
 * an install on `fatal`, and Gordon's threat model is "alert the
 * operator, don't unilaterally block their work." Use Bun's existing
 * `trustedDependencies` mechanism + the doctor's deeper IOC scan when
 * actually blocking is required.
 *
 * To enable, point `bunfig.toml` at this file's npm-published wrapper:
 *
 *   [install.security]
 *   scanner = "@general-liquidity/gordon-security-scanner"
 *
 * (Bun requires an npm-package name; raw file paths are not accepted.
 * The slot in bunfig.toml is commented out until the wrapper package
 * is published.)
 */

// Known-compromised name@version pairs. Format: "<package-name>@<version>".
// Sourced from the May-2026 TanStack worm post-mortem + Shai-Hulud
// indicators. Add new entries as advisories land.
const POISONED_VERSIONS = new Set([
  // TanStack worm — these specific versions shipped malicious code.
  // The legitimate maintainers republished clean versions, but the
  // poisoned tags were never deleted from the registry.
  "@tanstack/router@1.107.1",
  "@tanstack/router@1.107.2",
  "@tanstack/start@1.107.1",
  "@tanstack/history@1.107.1",
  // Shai-Hulud (chalk/ansi-styles 2024). Listed for posterity even
  // though pinned-version installs would refuse them via lockfile.
  "chalk@5.3.1",
  "ansi-styles@6.2.2",
]);

// Lifecycle-script names whose presence we want to flag as INFO.
// `prepare` is the worm's preferred trigger because it fires even on
// `npm install <git-url>` and runs before any other check.
const FLAGGED_LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

// Regex for git-URL specifiers in dependency fields. Mirrors the same
// pattern the doctor's checkSuspiciousOptionalDependencies uses.
const GIT_URL_RE = /^(?:git[+@:]|github:|https?:\/\/.*\.git|.*#[a-f0-9]{40,})/i;

/**
 * Inspect one package and return an array of advisory objects in the
 * shape Bun's scanner API expects.
 *
 * Each advisory: { level: "warn" | "fatal" | "info", package, url?, description }
 */
function scanPackage(pkg) {
  const advisories = [];
  const name = pkg.name || "";
  const version = pkg.version || "";
  const manifest = pkg.manifest || {};
  const id = `${name}@${version}`;

  // 1. Static poisoned-version check.
  if (POISONED_VERSIONS.has(id)) {
    advisories.push({
      level: "warn",
      package: id,
      description:
        `${id} matches a known-compromised version on Gordon's IOC list. ` +
        `Pin to a verified-safe version via package.json overrides before installing.`,
    });
  }

  // 2. Git-URL optionalDependencies — TanStack worm signature.
  const optional = manifest.optionalDependencies;
  if (optional && typeof optional === "object") {
    for (const [dep, spec] of Object.entries(optional)) {
      if (typeof spec === "string" && GIT_URL_RE.test(spec)) {
        advisories.push({
          level: "warn",
          package: id,
          description:
            `${id} declares optionalDependencies['${dep}'] via git URL (${spec.slice(0, 80)}). ` +
            `Legitimate packages almost never do this; matches TanStack worm payload signature.`,
        });
      }
    }
  }

  // 3. Lifecycle scripts — INFO, never blocks. Bun's default
  // no-lifecycle-script policy already neuters these unless the
  // package is in trustedDependencies, so this is purely a reviewer
  // hint when the install summary lists "X packages have postinstall
  // scripts that were not run."
  const scripts = manifest.scripts;
  if (scripts && typeof scripts === "object") {
    const lifecycles = FLAGGED_LIFECYCLE_SCRIPTS.filter(
      (name) => typeof scripts[name] === "string",
    );
    if (lifecycles.length > 0) {
      advisories.push({
        level: "info",
        package: id,
        description:
          `${id} declares lifecycle script(s): ${lifecycles.join(", ")}. ` +
          `Will only execute if added to trustedDependencies. Review the script content before granting trust.`,
      });
    }
  }

  return advisories;
}

const scanner = {
  version: "1",

  /**
   * @param {{ packages: Array<{ name: string, version: string, manifest?: object }> }} input
   * @returns {Promise<Array<{ level: string, package: string, description: string, url?: string }>>}
   */
  async scan({ packages }) {
    if (!Array.isArray(packages)) return [];
    const advisories = [];
    for (const pkg of packages) {
      for (const advisory of scanPackage(pkg)) {
        advisories.push(advisory);
      }
    }
    return advisories;
  },
};

module.exports = { scanner };

// Standalone CLI mode: `node gordon-security-scanner.cjs --self-test`
// runs a built-in sanity check that the scanner flags both signatures.
// Useful in CI to detect regression in the rule set without spinning
// up an actual `bun install`.
if (require.main === module && process.argv.includes("--self-test")) {
  const fixtures = [
    {
      name: "@tanstack/router",
      version: "1.107.1",
      manifest: {},
    },
    {
      name: "innocent-looking",
      version: "0.1.0",
      manifest: {
        optionalDependencies: { "@tanstack/setup": "github:tanstack/router#79ac49ee" },
      },
    },
    {
      name: "has-postinstall",
      version: "1.0.0",
      manifest: { scripts: { postinstall: "node ./build.js" } },
    },
    {
      name: "clean-package",
      version: "1.0.0",
      manifest: {},
    },
  ];
  scanner.scan({ packages: fixtures }).then((out) => {
    const byPkg = new Map();
    for (const a of out) {
      if (!byPkg.has(a.package)) byPkg.set(a.package, []);
      byPkg.get(a.package).push(a);
    }
    const expectations = [
      ["@tanstack/router@1.107.1", "warn"],
      ["innocent-looking@0.1.0", "warn"],
      ["has-postinstall@1.0.0", "info"],
    ];
    let failed = false;
    for (const [pkgId, expectedLevel] of expectations) {
      const hits = byPkg.get(pkgId) || [];
      const match = hits.find((h) => h.level === expectedLevel);
      if (!match) {
        console.error(`FAIL: expected ${expectedLevel} advisory for ${pkgId}`);
        failed = true;
      } else {
        console.log(`PASS: ${pkgId} → ${expectedLevel}`);
      }
    }
    if (byPkg.has("clean-package@1.0.0")) {
      console.error("FAIL: clean-package@1.0.0 should produce no advisories");
      failed = true;
    } else {
      console.log("PASS: clean-package@1.0.0 → no advisories");
    }
    if (failed) process.exit(1);
    console.log("Self-test OK.");
  });
}
