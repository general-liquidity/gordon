/**
 * The multi-event subscription hook must key its effect on the CONTENTS of the
 * event-type list, not on the array's identity. Every caller passes an inline
 * array literal, so an identity dependency re-subscribes on each render and
 * loses any event fired between the unsubscribe and the re-register.
 */

import { describe, it, expect } from "bun:test";
import React from "react";
import { EventBus, setEventBus } from "../../events/bus.ts";
import type { EventType } from "../../events/index.ts";
import { useEventBusSubscriptions } from "./useEventBusSubscription.ts";

interface BusStats {
  onCalls: number;
  unsubscribeCalls: number;
}

/** A real EventBus whose `on` is wrapped so subscribe/unsubscribe are counted. */
function makeCountingBus(): { bus: EventBus; stats: BusStats } {
  const bus = new EventBus();
  const stats: BusStats = { onCalls: 0, unsubscribeCalls: 0 };
  const originalOn = bus.on.bind(bus) as EventBus["on"];
  bus.on = ((eventType, handler, options) => {
    stats.onCalls++;
    const off = originalOn(eventType, handler, options);
    return () => {
      stats.unsubscribeCalls++;
      off();
    };
  }) as EventBus["on"];
  return { bus, stats };
}

/**
 * Minimal render driver: implements the useRef / useEffect subset the hook
 * uses, including dependency comparison and cleanup, so the hook can run
 * without a renderer (no react-test-renderer / ink-testing-library here).
 */
function createEffectDriver(render: () => void) {
  const refs: { current: unknown }[] = [];
  const effects: { deps: unknown[] | undefined; cleanup: (() => void) | undefined }[] = [];
  let refIdx = 0;
  let effectIdx = 0;
  const pending: Array<() => void> = [];

  const dispatcher = {
    useRef<R>(initial: R): { current: R } {
      const i = refIdx++;
      if (refs.length <= i) refs[i] = { current: initial };
      return refs[i] as { current: R };
    },
    useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void {
      const i = effectIdx++;
      const prev = effects[i];
      const unchanged =
        prev !== undefined &&
        prev.deps !== undefined &&
        deps !== undefined &&
        prev.deps.length === deps.length &&
        prev.deps.every((d, k) => Object.is(d, deps[k]));
      if (unchanged) return;
      pending.push(() => {
        prev?.cleanup?.();
        const cleanup = fn();
        effects[i] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      });
      if (prev === undefined) effects[i] = { deps, cleanup: undefined };
    },
  };

  return function rerender(): void {
    refIdx = 0;
    effectIdx = 0;
    const internals = React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
        ReactCurrentDispatcher?: { current: unknown };
      };
    };
    const modern = internals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const legacy =
      internals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher;
    const prevModern = modern?.H ?? null;
    const prevLegacy = legacy?.current ?? null;
    if (modern) modern.H = dispatcher;
    if (legacy) legacy.current = dispatcher;
    try {
      render();
    } finally {
      if (modern) modern.H = prevModern;
      if (legacy) legacy.current = prevLegacy;
    }
    while (pending.length > 0) pending.shift()!();
  };
}

describe("useEventBusSubscriptions", () => {
  it("does not re-subscribe when the caller passes an equal inline array", () => {
    const { bus, stats } = makeCountingBus();
    setEventBus(bus);

    const rerender = createEffectDriver(() => {
      useEventBusSubscriptions(["trade:opened", "trade:closed"] as EventType[], () => {});
    });

    rerender();
    expect(stats.onCalls).toBe(2);
    expect(stats.unsubscribeCalls).toBe(0);

    rerender();
    rerender();

    expect(stats.onCalls).toBe(2);
    expect(stats.unsubscribeCalls).toBe(0);
  });

  it("re-subscribes when the event-type list actually changes", () => {
    const { bus, stats } = makeCountingBus();
    setEventBus(bus);

    let types: EventType[] = ["trade:opened"] as EventType[];
    const rerender = createEffectDriver(() => {
      useEventBusSubscriptions(types, () => {});
    });

    rerender();
    expect(stats.onCalls).toBe(1);

    types = ["trade:opened", "trade:closed"] as EventType[];
    rerender();

    expect(stats.unsubscribeCalls).toBe(1);
    expect(stats.onCalls).toBe(3);
  });

  it("delivers events to the latest handler without re-subscribing", async () => {
    const { bus, stats } = makeCountingBus();
    setEventBus(bus);

    const seen: string[] = [];
    let label = "first";
    const rerender = createEffectDriver(() => {
      useEventBusSubscriptions(["trade:opened"] as EventType[], () => {
        seen.push(label);
      });
    });

    rerender();
    label = "second";
    rerender();

    await bus.emit({ type: "trade:opened", timestamp: Date.now() } as never);

    expect(stats.onCalls).toBe(1);
    expect(seen).toEqual(["second"]);
  });
});
