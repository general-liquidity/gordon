// ink-custom — Phase 0 public API.
//
// This file is a re-export facade that mirrors `ink/build/index.d.ts` exactly
// for the subset of Ink's surface that Gordon uses. Runtime behavior is
// provided by the upstream `ink` package for now; subsequent phases replace
// each named export with an in-tree implementation.
//
// DO NOT IMPORT FROM THIS FILE YET. Gordon's components still import from
// "ink" directly. This module exists so Phase 1+ has a stable target that
// preserves the public API while the internals are rewritten.

export type { RenderOptions, Instance } from "./render.ts";
export { render } from "./render.ts";

export type { Props as BoxProps } from "./components/Box.ts";
export { default as Box } from "./components/Box.ts";

export type { Props as TextProps } from "./components/Text.ts";
export { default as Text } from "./components/Text.ts";

export type { Props as StaticProps } from "./components/Static.ts";
export { default as Static } from "./components/Static.ts";

export { default as Spacer } from "./components/Spacer.ts";

export type { Key } from "./hooks/use-input.ts";
export { default as useInput } from "./hooks/use-input.ts";

export { default as useApp } from "./hooks/use-app.ts";

export { default as useStdout } from "./hooks/use-stdout.ts";

export { default as measureElement } from "./measure-element.ts";

export type { DOMElement } from "./dom.ts";
