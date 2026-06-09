# Syphonix Integration Runbook (execute on June 15, after the API spec lands)

The Syphonix adapter is the **one gating item** for the competition and is *blocked on the API spec* (released at the kickoff, 15 June). It is deliberately **not pre-built** — `rest-base.ts` is endpoint-path-driven, and stubbing unknown paths/auth/order-shape would only be rewritten. This runbook makes June 15 mechanical instead of exploratory.

## Pre-confirmed (done now, zero rework)

- **Adapter pattern is ready.** New venues are config objects over `src/infra/broker/adapters/rest-base.ts` (`RestBrokerAdapterConfig`: `authStyle`, base URLs, and path arrays for account/clock/positions/orders/quotes) + registration in `src/infra/broker/factory.ts` (`SUPPORTED_BROKERS` + `BrokerId`).
- **Paper trading is first-class** (`brokerPaperSupport.ts`) — matches the competition's paper sim.
- **Competition runner has the slot:** `buildCompetitionRunConfig({ venue: "syphonix" })` (`core/pipeline/competition-runner.ts`).
- **No MT5 path needed** — we trade via the **API** (correct for an agent).

## Step-by-step (June 15)

1. **Read the spec + run the Syphonix system demo** at the kickoff. Capture: base URL(s), auth style (bearer/key/OAuth), order endpoint + body shape, positions/account/equity endpoints, the **market-data feed** for FX/metals/crypto (REST snapshot and/or WS), rate limits, and the **instrument catalog** endpoint.
2. **Add the venue id:** extend `BrokerId` (`broker/types.ts`) with `"syphonix"`; add to `SUPPORTED_BROKERS` in `factory.ts`; import + instantiate in `BrokerFactory.create`.
3. **Author `adapters/syphonix.ts`** as a `RestBrokerAdapter` config (or a thin custom adapter if FX/metals/crypto don't fit the stock-broker shape — confirm against the spec). Implement against the `BrokerAdapter` contract: `getAccount` (equity), `getPositions`, `placeOrder`, `cancelOrder`, `listOrders`, `getQuote`/historical bars. Reuse `clientOrderId` idempotency (already in the execution algos).
4. **Map the instrument catalog → asset classes** (`fx | metals | crypto`) at runtime — **do not hardcode symbol lists** (FX = ISO-4217 pairs, metals = XAU/XAG are structural; crypto bases come from the catalog).
5. **Wire market data** into Gordon's data layer so `compute_indicator` / `compute_regime` / `compute_risk` consume the Syphonix feed. WS for live, REST snapshot fallback on disconnect.
6. **Config/env:** `GORDON_SYPHONIX_API_KEY`, `GORDON_SYPHONIX_BASE_URL`, paper flag (default paper).
7. **Smoke test:** auth → fetch account equity → fetch a quote on an FX pair + XAU + a crypto base → place + cancel a tiny paper order → confirm `clientOrderId` round-trips → run `compute_indicator` (incl. `tsi`) + `compute_regime` + `compute_risk` on each asset class.
8. **Point the loop at it:** `buildCompetitionRunConfig({ venue: "syphonix", startingEquity: 1_000_000 })` → autonomous loop with the competition risk preset.

## Definition of done (June 15)

`tsc` clean · auth + account + quote + place/cancel verified on FX/metals/crypto · `clientOrderId` idempotency confirmed · indicators/regime/risk run on all three asset classes · daily-loss-kill and exposure-cap fire correctly through `sizeCompetitionOrder`.
