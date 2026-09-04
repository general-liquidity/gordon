# Gordon integrations

Gordon separates market connectivity, model reasoning, data enrichment, and host surfaces. Configure only the integrations you use; unconfigured modules do not need placeholder credentials.

## Crypto exchanges

9 first-class venue identifiers have curated credential names and Gordon-specific capability metadata. All route through the CCXT adapter at runtime.

| Exchange | Primary coverage | Runtime path |
|---|---|---|
| <img height="16" align="top" src="../assets/integrations/binance.svg" alt="" /> Binance | Spot | CCXT |
| <img height="16" align="top" src="../assets/integrations/binance.svg" alt="" /> Binance US | Spot | CCXT |
| <img height="16" align="top" src="../assets/integrations/coinbase.png" alt="" /> Coinbase | Spot | CCXT |
| <img height="16" align="top" src="../assets/integrations/kraken.png" alt="" /> Kraken | Spot | CCXT |
| Bitfinex | Spot and margin markets exposed by CCXT | CCXT |
| <img height="16" align="top" src="../assets/integrations/hyperliquid.png" alt="" /> Hyperliquid | Perpetuals and wallet-based authentication | CCXT |
| <img height="16" align="top" src="../assets/integrations/robinhood.svg" alt="" /> Robinhood | Crypto | CCXT |
| <img height="16" align="top" src="../assets/integrations/okx.svg" alt="" /> OKX | Spot and derivatives exposed by CCXT | CCXT |
| <img height="16" align="top" src="../assets/integrations/gemini-exchange.png" alt="" /> Gemini | Spot | CCXT |

The factory also accepts the wider CCXT catalog through `ccxt:<id>`, including venues such as Bybit, KuCoin, and MEXC. Those long-tail venues are routable but do not have the same curated Gordon metadata or venue-specific test coverage as the first-class set.

> [!CAUTION]
> `setSandboxMode(true)` is not a universal paper-trading guarantee across the CCXT long tail. Gordon refuses known unsupported first-class sandbox paths and requires an explicit live choice where it can, but an unknown venue's behavior must be verified by the operator.

Source: [`exchange/types.ts`](../src/infra/exchange/types.ts), [`ccxtCatalog.ts`](../src/infra/exchange/ccxtCatalog.ts), and [`sandboxSupport.ts`](../src/infra/exchange/sandboxSupport.ts).

## Equity and options brokers

| Broker | Coverage | Paper-path status |
|---|---|---|
| <img height="16" align="top" src="../assets/integrations/alpaca.png" alt="" /> Alpaca | US equities, options, and crypto | Explicit paper endpoint |
| <img height="16" align="top" src="../assets/integrations/tastytrade.png" alt="" /> tastytrade | Options, equities, and futures order workflows | Certification environment when configured |
| <img height="16" align="top" src="../assets/integrations/ibkr.png" alt="" /> Interactive Brokers | Global multi-asset execution through the local gateway | The adapter cannot observe whether the connected gateway account is paper or live |

Each broker is held to an inclusion gate and a conformance matrix. The matrix checks the shared adapter contract; it does not erase venue-specific limits. For example, tastytrade historical bars are not wired through Gordon, and IBKR paper versus live status remains outside the adapter's observation boundary.

Source: [`src/infra/broker/`](../src/infra/broker/) and [`inclusion-gate.ts`](../src/infra/broker/quality/inclusion-gate.ts).

## Models

Four first-party families drive the default model catalog:

| Provider | Family | Credential |
|---|---|---|
| <img height="16" align="top" src="../assets/integrations/anthropic.svg" alt="" /> Anthropic | Claude | `ANTHROPIC_API_KEY` |
| <img height="16" align="top" src="../assets/integrations/openai.png" alt="" /> OpenAI | GPT | `OPENAI_API_KEY` |
| <img height="16" align="top" src="../assets/integrations/google-gemini.svg" alt="" /> Google | Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` |
| xAI | Grok | `XAI_API_KEY` |

The catalog also includes direct or gateway access for DeepSeek, Qwen and Alibaba, Kimi and Moonshot, Zhipu GLM, MiniMax, StepFun, Mistral, OpenRouter, Hugging Face, Together, Fireworks, SiliconFlow, and DeepInfra. OpenAI-compatible local hosts such as Ollama and LM Studio can be selected when the operator provides them.

Current role defaults are defined in source, not in this guide. Override one role with:

```bash
export GORDON_MODEL_ORCHESTRATOR="provider:model"
export GORDON_MODEL_EXECUTOR="provider:model"
export GORDON_MODEL_RESEARCHER="provider:model"
```

Or set a global fallback:

```bash
export GORDON_PROVIDER="anthropic"
export GORDON_MODEL="claude-sonnet-4-6"
```

The executor defaults to a first-party tool-calling provider. Research and analysis roles can use the broader catalog. Provider choice does not change Gordon's deterministic risk and permission controls.

## Market and alternative data

| Source | Provides |
|---|---|
| Finnhub | Fundamentals, quotes, and company data |
| SEC and EDGAR | Filings and filing events |
| Yahoo | Stock headlines |
| X | Social and sentiment signals |
| <img height="16" align="top" src="../assets/integrations/nansen.png" alt="" /> Nansen | Wallet intelligence |
| <img height="16" align="top" src="../assets/integrations/arkham.png" alt="" /> Arkham | Wallet intelligence |
| <img height="16" align="top" src="../assets/integrations/birdeye.png" alt="" /> Birdeye | Solana DEX data |
| <img height="16" align="top" src="../assets/integrations/defillama.png" alt="" /> DeFiLlama | TVL and yields |
| <img height="16" align="top" src="../assets/integrations/glassnode.png" alt="" /> Glassnode | Onchain metrics |
| <img height="16" align="top" src="../assets/integrations/dexscreener.png" alt="" /> DexScreener | DEX pairs |
MCP servers can extend the data and tool surface. Gordon does not treat an MCP server as trusted merely because it is configured; permissions, outbound-network controls, and optional subprocess confinement remain separate.

## Editors and hosts

| Editor or host | Protocol |
|---|---|
| <img height="16" align="top" src="../assets/integrations/zed.png" alt="" /> Zed | ACP editor panel |
| <img height="16" align="top" src="../assets/integrations/athas.png" alt="" /> Athas | ACP editor panel |
| <img height="16" align="top" src="../assets/integrations/cursor.png" alt="" /> Cursor | MCP |
| <img height="16" align="top" src="../assets/integrations/warp.png" alt="" /> Warp | MCP |
| <img height="16" align="top" src="../assets/integrations/claude.png" alt="" /> Claude Desktop | MCP |
| <img height="16" align="top" src="../assets/integrations/devin.png" alt="" /> Devin | MCP |

ACP runs as a JSON-RPC server over stdio. MCP exposes Gordon tools to compatible clients. Both are alternate front ends over the same runtime and safety model, not separate trading engines.

## Credential and settings priority

Gordon's merged settings order, from highest to lowest, is:

1. CLI overrides
2. Session overrides
3. Signed organization policy
4. Signed synced settings
5. Local settings at `~/.gordon/settings.local.json`
6. Project settings at `.gordon/settings.json`
7. Profile settings at `~/.gordon/profiles/<name>.json`
8. Built-in defaults

For most `GORDON_*` flags, a process environment value overrides the settings fallback. Safety-critical values in a repository-carried project's `flags` map are ignored, preventing a cloned project from disabling the halt or widening the risk kernel. `/flags` persists operator choices to the trusted local settings file.

Managed policy must be HMAC-signed. If a policy file exists but cannot be verified, Gordon refuses the entire layer instead of applying it or silently lowering its priority.

## Complete configuration reference

Use [`.env.example`](../.env.example) for credential names and advanced overrides. It is the maintained field catalog; this document explains integration shape and trust boundaries rather than duplicating every variable.

## Related guides

- [Getting started](./getting-started.md)
- [Operations](./operations.md)
- [Security and safety](./security/README.md)
