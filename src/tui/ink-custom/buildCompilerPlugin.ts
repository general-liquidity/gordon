// React Compiler activation for Gordon's TUI.
//
// This file is registered via `bunfig.toml`'s `preload` array. When Bun
// starts (for `bun run`, `bun test`, etc.) it executes this module before
// any application code, giving us a chance to install a Bun plugin that
// intercepts `.tsx` files and runs them through Babel + the React
// Compiler.
//
// Activation is gated behind GORDON_REACT_COMPILER=1. When unset (or set
// to anything other than exactly "1") this module installs no plugin and
// Bun's default transpiler handles `.tsx` exactly as before. The cost
// when disabled is one env-var read + one `Bun.plugin` no-op call at
// startup — negligible.
//
// Strategy:
//   1. Babel parses TSX with @babel/plugin-syntax-jsx + preset-typescript
//      (TypeScript stripped, JSX preserved).
//   2. babel-plugin-react-compiler walks the JSX-bearing AST and inserts
//      memoization.
//   3. We hand the result back to Bun with `loader: "jsx"`. Bun's own
//      transpiler then performs the JSX -> jsx() / createElement
//      transform. This keeps the React-runtime story owned by Bun (no
//      need for @babel/preset-react, which is not installed) and avoids
//      any divergence between Babel-emitted JSX runtime and Bun's.
//
// Important: the React Compiler requires JSX to still be present in the
// AST when it runs — it specifically looks for component-shaped
// functions that return JSX. So preset-typescript MUST be invoked with
// `jsx: "preserve"` (the default for TS preset is to preserve JSX), and
// we MUST NOT include preset-react here.

import type { BunPlugin } from "bun";

const ACTIVE = process.env.GORDON_REACT_COMPILER === "1";

if (ACTIVE) {
  // Lazy-require @babel/core only when activation is requested. This
  // keeps the disabled path zero-cost: no Babel dependency is touched
  // unless the user explicitly opts in. We type the import structurally
  // to avoid a hard dependency on @types/babel__core (not installed).
  type TransformAsync = (
    code: string,
    opts: Record<string, unknown>,
  ) => Promise<{ code?: string | null } | null>;
  const babel = require("@babel/core") as { transformAsync: TransformAsync };
  const transformAsync = babel.transformAsync;

  const reactCompilerPlugin: BunPlugin = {
    name: "gordon-react-compiler",
    setup(build) {
      // Match all `.tsx` files. We deliberately do NOT match `.ts`
      // because the React Compiler only operates on JSX-bearing modules
      // and the cost of running Babel on every `.ts` would be wasted.
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        const source = await Bun.file(args.path).text();

        try {
          const result = await transformAsync(source, {
            configFile: false,
            babelrc: false,
            filename: args.path,
            sourceType: "module",
            // preset-typescript strips TS types but preserves JSX, which
            // is exactly what the React Compiler needs to see.
            presets: [
              ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
            ],
            plugins: [
              ["babel-plugin-react-compiler", { target: "19" }],
            ],
          });

          if (!result?.code) {
            // Babel returned nothing meaningful — fall through to Bun's
            // default transpiler by returning undefined.
            return undefined;
          }

          // Hand the still-JSX-bearing output back to Bun. The "jsx"
          // loader tells Bun to perform the final JSX -> jsx() call
          // transform using its own, fast, automatic-runtime aware
          // transpiler. This is the seam where we let Bun own the
          // React runtime details rather than @babel/preset-react.
          return { contents: result.code, loader: "jsx" };
        } catch (err) {
          // If Babel or the compiler throws on a specific file, log and
          // fall back to Bun's default transpiler so the app still
          // boots. The compiler is allowed to bail out per-component.
          // eslint-disable-next-line no-console
          console.warn(
            `[react-compiler] skipped ${args.path}: ${(err as Error).message}`,
          );
          return undefined;
        }
      });
    },
  };

  Bun.plugin(reactCompilerPlugin);

  // Surface a clear startup signal so the user knows the compiler is
  // actually active. Stays on stderr so it never pollutes piped stdout.
  // eslint-disable-next-line no-console
  console.error("[react-compiler] active (GORDON_REACT_COMPILER=1)");
}
