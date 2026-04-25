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

// Install the Dedalus max_tokens guard before any LLM module loads —
// it patches global fetch so Mastra-internal routing-agent calls can't
// blow the non-streaming threshold and 400 the user.
const { installDedalusMaxTokensGuard } = await import("./infra/runtime/dedalusMaxTokensGuard.ts");
installDedalusMaxTokensGuard();

await import("./index.tsx");
