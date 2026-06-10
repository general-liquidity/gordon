/**
 * Shadow Close Worker (GORDON_SHADOW_MODE).
 *
 * Polls open ghost fills from `shadowMode.ts` and resolves them via
 * stop / target / max-hold timeout using live market prices.
 *
 * Registered as a proactive-observer tick (`tick_shadow_close`) when
 * shadow mode is enabled. Observation-only — does not block execution.
 */

import { createPublicExchange } from "../../exchange/publicFactory.ts";
import {
  isShadowModeEnabled,
  readShadowFills,
  recordShadowClose,
  type ShadowFill,
} from "./shadowMode.ts";

export const SHADOW_MAX_HOLD_MS_ENV = "GORDON_SHADOW_MAX_HOLD_MS";
export const DEFAULT_SHADOW_MAX_HOLD_MS = 24 * 60 * 60 * 1000;

export type PriceFetcher = (symbol: string) => Promise<number | null>;

export interface ShadowCloseResolution {
  shouldClose: boolean;
  closeReason?: string;
  exitPrice?: number;
}

export interface ShadowCloseTickOptions {
  priceFetcher?: PriceFetcher;
  path?: string;
  maxHoldMs?: number;
  now?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ShadowCloseTickResult {
  checked: number;
  closed: number;
  skippedNoPrice: number;
  closeReasons: string[];
}

export function defaultShadowMaxHoldMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[SHADOW_MAX_HOLD_MS_ENV];
  if (!raw) return DEFAULT_SHADOW_MAX_HOLD_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SHADOW_MAX_HOLD_MS;
}

/**
 * Determine whether an open fill should close at the given market price.
 */
export function resolveShadowFill(
  fill: ShadowFill,
  price: number,
  now: number,
  maxHoldMs: number,
): ShadowCloseResolution {
  if (fill.side === "long") {
    if (fill.stopLoss !== null && price <= fill.stopLoss) {
      return { shouldClose: true, closeReason: "stop", exitPrice: fill.stopLoss };
    }
    if (fill.takeProfit !== null && price >= fill.takeProfit) {
      return { shouldClose: true, closeReason: "target", exitPrice: fill.takeProfit };
    }
  } else {
    if (fill.stopLoss !== null && price >= fill.stopLoss) {
      return { shouldClose: true, closeReason: "stop", exitPrice: fill.stopLoss };
    }
    if (fill.takeProfit !== null && price <= fill.takeProfit) {
      return { shouldClose: true, closeReason: "target", exitPrice: fill.takeProfit };
    }
  }

  if (now - fill.openedAt >= maxHoldMs) {
    return { shouldClose: true, closeReason: "time", exitPrice: price };
  }

  return { shouldClose: false };
}

/**
 * Best-effort public price fetch for shadow reconciliation.
 */
export async function defaultShadowPriceFetcher(symbol: string): Promise<number | null> {
  try {
    const exchange = createPublicExchange("binance");
    const price = await exchange.getPrice(symbol);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * One reconciliation pass over all open shadow fills.
 */
export async function tickShadowCloseWorker(
  opts: ShadowCloseTickOptions = {},
): Promise<ShadowCloseTickResult> {
  const env = opts.env ?? process.env;
  if (!isShadowModeEnabled(env)) {
    return { checked: 0, closed: 0, skippedNoPrice: 0, closeReasons: [] };
  }

  const now = opts.now ?? Date.now();
  const maxHoldMs = opts.maxHoldMs ?? defaultShadowMaxHoldMs(env);
  const fetchPrice = opts.priceFetcher ?? defaultShadowPriceFetcher;
  const path = opts.path;
  const openFills = readShadowFills({ status: "open" }, path);

  const result: ShadowCloseTickResult = {
    checked: openFills.length,
    closed: 0,
    skippedNoPrice: 0,
    closeReasons: [],
  };

  for (const fill of openFills) {
    const price = await fetchPrice(fill.symbol);
    if (price === null) {
      result.skippedNoPrice += 1;
      continue;
    }

    const resolution = resolveShadowFill(fill, price, now, maxHoldMs);
    if (!resolution.shouldClose || resolution.exitPrice === undefined || !resolution.closeReason) {
      continue;
    }

    recordShadowClose(
      {
        planId: fill.planId,
        exitPrice: resolution.exitPrice,
        closeReason: resolution.closeReason,
        now,
      },
      path,
    );
    result.closed += 1;
    result.closeReasons.push(`${fill.planId}:${resolution.closeReason}`);
  }

  return result;
}