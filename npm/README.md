<h1 align="center">Gordon CLI</h1>

<p align="center">
  The Frontier Trading Agent
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@general-liquidity/gordon">npm</a> •
  <a href="https://gordoncli.com">Website</a> •
  <a href="https://docs.gordon.trade">Docs</a> •
  <a href="https://github.com/general-liquidity/gordon/releases">Downloads</a>
</p>

## Install

`npm`:

```bash
npm install -g @general-liquidity/gordon
```

If global npm install fails with `EACCES` / permission errors on Linux or macOS, point npm's global prefix at a user-writable directory (no `sudo`):

```bash
npm config set prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
npm install -g @general-liquidity/gordon
```

`bun`:

```bash
bun add -g @general-liquidity/gordon
```

`Homebrew`:

```bash
brew tap general-liquidity/gordon https://github.com/general-liquidity/gordon
brew install general-liquidity/gordon/gordon
```

`Scoop`:

```powershell
scoop bucket add gordon https://github.com/general-liquidity/gordon
scoop install gordon/gordon
```

Standalone install script:

```bash
curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon/main/scripts/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/general-liquidity/gordon/main/scripts/install.ps1 | iex
```

The npm package is a thin launcher. The matching prebuilt binary for your platform ships as an `optionalDependency` (`@general-liquidity/gordon-<platform>`), so npm installs only the one binary your OS/CPU/libc needs — straight from the registry, with no separate binary download step. Platforms without a published binary fail with a clear message instead of a broken install.

## Upgrades

Upgrade to the latest published release with your package manager:

```bash
npm install -g @general-liquidity/gordon@latest
```

(or `bun add -g`, `brew upgrade`, `scoop update` for the other channels).

## Supported binaries

- macOS arm64 / x64
- Linux arm64 / x64 (glibc)
- Linux arm64 / x64 (musl — Alpine, etc.)
- Windows x64
- Windows arm64 (best-effort)

Release binaries and package manager manifests are published at:

- `https://github.com/general-liquidity/gordon/releases`

## Setup

Set one LLM provider key before first launch:

```bash
export OPENAI_API_KEY="sk-..."
```

or

```bash
export DEDALUS_API_KEY="dd-..."
```

or

```bash
export INCEPTION_API_KEY="..."
```

Then run:

```bash
gordon
```

## Docs

- Website: `https://gordoncli.com`
- Docs: `https://docs.gordon.trade`
- Public distribution repo: `https://github.com/general-liquidity/gordon`
