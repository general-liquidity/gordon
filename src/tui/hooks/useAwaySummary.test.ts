import { describe, it, expect } from "bun:test";
import React from "react";
import { useAwaySummary, type UseAwaySummaryOptions } from "./useAwaySummary.ts";

// ---------------------------------------------------------------------------
// Minimal hook driver — implements the subset of React hooks useAwaySummary
// uses (useState / useRef / useCallback) so the hook can run without a full
// renderer (no react-test-renderer / ink-testing-library in this repo).
// ---------------------------------------------------------------------------

interface HookCell {
  states: unknown[];
  refs: { current: unknown }[];
  callbacks: { fn: unknown; deps: unknown[] }[];
}

function createHookDriver<T>(render: () => T) {
  const cell: HookCell = { states: [], refs: [], callbacks: [] };
  let stateIdx = 0;
  let refIdx = 0;
  let _cbIdx = 0;
  let rerender: () => void;

  const dispatcher = {
    useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
      const i = stateIdx++;
      if (cell.states.length <= i) {
        cell.states[i] = typeof initial === "function" ? (initial as () => S)() : initial;
      }
      const setter = (next: S | ((prev: S) => S)) => {
        const prev = cell.states[i] as S;
        cell.states[i] = typeof next === "function" ? (next as (p: S) => S)(prev) : next;
        rerender();
      };
      return [cell.states[i] as S, setter];
    },
    useRef<R>(initial: R): { current: R } {
      const i = refIdx++;
      if (cell.refs.length <= i) cell.refs[i] = { current: initial };
      return cell.refs[i] as { current: R };
    },
    useCallback<F>(fn: F, _deps: unknown[]): F {
      // Deps don't matter for behavior here; always return the latest closure
      // so the callback sees current state/refs.
      _cbIdx++;
      return fn;
    },
  };

  rerender = () => {
    stateIdx = 0;
    refIdx = 0;
    _cbIdx = 0;
    const internals = React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: {
        H: typeof dispatcher | null;
      };
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
        ReactCurrentDispatcher?: { current: typeof dispatcher | null };
      };
    };
    const modern = internals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const legacy =
      internals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher;
    const prevModern = modern?.H ?? null;
    const prevLegacy = legacy?.current ?? null;
    if (modern) modern.H = dispatcher as never;
    if (legacy) legacy.current = dispatcher as never;
    try {
      result.current = render();
    } finally {
      if (modern) modern.H = prevModern;
      if (legacy) legacy.current = prevLegacy;
    }
  };

  const result = { current: undefined as unknown as T };
  rerender();
  return result;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("useAwaySummary", () => {
  it("calls the injected generator with messages, positions, and away duration", async () => {
    let received: { messages: unknown[]; positions: unknown[]; awayMs: number } | null = null;
    const fakeGenerate = (messages: unknown[], positions: unknown[], awayMs: number) => {
      received = { messages, positions, awayMs };
      return Promise.resolve("recap text");
    };

    const messages = [{ variant: "fill" }, { variant: "alert" }];
    const positions = [{ symbol: "BTC", pnl: 12 }];

    const opts: UseAwaySummaryOptions = {
      getMessages: () => messages,
      getPositions: () => positions,
      generate: fakeGenerate,
      idleThresholdMs: 1, // tiny so any elapsed time triggers
    };

    const hook = createHookDriver(() => useAwaySummary(opts));

    hook.current.markBlurred();
    await new Promise((r) => setTimeout(r, 5)); // exceed idle threshold
    hook.current.markFocused();

    expect(received).not.toBeNull();
    expect(received!.messages).toBe(messages);
    expect(received!.positions).toBe(positions);
    expect(received!.awayMs).toBeGreaterThanOrEqual(1);

    await flush();
    expect(hook.current.awaySummary).toBe("recap text");
    expect(hook.current.isGenerating).toBe(false);
    expect(hook.current.error).toBeNull();
  });

  it("sets isGenerating while the summary is in flight", async () => {
    let resolve!: (s: string) => void;
    const pending = new Promise<string>((r) => (resolve = r));
    const opts: UseAwaySummaryOptions = {
      generate: () => pending,
      idleThresholdMs: 1,
    };

    const hook = createHookDriver(() => useAwaySummary(opts));
    hook.current.markBlurred();
    await new Promise((r) => setTimeout(r, 5));
    hook.current.markFocused();

    expect(hook.current.isGenerating).toBe(true);
    expect(hook.current.awaySummary).toBeNull();

    resolve("done");
    await flush();
    expect(hook.current.isGenerating).toBe(false);
    expect(hook.current.awaySummary).toBe("done");
  });

  it("captures generator errors and clears the in-flight state", async () => {
    const opts: UseAwaySummaryOptions = {
      generate: () => Promise.reject(new Error("boom")),
      idleThresholdMs: 1,
    };

    const hook = createHookDriver(() => useAwaySummary(opts));
    hook.current.markBlurred();
    await new Promise((r) => setTimeout(r, 5));
    hook.current.markFocused();
    await flush();

    expect(hook.current.error).toBeInstanceOf(Error);
    expect(hook.current.error?.message).toBe("boom");
    expect(hook.current.isGenerating).toBe(false);
    expect(hook.current.awaySummary).toBeNull();
  });

  it("does not generate before the idle threshold elapses", async () => {
    let called = false;
    const opts: UseAwaySummaryOptions = {
      generate: () => {
        called = true;
        return Promise.resolve("nope");
      },
      idleThresholdMs: 60_000,
    };

    const hook = createHookDriver(() => useAwaySummary(opts));
    hook.current.markBlurred();
    hook.current.markFocused(); // immediate refocus, well under threshold
    await flush();

    expect(called).toBe(false);
    expect(hook.current.awaySummary).toBeNull();
  });

  it("defaults to the real generateAwaySummary implementation", async () => {
    // No `generate` injected → uses the imported real implementation, which is
    // deterministic (no LLM). Assert it produces the structured recap.
    const opts: UseAwaySummaryOptions = {
      getMessages: () => [{ variant: "fill" }],
      getPositions: () => [{ symbol: "ETH", pnl: 5 }],
      idleThresholdMs: 1,
    };
    const hook = createHookDriver(() => useAwaySummary(opts));
    hook.current.markBlurred();
    await new Promise((r) => setTimeout(r, 5));
    hook.current.markFocused();
    await flush();

    expect(hook.current.awaySummary).toContain("While you were away");
    expect(hook.current.awaySummary).toContain("filled");
  });
});
