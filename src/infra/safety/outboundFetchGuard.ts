import { createModuleLogger } from "../logger/index.ts";
import {
  enforceOutbound,
  getAllowlistMode,
  isNetworkAllowlistEnabled,
  resultToPayload,
  type AllowlistMode,
} from "./networkAllowlist.ts";

const logger = createModuleLogger("outbound-fetch-guard");

const MAX_RECENT_VIOLATIONS = 20;

let installed = false;
let warnViolations = 0;
const recentViolations: string[] = [];

export interface OutboundFetchGuardStatus {
  installed: boolean;
  enabled: boolean;
  mode: AllowlistMode;
  /** Count of allowlist misses observed in warn mode (logged + allowed). */
  warnViolations: number;
  /** Last-N offending hosts, oldest first. */
  recentViolations: readonly string[];
}

export function isOutboundFetchGuardInstalled(): OutboundFetchGuardStatus {
  return {
    installed,
    enabled: isNetworkAllowlistEnabled(),
    mode: getAllowlistMode(),
    warnViolations,
    recentViolations: [...recentViolations],
  };
}

export function resetOutboundFetchGuardStatsForTesting(): void {
  warnViolations = 0;
  recentViolations.length = 0;
}

function fetchInputToUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

/**
 * Check one outbound URL against the allowlist. Throws `BlockedOutboundError`
 * in block mode; in warn mode logs, records the violation, and returns.
 * Exported as the testable seam — tests exercise this without patching
 * `globalThis.fetch` or making real network calls.
 */
export function guardOutboundUrl(url: string, caller = "global.fetch"): void {
  if (!isNetworkAllowlistEnabled()) return;
  const result = enforceOutbound({ url, caller });
  if (!result.allowed) {
    // Only reachable in warn mode — block mode throws inside enforceOutbound.
    warnViolations += 1;
    recentViolations.push(result.host);
    if (recentViolations.length > MAX_RECENT_VIOLATIONS) recentViolations.shift();
    logger.warn("Outbound URL outside allowlist", resultToPayload(result, caller));
  }
}

export function installOutboundFetchGuard(): void {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    guardOutboundUrl(fetchInputToUrl(input));
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
}
