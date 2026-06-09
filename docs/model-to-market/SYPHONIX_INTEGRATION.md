# Syphonix Integration Runbook (execute on June 15, after the API spec lands)

The Syphonix adapter is the **one gating item** for the competition and the wire-level HTTP is *blocked on the API spec* (released at the kickoff, 15 June). The non-speculative parts are now **built as a gated-off scaffold** (commit f4e45cdd); this runbook makes June 15 mechanical.

## Scaffold already in place (done now, zero rework)

- **`adapters/syphonix.ts`** — `SyphonixAdapter implements BrokerAdapter`, FX/metals/crypto+leverage+paper capabilities, env/cred config, `clientOrderId` idempotency. Live methods throw a clear spec-pending error (not silent stubs).
- **Registered everywhere the type system requires:** `BrokerId` + `BrokerTypeSchema` + factory `switch` case + all `Record<BrokerId>` sites (env map `GORDON_SYPHONIX_*`, paper-support, setup instructions, mock).
- **Inclusion gate entry = `approved:false`** (`documentedExecutionEndpoints:false`) → the gate blocks live use until the spec is wired.
- **Deliberately NOT in `SUPPORTED_BROKERS`** → `BrokerFactory.create("syphonix")` throws until June 15 (preserves "everything creatable passes the gate").
- **Competition runner slot:** `buildCompetitionRunConfig({ venue: "syphonix" })`.
- **No MT5 path** — we trade via the **API**.

## DECISION 0 (settle first, June 15): BrokerAdapter vs Exchange

Gordon has **two venue abstractions** — `BrokerAdapter` (equity, retail-B2C-stock-broker-shaped: `rest-base.ts` + the inclusion gate's retail criteria) and `Exchange` (`src/infra/exchange/adapters/`: binance/coinbase/kraken/okx/hyperliquid — crypto, leverage/perps). Syphonix does FX + metals + **crypto with leverage**. The scaffold implements `BrokerAdapter` because account/positions/orders maps cleanly — **but if the spec exposes an order-book / leverage / perps surface, re-home it to the `Exchange` interface.** It's gated-off + untested, so moving it is cheap. Make this call against the actual API before wiring endpoints.

## Step-by-step (June 15)

1. **Read the spec + run the Syphonix system demo** at the kickoff. Capture: base URL(s), auth style (bearer/key/OAuth), order endpoint + body shape, positions/account/equity endpoints, the **market-data feed** for FX/metals/crypto (REST snapshot and/or WS), rate limits, and the **instrument catalog** endpoint.
2. **Activate the venue:** `BrokerId` / `BrokerTypeSchema` / factory case already exist — just add `"syphonix"` to `SUPPORTED_BROKERS` in `factory.ts` and flip the inclusion-gate entry to `approved:true` + `documentedExecutionEndpoints:true` (`retailB2COnboarding` too if treating it via the broker path).
3. **Fill `adapters/syphonix.ts`** — replace the `pending()` throws with real calls: `getAccount` (equity), `getPositions`, `placeOrder` (attach `nextClientOrderId()` for idempotency — helper already present), `cancelOrder`, `listOrders`, `getLatestQuote`, `getHistoricalBars`. (Or move to the `Exchange` interface per DECISION 0.)
4. **Map the instrument catalog → asset classes** (`fx | metals | crypto`) at runtime — **do not hardcode symbol lists** (FX = ISO-4217 pairs, metals = XAU/XAG are structural; crypto bases come from the catalog).
5. **Wire market data** into Gordon's data layer so `compute_indicator` / `compute_regime` / `compute_risk` consume the Syphonix feed. WS for live, REST snapshot fallback on disconnect.
6. **Config/env:** `GORDON_SYPHONIX_API_KEY`, `GORDON_SYPHONIX_BASE_URL`, paper flag (default paper).
7. **Smoke test:** auth → fetch account equity → fetch a quote on an FX pair + XAU + a crypto base → place + cancel a tiny paper order → confirm `clientOrderId` round-trips → run `compute_indicator` (incl. `tsi`) + `compute_regime` + `compute_risk` on each asset class.
8. **Point the loop at it:** `buildCompetitionRunConfig({ venue: "syphonix", startingEquity: 1_000_000 })` → autonomous loop with the competition risk preset.

## Definition of done (June 15)

`tsc` clean · auth + account + quote + place/cancel verified on FX/metals/crypto · `clientOrderId` idempotency confirmed · indicators/regime/risk run on all three asset classes · daily-loss-kill and exposure-cap fire correctly through `sizeCompetitionOrder`.
