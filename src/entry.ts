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

await import("./index.tsx");
