# scripts/

Build, package, install, and dev-tooling scripts. Organized by purpose:

```
scripts/
├── build/          Build pipeline (run by `bun run build` and CI)
├── npm/            npm wrapper packaging + audits
├── patches/        Postinstall patches for upstream packages
├── dev/            Developer-only utilities (one-off audits, doc generation)
├── install.sh      Public Linux/macOS installer (referenced by README curl URL — do NOT move)
├── install.ps1     Public Windows installer
└── scoop/          Scoop manifest (release pipeline edits gordon.json — do NOT move)
```

## build/

| File | What it does |
|---|---|
| `build.ts` | `bun run build` — compiles `src/` to `dist/`. `--binary` produces a single executable. |
| `prepare-public-dist.cjs` | Copies the build output into a public-distribution layout for the npm wrapper. Used by CI. |
| `check-no-sourcemaps.cjs` | Asserts no `.map` files leaked into `dist/` or `npm/`. Runs in `prepublishOnly`. |

## npm/

| File | What it does |
|---|---|
| `prepare-npm-wrapper.cjs` | Builds the thin `@general-liquidity/gordon-cli` npm package that downloads the platform binary on install. |
| `check-npm-wrapper.cjs` | Schema-checks the generated wrapper before publish. |
| `smoke-npm-wrapper.cjs` | Installs the packed wrapper into a clean dir and exercises `gordon --version`. |
| `audit-npm-pack.cjs` | Runs `npm pack --dry-run` + asserts only the whitelisted files ship. |

## patches/

| File | What it does |
|---|---|
| `patch-mastra.cjs` | Postinstall: reverts Mastra's hardcoded `lastMessages: 0` for sub-agents (→ 0, the framework default), shims OpenAI `.responses()` → `createOpenAICompatible` for Dedalus, stubs empty `@solana/rpc-parsed-types`, and patches `@solana-agent-kit/plugin-token` named CJS imports. |
| `patch-ink.cjs` | Postinstall: wraps Ink's render scheduler in `queueMicrotask()` (Claude Code's fork pattern) so React's layout phase commits before the terminal write. |

Both run automatically via `npm install` → `package.json` postinstall hook.

## dev/

| File | What it does |
|---|---|
| `broker-quality.ts` | Conformance + capability matrix audit across all broker adapters. CI runs `--ci` mode. |
| `generate-action-docs.ts` | Generates `docs/generated/actions.md` from the canonical action registry. |
| `sweep-react-compiler.ts` | Compiles every `.tsx` under `src/` through the React Compiler, reports bail-outs. Used to verify Phase 5 zero-bail-out invariant. |
| `smoke-react-compiler.ts` | Tiny end-to-end Babel-pipeline check that the compiler emits its memoization fingerprint. |

## Conventions

- Every script resolves the project root via `path.resolve(__dirname, "..", "..")` (or `import.meta.dirname` for ESM). The two `..`s are because each script sits one level deeper than the project root.
- `.cjs` for postinstall + npm-wrapper tools (Node guaranteed at install time).
- `.ts` for everything Bun-native.

## Adding a new script

1. Pick the right subdir (or top-level for public-install scripts).
2. Resolve the project root with `path.resolve(__dirname, "..", "..")`.
3. Wire it into `package.json` `scripts` block with the full subpath.
4. If it runs in CI, also add to `.github/workflows/{ci,release}.yml`.

## Supply-chain hardening

Three install-time defenses against npm worm attacks (TeamPCP's
Mini Shai-Hulud, 2026-05; SLSA-attested malicious tarballs):

0. **Bun's default no-lifecycle-script behavior** — this is the single
   strongest defense Gordon has, and it's free by virtue of running
   on Bun. Bun does NOT execute dependency `preinstall` / `install` /
   `postinstall` / `prepare` lifecycle scripts unless the package is
   explicitly in `trustedDependencies`. The TanStack worm's attack
   vector was a malicious `prepare` script on a smuggled
   `@tanstack/setup` git dep — that script CANNOT fire under Bun
   without an explicit trust grant. Do not add anything to
   `trustedDependencies` without verifying the package, and prefer
   `bun add --trust <pkg>` (deliberate, audited) over hand-editing
   the field. `checkTrustedDependencies` doctor check warns if any
   entries exist so trust additions stay reviewed.
1. **`bunfig.toml` `[install] minimumReleaseAge = 172800`** — Bun
   refuses to install any package version published less than 48h ago.
   Covers the typical community-detection horizon for malicious
   publishes. Do not lower this without a specific reason.
2. **`package.json` `overrides`** pins the 4 `@tanstack/*` packages
   currently in Gordon's transitive tree to versions verified outside
   the May-2026 compromised range (carlini's reproducible list noted
   `query*` and `virtual*` packages as clean). When upgrading these
   intentionally, cross-check the target version against any active
   advisory list before bumping.

Doctor (`src/infra/diagnostics/doctor.ts`) re-asserts both gates each
session via `checkInstallReleaseAge` and `checkSupplyChainIocs`. If
either reverts (config edit, IOC files appearing in the tree), the
checks surface a warn/fail. See:
- https://docs.npmjs.com/cli/v11/using-npm/config#min-release-age
- https://www.stepsecurity.io/blog/mini-shai-hulud-is-back-a-self-spreading-supply-chain-attack-hits-the-npm-ecosystem

### Publish-flow hardening

3. **CI dep audit** — `.github/workflows/ci.yml` runs `bun audit
   --audit-level=critical` on every PR + main push. Surfaces critical
   advisories in the transitive tree before merge. Tighten to `high`
   then `moderate` once the noise floor is understood for Gordon's
   dep set.
4. **SLSA provenance on publish** — `.github/workflows/release.yml`
   has `permissions: id-token: write` on the `publish-npm` job and
   passes `--provenance` to `npm publish`. Each release tarball gets
   a Sigstore attestation tying it to this specific workflow run, so
   downstream installers can verify authenticity via
   `npm audit signatures`.

### Maintainer-account hygiene (manual, npmjs.com web UI)

These can't be enforced from code — they're npm-account settings the
maintainer must apply directly. Critical after the TeamPCP worm
specifically searched for `bypass_2fa: true` tokens:

- **Enable 2FA on the npm account** at npmjs.com → Account Settings.
  Required for publishing anyway since November 2025. Pick
  "Authorization and writes" (default) — NOT "Authorization only".
- **Link a GitHub account for 2FA recovery** at npmjs.com → Account
  Settings → "Linked Accounts & Recovery Option" → Link with GitHub.
  Save the recovery codes in a password manager — these are the only
  way to recover the account if the 2FA device is lost.
- **Set per-package MFA to `automation`** on the published package:
  `npm access set mfa=automation @general-liquidity/gordon-cli`.
  Forces every publish (interactive or token-based) to use either
  trusted-publisher OIDC or a granular automation-class token. Default
  `none` allows any token to publish — the worm's exact attack vector.
- **Never create a token with `bypass_2fa: true`.** The worm
  enumerated tokens via `registry.npmjs.org/-/npm/v1/tokens` and
  filtered for `bypass_2fa === true` specifically; a 2FA-required
  token is structurally unusable to this attack class.
- **Lock CI tokens by IP CIDR.** When creating an npm token for CI,
  pass `--cidr=<github-actions-ip-range>` (see GitHub's published
  Actions IP ranges at `https://api.github.com/meta`). Stolen tokens
  used outside this range get rejected at the registry.
- **Use granular access tokens** scoped to a single package or scope
  with read-only access unless write is genuinely needed
  (`npm token create --read-only` or
  `--packages-and-scopes-permission=read-only`). `legacy` tokens were
  removed November 2025; use granular only.
- **Migrate to trusted publishing** once stable. Requires npmjs.com
  package settings → "Trusted Publisher" → GitHub Actions →
  workflow filename `release.yml`. After the trust binding is
  configured, set "Require two-factor authentication and disallow
  tokens" in package settings to eliminate token-based publish
  entirely. The `id-token: write` permission is already wired in
  `release.yml`, so the migration is npmjs.com side only.
  See: https://docs.npmjs.com/trusted-publishers

### Provenance enforced in `npm/package.json`

`npm/package.json` has `"publishConfig": { "provenance": true }` so
provenance generation is locked at the package level — even if a
release-time `--provenance` CLI flag is dropped by mistake, npm will
still require the OIDC token and emit a Sigstore attestation. Pairs
with the `id-token: write` permission in `release.yml`.

### Compromise detection (one more doctor check)

`checkSuspiciousOptionalDependencies` scans every installed manifest
under `node_modules/**/package.json` for `optionalDependencies`
entries pointing at git URLs — the exact attack signature the
TanStack worm used to smuggle `@tanstack/setup": "github:tanstack/router#79ac49ee..."`
into compromised tarballs and trigger a malicious `prepare` lifecycle
script. Legitimate packages almost never declare git-URL
optionalDependencies; finding one is a strong compromise signal
regardless of which dependency was poisoned.

### Release artifacts

Every release in `.github/workflows/release.yml` produces:

- **CycloneDX SBOM** (`gordon-sbom.json`) attached to the GitHub
  release. Generated by `scripts/dev/generate-sbom.cjs` which calls
  `npm sbom --sbom-format=cyclonedx --sbom-type=application
  --package-lock-only` against the source tree. Downstream
  consumers can verify Gordon's full dependency tree by
  cryptographic hash, trace upstream sources, and audit the supply
  chain offline. Bun does not have an SBOM command — the script
  uses the npm CLI which is already present in CI for the wrapper
  publish flow.
- **Sigstore provenance attestation** on the published npm wrapper
  (locked via `publishConfig.provenance: true` in `npm/package.json`
  + `id-token: write` permission in the workflow). Downstream
  installers can verify with `npm audit signatures`.

### Downstream verification (for Gordon's users)

After installing the npm wrapper, users can verify its authenticity:

```bash
npm install -g @general-liquidity/gordon-cli
npm audit signatures
```

This checks Sigstore signatures + SLSA provenance attestations and
returns non-zero if any installed package shows tampering. Pairs
with the SBOM at the release page: cross-reference package hashes.

### Incident response

If you discover malware in Gordon or in one of its dependencies:

1. **Report to npm Security** via the form at
   https://www.npmjs.com/support — provide affected package name,
   versions, malware description, and references. npm Security
   confirms validity, removes the package from the registry,
   publishes a security placeholder, and posts an advisory. They
   may also ban the uploader account.
2. **Notify users** by deprecating the affected Gordon release on
   npm: `npm deprecate @general-liquidity/gordon-cli@<bad-version>
   "Compromised — upgrade to <safe-version> immediately"`.
3. **Rotate all credentials** that may have been accessible from
   the affected environment (AWS, GitHub, npm tokens, etc.).
4. **File the GitHub Advisory** so the incident becomes searchable
   via `npm audit`.

See: https://docs.npmjs.com/reporting-malware-in-an-npm-package
