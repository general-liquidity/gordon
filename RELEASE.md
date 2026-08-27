# Releasing Gordon CLI

Gordon ships from a single tag-driven pipeline in `.github/workflows/release.yml`.
One tag builds the platform matrix once, publishes the npm packages, and uploads
the same binaries as GitHub Release assets for the curl / Homebrew / Scoop
channels. There is no separate dist repo and no install-time download.

## Distribution model (codex-style optionalDependencies)

The published root package is `@general-liquidity/gordon`. It carries **no
binary of its own**. Instead it declares one `optionalDependencies` entry per
platform, and npm installs only the sub-package that matches the host via its
`os` / `cpu` / `libc` fields:

| Sub-package | Target |
|---|---|
| `@general-liquidity/gordon-linux-x64` | Linux x64 (glibc) |
| `@general-liquidity/gordon-linux-arm64` | Linux arm64 (glibc) |
| `@general-liquidity/gordon-linux-x64-musl` | Linux x64 (musl / Alpine) |
| `@general-liquidity/gordon-linux-arm64-musl` | Linux arm64 (musl / Alpine) |
| `@general-liquidity/gordon-darwin-x64` | macOS Intel |
| `@general-liquidity/gordon-darwin-arm64` | macOS Apple Silicon |
| `@general-liquidity/gordon-win32-x64` | Windows x64 |
| `@general-liquidity/gordon-win32-arm64` | Windows arm64 |

All nine packages (root + eight platforms) are versioned together and published
in the same release. `bin/gordon.cjs` resolves the installed platform
sub-package at runtime and execs its vendored binary — nothing is fetched on
install, so there is **no postinstall step**.

The root package is CLI-only and intentionally has no `main` or `module`
source export. Supported source-package launches enter through
`bin/gordon.cjs`; raw Bun execution of files under `src/` is unsupported
because a caller-controlled cwd preload can run before application code.

```bash
npm i -g @general-liquidity/gordon
```

npm selects the matching platform package automatically. If no sub-package
matches the host (unsupported platform), the install degrades gracefully:
`bin/gordon.cjs` emits a clear error naming the missing package instead of
crashing.

## Versioning

Fresh semver starting at **`0.1.0`**. The dist-tag is chosen automatically by
the `Determine npm dist-tag` step in `release.yml` — you do not pass `--tag` by
hand:

- **Pre-release tags** (`v0.1.0-alpha.N`, `v0.1.0-beta.N`, `v0.1.0-rc.N`) route
  to the `@friends` / prerelease dist-tag.
- **Stable tags** (`vX.Y.Z` with no pre-release suffix) route to `@latest`.

`package.json` is set to `version: 0.1.0` and `private: false` (a `private: true`
package blocks `npm publish`).

## Release flow (operator, from a clean `main`)

Everything is driven by pushing a tag. CI builds the 8-target matrix, stages the
per-platform sub-packages, publishes the root plus every sub-package to npm with
`--provenance`, and uploads the binaries as GitHub Release assets.

Before creating a tag, run and watch the non-publishing rehearsal. It derives
the shard and binary matrices from the tag workflow itself and exercises frozen
locks, SBOM generation, broker gates, npm/public-dist audits, all wrapper hosts,
and every binary target including Windows ARM64. It also stages all eight
platform packages and runs the Formula, Scoop, and SHA256SUMS hash wiring
against rehearsal copies. The host binary is run from a cwd containing hostile
dotenv controls and must report the exact package version. The rehearsal never
publishes or edits the production manifests:

```bash
gh workflow run release-rehearsal.yml --ref main
gh run watch "$(gh run list --workflow release-rehearsal.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

```bash
# 1. Land the version bump on main.
git checkout main && git pull

# 2. Tag the release. No pre-release suffix => @latest.
git tag v0.1.0
git push origin v0.1.0
```

That tag push runs `release.yml`, which:

1. Builds all eight platform binaries once from the single repo
   (`general-liquidity/gordon`).
2. Stages each binary into its `@general-liquidity/gordon-<platform>`
   sub-package, all stamped with the tag version.
3. Publishes the root package and all eight sub-packages to npm
   (`npm publish --access public --provenance`, dist-tag chosen per the
   versioning rules above).
4. Uploads the same binaries as assets on the GitHub Release for the tag, which
   feed the curl / Homebrew / Scoop channels.

## Install channels

All channels pull from the **same** GitHub Release assets — the npm binaries and
the standalone downloads are byte-identical builds from one matrix run.

- **npm** (primary): `npm i -g @general-liquidity/gordon` — resolves `@latest`,
  so a stranger installs the public build by default.
- **curl**: `install.sh` (Unix) / `install.ps1` (Windows) download the matching
  binary from the GitHub Release.
- **Homebrew**: formula points at the Release asset.
- **Scoop**: manifest points at the Release asset.

## Flipping `@friends` -> `@latest` for an already-published version

To promote an exact tarball already on `@friends` to the public default channel
without a rebuild, move the dist-tag. Do this for the root package **and** every
platform sub-package so the whole set resolves consistently:

```bash
# Point @latest at the version currently on @friends (repeat per package).
npm dist-tag add @general-liquidity/gordon@0.1.0 latest
npm dist-tag add @general-liquidity/gordon-linux-x64@0.1.0 latest
# ... repeat for each @general-liquidity/gordon-<platform> package ...

# Optional: retire the friends pointer once latest is live.
npm dist-tag rm @general-liquidity/gordon friends

# Verify the channel map.
npm dist-tag ls @general-liquidity/gordon
```

## Do NOT

- Do not tag a public release with a `-rc` / `-beta` / `-alpha` suffix; it lands
  on `@friends` instead of `@latest`.
- Do not publish a single platform sub-package out of band. The root package's
  `optionalDependencies` pin the exact matching version, so a version skew
  between root and sub-packages breaks resolution. Publish the whole set from CI.
- Do not reintroduce a postinstall download. Binaries ship inside the platform
  sub-packages; `bin/gordon.cjs` resolves them locally.
