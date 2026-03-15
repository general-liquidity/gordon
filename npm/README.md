<h1 align="center">Gordon CLI</h1>

<p align="center">
  The Frontier Trading Agent
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@general-liquidity/gordon-cli">npm</a> •
  <a href="https://gordoncli.com">Website</a> •
  <a href="https://docs.gordon.trade">Docs</a> •
  <a href="https://github.com/general-liquidity/gordon-cli-dist/releases">Downloads</a>
</p>

## Install

`npm`:

```bash
npm install -g @general-liquidity/gordon-cli
```

If global npm install fails with `EACCES` / permission errors on Linux or macOS, use the user-local npm path instead:

```bash
npx @general-liquidity/gordon-cli@latest install
```

That installs Gordon into a user-writable bin directory without `sudo`.

`bun`:

```bash
bun add -g @general-liquidity/gordon-cli
```

`Homebrew`:

```bash
brew tap general-liquidity/gordon-cli-dist https://github.com/general-liquidity/gordon-cli-dist
brew install general-liquidity/gordon-cli-dist/gordon
```

`Scoop`:

```powershell
scoop bucket add gordon https://github.com/general-liquidity/gordon-cli-dist
scoop install gordon/gordon
```

Standalone install script:

```bash
curl -fsSL https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/general-liquidity/gordon-cli-dist/main/install.ps1 | iex
```

The npm package is a thin wrapper. It downloads the matching prebuilt binary for your platform during install.

## npm Permission Fallback

Global `npm install -g` can fail on Unix machines when the npm global prefix is root-owned. Gordon now supports a universal npm fallback:

```bash
npx @general-liquidity/gordon-cli@latest install
```

If the chosen install directory is not already on `PATH`, Gordon prints the exact command to add it.

## Upgrades

Once installed, Gordon can upgrade itself with:

```bash
gordon --upgrade
```

That now resolves through the active install channel for npm, the user-local `npx` installer, Homebrew, Scoop, and the standalone install scripts.

## Supported binaries

- macOS arm64
- macOS x64
- Linux arm64
- Linux x64
- Windows x64

Release binaries and package manager manifests are published at:

- `https://github.com/general-liquidity/gordon-cli-dist/releases`

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
- Public distribution repo: `https://github.com/general-liquidity/gordon-cli-dist`
