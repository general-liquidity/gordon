import { createRequire } from "node:module";
import { assertRuntimeEnvProvenance } from "./infra/storage/config/runtimeEnvProvenance.ts";
import { GORDON_VERSION } from "./version.ts";

// This runs before index.tsx installs guards or reads a single GORDON_* value.
// It is defense in depth for dotenv provenance. Raw Bun source invocation is
// unsupported because Bun can execute a cwd bunfig preload before this module;
// supported launches enter through bin/gordon.cjs or the compiled executable.
assertRuntimeEnvProvenance();

// Keep the version probe on the trusted, minimal startup path. Release
// rehearsal executes the compiled host artifact here, so a stale build-time
// version fails before the TUI's dependency graph can obscure the result.
if (process.argv.includes("--version")) {
  console.log(`gordon v${GORDON_VERSION}`);
  process.exit(0);
}

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
