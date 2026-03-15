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

`bun`:

```bash
bun add -g @general-liquidity/gordon-cli
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
