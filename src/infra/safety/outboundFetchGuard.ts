import { createModuleLogger } from "../logger/index.ts";
import {
  enforceOutbound,
  isNetworkAllowlistEnabled,
  resultToPayload,
} from "./networkAllowlist.ts";

const logger = createModuleLogger("outbound-fetch-guard");

let installed = false;

function fetchInputToUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input);
}

export function installOutboundFetchGuard(): void {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (isNetworkAllowlistEnabled()) {
      const url = fetchInputToUrl(input);
      const result = enforceOutbound({ url, caller: "global.fetch" });
      if (!result.allowed) {
        logger.warn("Outbound URL outside allowlist", resultToPayload(result, "global.fetch"));
      }
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
}

