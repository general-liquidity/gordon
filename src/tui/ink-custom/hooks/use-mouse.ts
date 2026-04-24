// useMouse — subscribe to SGR mouse events on the App's internal emitter.
//
// Mirrors the structure of `useInput` but listens on a separate `mouse`
// channel. App's `dispatchChunk` peels SGR-encoded mouse sequences off
// the raw stdin chunk and emits them here, so we never have to share the
// channel with keypress data.
//
// Re-render safety: the handler is captured in a ref and the subscribe
// effect runs once (empty deps + stable emitter ref from context). We do
// NOT include `handler` in the effect's dep array — every render that
// passes an inline arrow function would otherwise re-subscribe.

import { useEffect, useRef } from "react";
import useStdin from "./use-stdin.ts";
import type { MouseEvent } from "../parse-mouse.ts";

export type { MouseEvent } from "../parse-mouse.ts";

export type MouseHandler = (event: MouseEvent) => void;

interface UseMouseOptions {
  readonly isActive?: boolean;
}

/**
 * Subscribe to mouse events. The hook attaches one listener per active
 * mount; the listener calls the latest `handler` via a ref, so callers
 * can pass inline arrow functions without re-subscribing.
 *
 * @param handler Called for every parsed mouse event while active.
 * @param options.isActive If false, no listener is attached.
 */
const useMouse = (handler: MouseHandler, options: UseMouseOptions = {}): void => {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { internal_eventEmitter } = useStdin();
  const handlerRef = useRef<MouseHandler>(handler);
  // Keep the ref pointed at the latest handler — synchronously, via an
  // assignment in the render body. This is safe (it's a ref, not setState)
  // and avoids a useEffect race where the first event after a render
  // could see a stale handler.
  handlerRef.current = handler;

  const { isActive = true } = options;

  useEffect(() => {
    if (!isActive) return;
    if (!internal_eventEmitter) return;
    const listener = (event: MouseEvent): void => {
      handlerRef.current(event);
    };
    internal_eventEmitter.on("mouse", listener);
    return () => {
      internal_eventEmitter.removeListener("mouse", listener);
    };
    // Deps are primitives + stable emitter ref from context — no object
    // literals, no re-subscribe loops.
  }, [isActive, internal_eventEmitter]);
};

export default useMouse;
