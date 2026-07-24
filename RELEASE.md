# Releasing Gordon CLI

Gordon ships in two channels off the same tag-driven pipeline in
`.github/workflows/release.yml`:

- **`@friends`** — private-alpha builds. Any git tag matching
  `friends | alpha | beta | rc` publishes here (e.g. `v0.9.0-friends.9`).
- **`@latest`** — the public stable channel. Any tag that does *not* match
  those pre-release markers publishes here (e.g. `v0.9.0`).

The dist-tag is chosen automatically by the `Determine npm dist-tag` step in
`release.yml`. You do not pass `--tag` by hand in CI.

## Version decision for the first public release

The friends line is `0.9.0-friends.9`. In semver, `0.9.0-friends.9` is a
*pre-release of* `0.9.0`, so the natural graduation is the clean `0.9.0`.

We publish **`0.9.0`**, not `1.0.0-rc.1`, because:

1. `release.yml` routes any tag containing `rc` to the `@friends` dist-tag.
   Tagging `v1.0.0-rc.1` would keep the build off `@latest` — the opposite of
   a public release. `v0.9.0` is the only shape that reaches `@latest` without
   editing the workflow.
2. `0.9.0` is the exact stable version the friends builds were pre-releasing.
   It signals "the alpha line is now public," not a 1.0 maturity promise we
   are not making yet.

`package.json` is therefore set to `version: 0.9.0` and `private: false`
(the `@friends` builds carried `private: true`, which blocks `npm publish`).

## Publish flow (operator, from a clean `main`)

The published artifact is the thin wrapper in `npm/` (it downloads the
platform binary on install); its version is stamped from the git tag via
`GORDON_NPM_VERSION`. Everything is driven by pushing a tag — CI does the
build, the SBOM, the public-dist sync, and the `npm publish`.

```bash
# 1. Land the version bump (this change) on main.
git checkout main && git pull

# 2. Tag the public release. No pre-release suffix => @latest.
git tag v0.9.0
git push origin v0.9.0
```

That tag push runs `release.yml`, which builds all platform binaries and, in
the `Publish to npm` job, runs the equivalent of:

```bash
# (executed by CI in the npm/ wrapper dir — shown for reference only)
npm publish --access public --tag latest --provenance
```

## Flipping `@friends` -> `@latest` for an already-published version

If a version was already pushed to `@friends` and you want to promote that
exact tarball to the public default channel (no rebuild), move the dist-tag:

```bash
# Point @latest at the version currently on @friends.
npm dist-tag add @general-liquidity/gordon@0.9.0 latest

# Optional: retire the friends pointer once latest is live.
npm dist-tag rm @general-liquidity/gordon friends

# Verify the channel map.
npm dist-tag ls @general-liquidity/gordon
```

`npm install -g @general-liquidity/gordon` resolves `@latest`, so after the
flip a stranger installs the public build by default.

## Do NOT

- Do not run `npm publish` from the repo root — the root package is the source
  tree, not the shippable wrapper (`files` differ, and publishing it would leak
  source). CI publishes from `npm/`.
- Do not tag a public release with an `rc` / `beta` / `alpha` / `friends`
  suffix; it silently lands on `@friends`.
