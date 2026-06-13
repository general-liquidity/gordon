/**
 * Deribit options-chain provider (v2 public REST, read-only, no auth).
 *
 * Deribit is the dominant venue for BTC/ETH options, so it serves as the chain
 * feed for dealer GEX/vanna/charm. Two public endpoints are joined by
 * `instrument_name`:
 *
 *   GET /public/get_instruments?currency={BTC|ETH}&kind=option&expired=false
 *     → static per-instrument: instrument_name, strike, option_type,
 *       expiration_timestamp (ms epoch).
 *   GET /public/get_book_summary_by_currency?currency={BTC|ETH}&kind=option
 *     → live per-instrument: open_interest, mark_iv (a PERCENT, e.g. 55.2),
 *       underlying_price.
 *
 * Each joined instrument maps to an `OptionContract` (the exact shape
 * `computeDealerGreeksExposure` consumes):
 *   strike       = instrument.strike
 *   timeYears    = (expiration_timestamp − now) / (365.25·24·3600·1000)
 *   openInterest = summary.open_interest
 *   optionType   = instrument.option_type  ("call" | "put")
 *   iv           = summary.mark_iv / 100    (percent → fraction)
 * `spotUsd` is the MEDIAN `underlying_price` across the chain (robust to a few
 * stale/odd rows; Deribit reports it per book-summary row).
 *
 * Rows are skipped when expired (timeYears ≤ 0), zero/negative OI, or any mapped
 * field is non-finite. Read-only data: never an order path.
 */

import type {
  OptionContract,
  OptionsChainCapabilities,
  OptionsChainProvider,
  OptionsChainSnapshot,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("deribit-options");

const BASE = "https://www.deribit.com/api/v2";
const TIMEOUT_MS = 10_000;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Deribit lists options for these currencies. */
const SUPPORTED = ["BTC", "ETH"];

interface DeribitInstrument {
  instrument_name?: string;
  strike?: number;
  option_type?: string;
  expiration_timestamp?: number;
}

interface DeribitBookSummary {
  instrument_name?: string;
  open_interest?: number;
  mark_iv?: number;
  underlying_price?: number;
}

interface DeribitEnvelope<T> {
  result?: T;
}

/** Median of a numeric array (0 for empty). Robust spot estimate across rows. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export class DeribitOptionsProvider implements OptionsChainProvider {
  readonly id = "deribit";
  readonly name = "Deribit";
  readonly priority = 10;
  readonly requiresAuth = false;

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.fetchImpl === "function";
  }

  getCapabilities(): OptionsChainCapabilities {
    return { currencies: [...SUPPORTED] };
  }

  async getChain(currency: string): Promise<OptionsChainSnapshot> {
    const cur = currency.toUpperCase();
    if (!SUPPORTED.includes(cur)) {
      throw new Error(`Deribit does not list options for "${currency}"`);
    }

    const [instruments, summaries] = await Promise.all([
      this.get<DeribitInstrument[]>(
        `/public/get_instruments?currency=${cur}&kind=option&expired=false`,
      ),
      this.get<DeribitBookSummary[]>(
        `/public/get_book_summary_by_currency?currency=${cur}&kind=option`,
      ),
    ]);

    const now = Date.now();

    // Join: book-summary row by instrument_name → static instrument metadata.
    const summaryByName = new Map<string, DeribitBookSummary>();
    for (const s of summaries) {
      if (typeof s.instrument_name === "string") summaryByName.set(s.instrument_name, s);
    }

    const contracts: OptionContract[] = [];
    const spotSamples: number[] = [];

    for (const inst of instruments) {
      const name = inst.instrument_name;
      if (typeof name !== "string") continue;
      const summary = summaryByName.get(name);
      if (!summary) continue;

      const optionType = inst.option_type;
      if (optionType !== "call" && optionType !== "put") continue;

      const strike = inst.strike;
      const expiry = inst.expiration_timestamp;
      const openInterest = summary.open_interest;
      const markIv = summary.mark_iv;

      if (
        typeof strike !== "number" ||
        typeof expiry !== "number" ||
        typeof openInterest !== "number" ||
        typeof markIv !== "number"
      ) {
        continue;
      }

      const timeYears = (expiry - now) / MS_PER_YEAR;
      const iv = markIv / 100;

      // Skip expired, empty-OI, and any non-finite mapped field.
      if (timeYears <= 0 || openInterest <= 0) continue;
      if (!Number.isFinite(strike) || !Number.isFinite(timeYears) || !Number.isFinite(iv)) {
        continue;
      }

      contracts.push({ strike, timeYears, openInterest, optionType, iv });

      if (typeof summary.underlying_price === "number" && Number.isFinite(summary.underlying_price)) {
        spotSamples.push(summary.underlying_price);
      }
    }

    const spotUsd = median(spotSamples);

    logger.debug("Deribit chain fetched", {
      currency: cur,
      instruments: String(instruments.length),
      summaries: String(summaries.length),
      contracts: String(contracts.length),
      spotUsd: spotUsd.toFixed(2),
    });

    return { underlying: cur, spotUsd, fetchedAt: now, contracts };
  }

  /** GET a Deribit JSON-RPC-over-REST endpoint and unwrap its `result`. */
  private async get<T>(path: string): Promise<T> {
    const url = `${BASE}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Deribit HTTP ${res.status} for ${path}`);
      }
      const body = (await res.json()) as DeribitEnvelope<T>;
      const result = body.result;
      if (result === undefined) {
        throw new Error(`Deribit response missing result for ${path}`);
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
