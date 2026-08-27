/**
 * StreamingMarkdown renders a stable prefix plus a freshly parsed tail. Once
 * the prefix advances, the tail no longer contains what the prefix absorbed,
 * so a prefix that never re-parses silently drops finished content out of the
 * rendered message.
 */

import { describe, it, expect } from "bun:test";
import React from "react";
import { StreamingMarkdown } from "./StreamingMarkdown.tsx";

/**
 * Minimal render driver: implements the useRef / useMemo subset the component
 * uses, with real dependency comparison, so it can be rendered without a
 * renderer (no react-test-renderer / ink-testing-library here).
 */
function createRenderDriver<T>(render: () => T) {
  const refs: { current: unknown }[] = [];
  const memos: { deps: unknown[] | undefined; value: unknown }[] = [];
  let refIdx = 0;
  let memoIdx = 0;

  const dispatcher = {
    useRef<R>(initial: R): { current: R } {
      const i = refIdx++;
      if (refs.length <= i) refs[i] = { current: initial };
      return refs[i] as { current: R };
    },
    useMemo<V>(factory: () => V, deps?: unknown[]): V {
      const i = memoIdx++;
      const prev = memos[i];
      const unchanged =
        prev !== undefined &&
        prev.deps !== undefined &&
        deps !== undefined &&
        prev.deps.length === deps.length &&
        prev.deps.every((d, k) => Object.is(d, deps[k]));
      if (unchanged) return prev.value as V;
      const value = factory();
      memos[i] = { deps, value };
      return value;
    },
  };

  return function rerender(): T {
    refIdx = 0;
    memoIdx = 0;
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
      return render();
    } finally {
      if (modern) modern.H = prevModern;
      if (legacy) legacy.current = prevLegacy;
    }
  };
}

/** Concatenate every string leaf in a returned element tree. */
function renderedText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join("");
  const element = node as { props?: { children?: unknown } };
  if (element.props && "children" in element.props) return renderedText(element.props.children);
  return "";
}

const CONTENT = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.";

describe("StreamingMarkdown", () => {
  it("keeps prefix content visible after the stable prefix advances", () => {
    // The real sequence: the message streams in (prefix stays empty), then
    // settles (prefix absorbs the completed paragraphs).
    let streaming = true;
    const rerender = createRenderDriver(() =>
      StreamingMarkdown({ content: CONTENT, isStreaming: streaming }),
    );

    const whileStreaming = renderedText(rerender());
    expect(whileStreaming).toContain("Alpha paragraph.");
    expect(whileStreaming).toContain("Gamma paragraph.");

    streaming = false;
    const onSettle = renderedText(rerender());
    expect(onSettle).toContain("Alpha paragraph.");
    expect(onSettle).toContain("Gamma paragraph.");

    // By now the prefix is non-empty, so the tail no longer carries the
    // earlier paragraphs: they can only come from the re-parsed prefix.
    const afterSettle = renderedText(rerender());
    expect(afterSettle).toContain("Alpha paragraph.");
    expect(afterSettle).toContain("Beta paragraph.");
    expect(afterSettle).toContain("Gamma paragraph.");
  });

  it("renders the same text whether or not the prefix has advanced", () => {
    let streaming = true;
    const settled = createRenderDriver(() =>
      StreamingMarkdown({ content: CONTENT, isStreaming: streaming }),
    );
    const withoutAdvance = renderedText(settled()).replace(/\s+/g, " ").trim();
    streaming = false;
    settled();
    const afterAdvance = renderedText(settled()).replace(/\s+/g, " ").trim();

    expect(afterAdvance).toBe(withoutAdvance);
  });
});
