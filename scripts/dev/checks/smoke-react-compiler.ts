#!/usr/bin/env bun
/**
 * Smoke test: confirms the React Compiler Bun plugin is wired up
 * correctly. Runs a tiny TSX snippet through the same Babel pipeline
 * the Bun plugin uses and asserts the compiler emits its
 * fingerprint (a `react.memo_cache_sentinel` import) into the output.
 *
 *   GORDON_REACT_COMPILER=1 bun scripts/dev/checks/smoke-react-compiler.ts  → PASS
 *   GORDON_REACT_COMPILER=0 bun scripts/dev/checks/smoke-react-compiler.ts  → SKIP
 */

const ACTIVE =
  process.env.GORDON_REACT_COMPILER === "1" ||
  process.argv.includes("--force");

if (!ACTIVE) {
  // eslint-disable-next-line no-console
  console.log(
    "[smoke] GORDON_REACT_COMPILER not set — skipping (pass --force to run anyway).",
  );
  process.exit(0);
}

const { transformAsync } = require("@babel/core") as {
  transformAsync: (code: string, opts: Record<string, unknown>) => Promise<{ code?: string | null } | null>;
};

const SOURCE = `
import React from "react";

export function Counter({ value }: { value: number }) {
  const items = [1, 2, 3, value];
  const cb = (n: number) => n * 2;
  return <div>{items.map(cb).join(",")}</div>;
}
`;

const result = await transformAsync(SOURCE, {
  configFile: false,
  babelrc: false,
  filename: "Counter.tsx",
  sourceType: "module",
  presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
  plugins: [["babel-plugin-react-compiler", { target: "19" }]],
});

const code = result?.code ?? "";

const hasMemoCache =
  code.includes("react/compiler-runtime") ||
  code.includes("useMemoCache") ||
  code.includes("c(") /* compiled cache hook call */;

if (!hasMemoCache) {
  // eslint-disable-next-line no-console
  console.error("[smoke] FAIL — compiler did not emit memoization output:");
  // eslint-disable-next-line no-console
  console.error(code);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log("[smoke] PASS — React Compiler emitted memoized output.");
// eslint-disable-next-line no-console
console.log(code.split("\n").slice(0, 8).join("\n"));
