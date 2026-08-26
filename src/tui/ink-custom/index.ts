// Gordon's stable TUI surface. Application components import this facade. The
// render entry selects vanilla Ink by default or Gordon's owned cell pipeline
// under an explicit opt-in; components and hooks below are Gordon-owned ports
// that work with either context adapter.

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

export type { MouseEvent, MouseHandler } from "./hooks/use-mouse.ts";
export { default as useMouse } from "./hooks/use-mouse.ts";

export { default as useApp } from "./hooks/use-app.ts";
export type { SuspendTerminal, TerminalSuspension } from "./suspendTerminal.ts";

export { default as useStdout } from "./hooks/use-stdout.ts";

export { default as measureElement } from "./measure-element.ts";

export type { DOMElement } from "./dom.ts";
