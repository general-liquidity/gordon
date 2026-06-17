# React Compiler (Gordon TUI) — Phase 5

## Status

**DISABLED BY DEFAULT.** This document describes the plumbing added in Phase 5
of Gordon's custom reconciler work. Activation is intentionally gated behind an
environment variable so the current build path is not disturbed. Turning the
compiler on is a separate, testable step that has not yet happened.

## What is the React Compiler?

The React Compiler (formerly "React Forget") is an optimizing Babel plugin that
analyzes React components and hooks at build time and inserts fine-grained,
per-expression memoization transparently. In practice this means:

- Automatic memoization of component return values.
- Automatic caching of object/array literals and callback closures.
- Reduced need for hand-written `useMemo` / `useCallback` / `React.memo`.

For Gordon's TUI — 280 components rendered inside Ink — the payoff is fewer
redundant re-renders on every keystroke in `useInput`, on every stream-chunk
state update in `ChatView`, and on every tick of live market panels.

## How to enable (when we're ready)

The compiler is wired but off. To enable for a single run:

```
GORDON_REACT_COMPILER=1 bun run build
GORDON_REACT_COMPILER=1 bun run dev
```

When the variable is anything other than exactly `"1"` (including unset, empty,
`"0"`, or `"true"`), the Babel config emits no plugins and the build behaves
identically to before Phase 5.

The wiring lives in `babel.config.cjs` at the repo root:

```
plugins: useReactCompiler
  ? [["babel-plugin-react-compiler", { target: "19" }]]
  : [],
```

## Known risks for Gordon

These are the things to validate before flipping the switch in a real build:

1. **Ink 6.6.0 compatibility is NOT yet verified.** React Compiler is stable
   against stock React 19, but Ink has its own reconciler (`react-reconciler`).
   The compiler's memoization assumptions may interact poorly with Ink's
   commit phase or with our custom reconciler work. Validate with a dev build
   + manual smoke of `ChatView`, live market panels, and `useInput` handlers
   before shipping.

2. **Closure captures in `useInput((input, key) => ...)` callbacks may trigger
   compiler warnings.** The compiler is conservative about functions that
   close over frequently-changing values. The remediation is cheap — wrap the
   callback in `useCallback` with an explicit dependency array. No component
   rewrites required, just a small sweep of `useInput` call sites.

3. **Deprecated React APIs: none found.** A Phase 5 audit of all 280
   components turned up zero uses of APIs the compiler refuses to transform
   (legacy context, `UNSAFE_*` lifecycles, string refs, etc.). This means
   enabling the compiler is not expected to require component changes on
   that axis.

## What was added in Phase 5 (this PR)

- `babel.config.cjs` — gated Babel config at repo root.
- `babel-plugin-react-compiler` and `@babel/core` added to `devDependencies`
  in `package.json`. **Install has not been run** — a human needs to run
  `bun install` to materialize the new entries into `bun.lock` /
  `node_modules`.
- This document.

No component code was modified. No build script was modified. The default
build path is bit-for-bit identical to pre-Phase 5.

## Phase 5 activation TODO (future sprint)

- [x] Run `bun install` to pull in `babel-plugin-react-compiler`.
- [x] Build with `GORDON_REACT_COMPILER=1` and confirm Bun / Babel pipeline
      actually picks up the compiler. Done — Bun does NOT use `babel.config.cjs`
      directly. Instead we install a Bun plugin (see "Activation wiring" below)
      that intercepts `.tsx` files via `Bun.plugin().onLoad()` and runs them
      through Babel + the React Compiler before handing the result back to
      Bun's transpiler with `loader: "jsx"`.
- [ ] Smoke-test the TUI for rendering regressions, especially under Ink's
      commit phase and our custom reconciler.
- [ ] Sweep `useInput` call sites and wrap callbacks in `useCallback` if the
      compiler emits bail-out warnings. (Sweep result: **0 bail-outs across
      282 .tsx files.** No remediation work required.)
- [ ] Benchmark render counts before/after on a representative ChatView
      session to confirm the optimization is actually landing.

## Activation wiring (Phase 5.1)

Bun 1.3 does NOT consult `babel.config.cjs` for its built-in transpiler —
Bun's transpiler is its own implementation, not Babel. To get the React
Compiler into the loop we use Bun's plugin API:

- `bunfig.toml` (new) declares a `preload` entry that runs before any
  application code:

  ```toml
  preload = ["./src/tui/ink-custom/buildCompilerPlugin.ts"]
  [test]
  preload = ["./src/tui/ink-custom/buildCompilerPlugin.ts"]
  ```

- `src/tui/ink-custom/buildCompilerPlugin.ts` (new) is the preload
  module. When `GORDON_REACT_COMPILER=1` is set, it calls
  `Bun.plugin()` to register an `onLoad` hook for `/\.tsx$/`. Each TSX
  file is run through Babel with:
    - `@babel/preset-typescript` (strips TS types, **preserves JSX**),
    - `babel-plugin-react-compiler` with `target: "19"`.
  The output (still containing JSX) is returned to Bun with
  `loader: "jsx"`, which lets Bun's transpiler do the final
  JSX→`jsx()` transform. We deliberately do NOT use
  `@babel/preset-react` — it isn't installed, and routing JSX runtime
  through Bun keeps the React-runtime story in one place.

- When `GORDON_REACT_COMPILER` is unset (or `"0"`, `"true"`, etc.) the
  preload module installs no plugin and Bun's default transpiler
  handles `.tsx` exactly as before. The cost when disabled is one
  env-var read at startup.

### How to activate

```
GORDON_REACT_COMPILER=1 bun run start
GORDON_REACT_COMPILER=1 bun run dev
GORDON_REACT_COMPILER=1 bun test
```

Or use the convenience scripts added to `package.json`:

```
bun run start:compiled
bun run dev:compiled
```

When the compiler is active, Bun prints `[react-compiler] active
(GORDON_REACT_COMPILER=1)` to stderr at startup so it's obvious which
mode the process is running in.

## Phase 5.1 sweep result (2026-04-25)

A full sweep of every `.tsx` file under `src/` was run via
`scripts/dev/sweep-react-compiler.ts`. Each file was passed through the
exact Babel pipeline the Bun plugin uses.

| Status | Count |
|--------|-------|
| Compiled (memoization emitted) | 263 |
| Skipped (no JSX / no components) | 19 |
| **Bail-out warnings** | **0** |
| Total `.tsx` files | 282 |

**Zero bail-outs.** The compiler accepted every component without
flagging a rules-of-hooks violation, conditional hook, ref misuse, or
deprecated API. This is the expected outcome — Phase 5's pre-flight
audit found no use of legacy APIs the compiler refuses to transform —
but it's now confirmed against the live source tree, not just static
analysis.

If future work introduces a violation, run the sweep again to surface
it:

```
bun run scripts/dev/sweep-react-compiler.ts --verbose
```

## Smoke test

A minimal end-to-end Babel-pipeline check lives at
`scripts/dev/checks/smoke-react-compiler.ts`. It compiles a tiny synthetic
component and asserts the output contains `react/compiler-runtime` and
the `_c(...)` cache-hook call the compiler emits. Run with `--force`
or `GORDON_REACT_COMPILER=1` set:

```
bun run scripts/dev/checks/smoke-react-compiler.ts --force
```

Expected output: `[smoke] PASS — React Compiler emitted memoized
output.` followed by the first ~8 lines of the compiled module.

## Bun-specific gotchas hit during Phase 5.1

1. **Bun does not honor `babel.config.cjs` for its native transpiler.**
   The Babel config sitting at the repo root has no effect on Bun's
   default `.tsx` handling. The plugin wiring in
   `buildCompilerPlugin.ts` is what actually activates the compiler.

2. **`@babel/preset-react` is intentionally not used.** Bun's
   transpiler handles the final JSX → `jsx()` transform when we hand
   back content with `loader: "jsx"`. This keeps us off
   `@babel/preset-react` entirely (one fewer devDependency, one fewer
   moving part).

3. **`preset-typescript` must run with `isTSX: true` and
   `allExtensions: true`** so `<Foo />` isn't misparsed as a TypeScript
   cast. Without these flags Babel will throw on most Gordon
   components.

4. **Per-file try/catch around the transform.** If the compiler ever
   fails on a specific file, the plugin logs a warning and returns
   `undefined`, which lets Bun fall back to its default transpiler for
   that single file. The app keeps booting.

5. **Type-only import for `@babel/core`.** `@types/babel__core` isn't
   installed, so the plugin uses a structural type for `transformAsync`
   instead of `typeof import("@babel/core")`. This avoids forcing a
   types dep on the disabled path.
