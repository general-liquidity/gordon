import { describe, expect, it } from "bun:test";

import { __quickStartInternals } from "./QuickStartWizard.tsx";

describe("QuickStartWizard helpers", () => {
  it("maps quickstart providers to the intended default models", () => {
    expect(__quickStartInternals.getQuickStartChoice("openai")).toEqual({
      provider: "openai",
      model: "openai/gpt-5.4",
    });
    expect(__quickStartInternals.getQuickStartChoice("inception")).toEqual({
      provider: "inception",
      model: "inception/mercury-2",
    });
    expect(__quickStartInternals.getQuickStartChoice("dedalus")).toEqual({
      provider: "dedalus",
      model: "openai/gpt-5.2",
    });
  });

  it("infers an existing quickstart choice from env status", () => {
    expect(__quickStartInternals.inferExistingChoice({
      fileExists: true,
      hasLLMKey: false,
      hasInceptionKey: true,
      hasAlpacaKeys: false,
      hasRobinhoodKeys: false,
      hasWebullKeys: false,
      hasBinanceKeys: false,
      hasBinanceUSKeys: false,
      hasCoinbaseKeys: false,
      hasKrakenKeys: false,
      hasBitfinexKeys: false,
      hasHyperliquidKey: false,
      hasTinyfishKey: false,
      hasUniswapKey: false,
      hasGraphKey: false,
      hasStructuredAxiomEnabled: false,
      hasAxiomToken: false,
      hasAxiomHashSalt: false,
      tracingRequested: false,
      tracingReviewed: false,
      hasSolanaKey: false,
      hasHeliusKey: false,
      hasPolkadotKey: false,
      hasChainlinkStreamsKeys: false,
      hasChainlinkCCIPKey: false,
      hasCDPKeys: false,
      hasBasescanKey: false,
      hasSynthDataKey: false,
      hasMoonPayKeys: false,
      hasPolygonX402Key: false,
      keys: {
        GORDON_PROVIDER: "inception",
        GORDON_MODEL: "inception/mercury-2",
      },
    })).toEqual({
      provider: "inception",
      model: "inception/mercury-2",
    });
  });
});
