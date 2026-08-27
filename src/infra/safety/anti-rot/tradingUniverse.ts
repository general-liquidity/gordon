/**
 * Trading universe scope sentinel (GORDON_TRADING_UNIVERSE).
 *
 * Anti-scope-creep guard: holds the trader's declared trade-able
 * universe (symbols, asset classes, venues). When enabled, execute_plan
 * refuses any instrument outside the declared universe. Translation of
 * the "velocity illusion widens scope" tenet from k10s.dev's artifact-
 * rot post — Gordon's speed makes it cheap to drift from "I trade
 * BTC/ETH" to "I trade 50 tokens across 4 venues" without noticing.
 *
 * Persistence: ~/.gordon/trading-universe.json (override via
 * GORDON_TRADING_UNIVERSE_PATH).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { flagEnv } from "../../config/flagResolver.ts";

export interface TradingUniverse {
  /** Allowed symbols (case-insensitive, stored upper). Empty = unrestricted on this axis. */
  symbols: string[];
  /** Allowed asset classes (lower-cased, e.g. "crypto", "us_equity"). Empty = unrestricted. */
  assetClasses: string[];
  /** Allowed venues (lower-cased). Empty = unrestricted. */
  venues: string[];
  /** Last declared. */
  declaredAt: string;
  /** Trader's note on why this universe. */
  note?: string;
}

export const EMPTY_UNIVERSE: TradingUniverse = {
  symbols: [],
  assetClasses: [],
  venues: [],
  declaredAt: new Date(0).toISOString(),
};

let cachedUniverse: TradingUniverse | null = null;

export function isUniverseEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return env.GORDON_TRADING_UNIVERSE === "1" || env.GORDON_TRADING_UNIVERSE === "true";
}

export function defaultUniversePath(): string {
  const fromEnv = process.env.GORDON_TRADING_UNIVERSE_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "trading-universe.json");
}

export function loadUniverse(path: string = defaultUniversePath()): TradingUniverse {
  if (cachedUniverse) return cachedUniverse;
  if (!existsSync(path)) return EMPTY_UNIVERSE;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<TradingUniverse>;
    const u: TradingUniverse = {
      symbols: (raw.symbols ?? []).map((s) => s.toUpperCase()),
      assetClasses: (raw.assetClasses ?? []).map((s) => s.toLowerCase()),
      venues: (raw.venues ?? []).map((s) => s.toLowerCase()),
      declaredAt: raw.declaredAt ?? new Date().toISOString(),
      note: raw.note,
    };
    cachedUniverse = u;
    return u;
  } catch {
    return EMPTY_UNIVERSE;
  }
}

export function saveUniverse(
  u: TradingUniverse,
  path: string = defaultUniversePath(),
): TradingUniverse {
  const normalized: TradingUniverse = {
    symbols: u.symbols.map((s) => s.toUpperCase()),
    assetClasses: u.assetClasses.map((s) => s.toLowerCase()),
    venues: u.venues.map((s) => s.toLowerCase()),
    declaredAt: u.declaredAt || new Date().toISOString(),
    note: u.note,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(normalized, null, 2), "utf8");
  cachedUniverse = normalized;
  return normalized;
}

export function _resetUniverseCacheForTest(): void {
  cachedUniverse = null;
}

export interface UniverseCheckInput {
  symbol: string;
  assetClass?: string;
  venue?: string;
}

export interface UniverseCheckResult {
  allowed: boolean;
  matchedOn: ("symbol" | "asset_class" | "venue")[];
  violations: string[];
  reason?: string;
}

export function checkUniverse(
  input: UniverseCheckInput,
  env: NodeJS.ProcessEnv = flagEnv(),
  universe: TradingUniverse = loadUniverse(),
): UniverseCheckResult {
  if (!isUniverseEnabled(env)) {
    return { allowed: true, matchedOn: [], violations: [] };
  }

  const noRestrictions =
    universe.symbols.length === 0 &&
    universe.assetClasses.length === 0 &&
    universe.venues.length === 0;
  if (noRestrictions) {
    return {
      allowed: true,
      matchedOn: [],
      violations: [],
      reason:
        "Trading universe is enabled but empty — no restrictions in effect. Declare your universe via set_trading_universe.",
    };
  }

  const symbol = input.symbol.toUpperCase();
  const assetClass = input.assetClass?.toLowerCase();
  const venue = input.venue?.toLowerCase();

  const matchedOn: UniverseCheckResult["matchedOn"] = [];
  const violations: string[] = [];

  if (universe.symbols.length > 0) {
    if (universe.symbols.includes(symbol)) {
      matchedOn.push("symbol");
    } else {
      violations.push(
        `symbol '${symbol}' not in declared universe [${universe.symbols.join(", ")}]`,
      );
    }
  }

  if (universe.assetClasses.length > 0 && assetClass) {
    if (universe.assetClasses.includes(assetClass)) {
      matchedOn.push("asset_class");
    } else {
      violations.push(
        `asset_class '${assetClass}' not in declared universe [${universe.assetClasses.join(", ")}]`,
      );
    }
  }

  if (universe.venues.length > 0 && venue) {
    if (universe.venues.includes(venue)) {
      matchedOn.push("venue");
    } else {
      violations.push(`venue '${venue}' not in declared universe [${universe.venues.join(", ")}]`);
    }
  }

  if (violations.length === 0) {
    return { allowed: true, matchedOn, violations: [] };
  }

  return {
    allowed: false,
    matchedOn,
    violations,
    reason:
      `Plan instrument outside the trader's declared trading universe. ` +
      `Violations: ${violations.join("; ")}. ` +
      `Anti-scope-creep guard: if this should be tradeable, the trader must explicitly update the universe via set_trading_universe.`,
  };
}
