#!/usr/bin/env bun

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const globalWithRequire = globalThis as typeof globalThis & { require?: typeof require };

if (typeof globalWithRequire.require !== "function") {
  Object.defineProperty(globalWithRequire, "require", {
    value: require,
    configurable: true,
    writable: false,
  });
}

// Opt-in fetch tracing: set GORDON_VERBOSE_FETCH=1 (or =curl) to have Bun
// log every fetch() and node:http request as either a copy-pasteable curl
// command (=curl) or a structured request/response line (=1). Used in
// triage when a user reports an exchange API problem — they paste the
// generated curl and we can reproduce against the same endpoint.
// Reference: bun.com/docs/runtime/debugger#debugging-network-requests
{
  const verbose = process.env.GORDON_VERBOSE_FETCH;
  if (verbose && !process.env.BUN_CONFIG_VERBOSE_FETCH) {
    process.env.BUN_CONFIG_VERBOSE_FETCH = verbose === "1" ? "true" : verbose;
  }
}

await import("./index.tsx");
