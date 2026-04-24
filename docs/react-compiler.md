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

- [ ] Run `bun install` to pull in `babel-plugin-react-compiler`.
- [ ] Build with `GORDON_REACT_COMPILER=1` and confirm Bun / Babel pipeline
      actually picks up `babel.config.cjs` (Bun's default transpiler may need
      to be told to defer to Babel for `.tsx` files).
- [ ] Smoke-test the TUI for rendering regressions, especially under Ink's
      commit phase and our custom reconciler.
- [ ] Sweep `useInput` call sites and wrap callbacks in `useCallback` if the
      compiler emits bail-out warnings.
- [ ] Benchmark render counts before/after on a representative ChatView
      session to confirm the optimization is actually landing.
