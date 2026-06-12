import React, { useCallback, useRef, useMemo, useState } from "react";
import { Box, Static, type DOMElement } from "../../ink-custom";
import { MessageBubble, type Message } from "../messages/MessageBubble.tsx";
import { OffscreenFreeze } from "../layout/OffscreenFreeze.tsx";
import useMouse, { type MouseEvent } from "../../ink-custom/hooks/use-mouse.js";
import { createScrollBox, type ScrollBox } from "../../ink-custom/scrollBox.js";
import { computeChatWindow, estimateMessageLines } from "./chatWindowing.ts";
import type { ScrollBoxHandle } from "../layout/ScrollBox.tsx";
import { ScrollKeybindingHandler } from "../ScrollKeybindingHandler.tsx";

/** Lines per wheel-tick. Matches the muscle memory of most pagers. */
const WHEEL_STEP = 3;

// ============================================================================
// VirtualMessageList — Static scrollback + live tail (inline mode)
//                       windowed in-app viewport (fullscreen mode)
//
// INLINE (hybrid screen model, the fallback): past messages are committed to
// <Static> and written into the terminal's scrollback buffer (rendered once
// by Ink, never touched again). Only the streaming message lives in Ink's
// layout tree. History access: terminal scroll.
//
// FULLSCREEN (alt-screen model): there IS no terminal scrollback inside the
// alternate screen, so <Static> cannot work. Instead we render a windowed
// slice of messages sized to the viewport (approximate line counting via
// chatWindowing.ts) and scroll in-app: PgUp/PgDn + mouse wheel. Classic chat
// stickiness — at the tail the window follows new content; scrolled up it
// stays frozen until the user returns to the bottom (PgDn through the end).
//
// SCROLL ORIGIN: in fullscreen the GORDON banner + session box + trading
// preflight (the `header` node) is the FIRST entry of the windowed content —
// a synthetic message of `headerRows` rows at transcript index 0. It is part
// of the scroll history (not pinned chrome): the default view sticks to the
// bottom; scrolling up reaches the header at the very top of the session.
// ============================================================================

interface Props {
  messages: Message[];
  /** Reserved — currently unused since transcript search was removed. */
  scrollEnabled?: boolean;
  /** Fullscreen screen model: window messages in-app, never use <Static>. */
  fullscreen?: boolean;
  /** Rows available to the chat viewport (fullscreen only). */
  viewportRows?: number;
  /** Columns available for wrapping estimation (fullscreen only). */
  viewportWidth?: number;
  /**
   * Scroll-origin header (banner + session box + trading preflight). Rendered
   * as the first entry of the windowed content in fullscreen mode so it sits
   * at the top of scroll. Ignored in inline mode.
   */
  header?: React.ReactNode;
  /** Estimated rows the `header` entry occupies — feeds the windowing math. */
  headerRows?: number;
}

/**
 * Stable messages to keep visible in the Ink-managed live area.
 *
 * Was 4, then 2. Now 0 — the streaming message is the ONLY thing in the
 * live frame; every completed message gets committed to <Static>
 * immediately so it lives in terminal scrollback above the live frame.
 *
 * Why zero: the live frame's height drives Ink's eraseLines+reprint
 * radius. Whenever a long markdown answer (e.g. backtest help) lands in
 * the live tail, the frame becomes tall, and any subsequent re-render
 * (input keystroke, animation tick, anything) yanks the terminal
 * viewport back down to the frame's bottom — undoing the user's scroll
 * up to read earlier outputs. Keeping the live frame at 1 row (just the
 * input) means scrollback stays stable while the user reads history.
 *
 * Trade-off: there's no "live area" showing the most-recent assistant
 * message hovering above the input. The user reads it as the response
 * streams, then it scrolls into history naturally on completion. This
 * matches the Codex / Claude Code chat pattern.
 */
const LIVE_TAIL = 0;

export function VirtualMessageList({
  messages,
  scrollEnabled = true,
  fullscreen = false,
  viewportRows = 20,
  viewportWidth = 80,
  header,
  headerRows = 0,
}: Props) {
  const isStreaming = messages.some((m) => m.streaming);

  // Only show completed messages — streaming ones are invisible until done.
  // This gives "response appears all at once" rather than token-by-token drip.
  const completedMessages = messages.filter((m) => !m.streaming);

  // Collapse >3 consecutive tool/hook_progress messages into a single summary
  const lastMsg = completedMessages[completedMessages.length - 1];
  const collapseKey = `${completedMessages.length}:${lastMsg?.id ?? ""}:${(lastMsg?.content ?? "").length}`;
  const collapsedMessages = useMemo(() => {
    const result: Message[] = [];
    let toolGroup: Message[] = [];
    for (const msg of completedMessages) {
      if (msg.variant === "tool" || msg.variant === "hook_progress") {
        toolGroup.push(msg);
      } else {
        if (toolGroup.length > 3) {
          result.push({
            id: `collapsed-tools-${toolGroup[0]!.id}`,
            role: "system",
            content: `${toolGroup.length} tool results`,
            variant: "compact",
            timestamp: toolGroup[0]!.timestamp,
          });
        } else {
          result.push(...toolGroup);
        }
        toolGroup = [];
        result.push(msg);
      }
    }
    if (toolGroup.length > 3) {
      result.push({
        id: `collapsed-tools-${toolGroup[0]!.id}`,
        role: "system",
        content: `${toolGroup.length} tool results`,
        variant: "compact",
        timestamp: toolGroup[0]!.timestamp,
      });
    } else {
      result.push(...toolGroup);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);

  // Commit cursor — monotonically advancing.
  // Keeps last LIVE_TAIL stable messages + any streaming message in Ink's frame.
  // Everything before commitCursor goes to <Static> (terminal scrollback).
  const commitCursorRef = useRef(0);
  const firstStreamingIdx = collapsedMessages.findIndex((m) => m.streaming);
  const anchorIdx = firstStreamingIdx >= 0 ? firstStreamingIdx : collapsedMessages.length;
  const cutoff = Math.max(0, anchorIdx - LIVE_TAIL);
  if (!fullscreen && cutoff > commitCursorRef.current) {
    commitCursorRef.current = cutoff;
  }
  const commitCursor = commitCursorRef.current;
  const staticMessages = collapsedMessages.slice(0, commitCursor);
  const liveMessages = collapsedMessages.slice(commitCursor);

  // ---------------------------------------------------------------------
  // Fullscreen windowing state.
  //
  // The header (banner + boxes) is a synthetic entry at transcript index 0,
  // so the windowing heights are [headerRows, ...messageHeights]. scrollTop
  // === null means "stick to bottom" (follow new content); scrolling back to
  // (or past) the bottom re-arms stickiness. Scrolling all the way up reaches
  // line 0 — the top of the header.
  // ---------------------------------------------------------------------
  const [fsScrollTop, setFsScrollTop] = useState<number | null>(null);

  const fsHeights = useMemo(
    () =>
      fullscreen
        ? [
            Math.max(0, headerRows),
            ...collapsedMessages.map((m) => estimateMessageLines(m, viewportWidth)),
          ]
        : [],
    [fullscreen, headerRows, collapsedMessages, viewportWidth],
  );
  // At boot (no messages yet) anchor the window to the top so the GORDON
  // banner is what the user sees — not the bottom of the preflight box when
  // the header is taller than a short terminal. Once any message exists, or
  // the user scrolls, fall back to normal stick-to-bottom / explicit offset.
  const fsEffectiveScrollTop =
    fsScrollTop === null && collapsedMessages.length === 0 ? 0 : fsScrollTop;
  const fsWindow = computeChatWindow(fsHeights, viewportRows, fsEffectiveScrollTop);

  // Imperative scroll surface — consumed by ScrollKeybindingHandler and the
  // wheel handler. Window math is recomputed per render, so the handle reads
  // the latest values through a ref.
  const fsWindowRef = useRef(fsWindow);
  fsWindowRef.current = fsWindow;
  const fsApplyScroll = useCallback((next: number | null) => {
    setFsScrollTop((prev) => {
      const max = fsWindowRef.current.maxScroll;
      const resolved = next === null || next >= max ? null : Math.max(0, next);
      if (resolved !== prev) {
        // Full repaint on scroll — the marginTop shift confuses the
        // incremental line-diff (same pattern as layout/ScrollBox.tsx).
        (globalThis as { __inkClearIncrementalOutput?: () => void }).__inkClearIncrementalOutput?.();
      }
      return resolved;
    });
  }, []);
  const fsScrollHandleRef = useRef<ScrollBoxHandle | null>(null);
  fsScrollHandleRef.current = {
    scrollTo: (y: number) => fsApplyScroll(y),
    scrollBy: (delta: number) => fsApplyScroll(fsWindowRef.current.scrollTop + delta),
    scrollToBottom: () => fsApplyScroll(null),
    isAtBottom: () => fsWindowRef.current.atBottom,
    getScrollTop: () => fsWindowRef.current.scrollTop,
    getScrollHeight: () => fsWindowRef.current.totalLines,
    getFreshScrollHeight: () => fsWindowRef.current.totalLines,
    getViewportHeight: () => viewportRows,
    getViewportTop: () => fsWindowRef.current.scrollTop,
    subscribe: () => () => {},
    setClampBounds: () => {},
    scrollToElement: () => {},
  };

  // ---------------------------------------------------------------------
  // Mouse-wheel scrolling.
  //
  // We attach a ref to the live-tail Box, lazily build a ScrollBox handle
  // for it on first wheel event, and dispatch deltas through that handle.
  // The handle mutates `scrollTop` directly on the DOM node (no React
  // state) and coalesces markDirty calls into one microtask — at most one
  // render per burst regardless of wheel velocity.
  //
  // Re-render safety:
  //   - scrollContainerRef is a useRef (stable identity).
  //   - scrollBoxRef caches the ScrollBox handle so we don't build a new
  //     one per event.
  //   - The mouse handler reads/writes refs only; no setState during the
  //     handler body.
  // ---------------------------------------------------------------------
  const scrollContainerRef = useRef<DOMElement | null>(null);
  const scrollBoxRef = useRef<ScrollBox | null>(null);

  const getScrollBox = useCallback((): ScrollBox | null => {
    if (scrollBoxRef.current) return scrollBoxRef.current;
    const node = scrollContainerRef.current;
    if (!node) return null;
    // DOMElement from "../../ink-custom" is structurally compatible with ink-custom's
    // DOMElement (createScrollBox only touches `attributes` + optional
    // `yogaNode.markDirty`). Cast through unknown for type-checker peace.
    scrollBoxRef.current = createScrollBox(node as unknown as Parameters<typeof createScrollBox>[0]);
    return scrollBoxRef.current;
  }, []);

  useMouse(
    (event: MouseEvent) => {
      const delta =
        event.button === "wheel-up" ? -WHEEL_STEP : event.button === "wheel-down" ? WHEEL_STEP : 0;
      if (delta === 0) return;
      if (fullscreen) {
        fsScrollHandleRef.current?.scrollBy(delta);
        return;
      }
      const box = getScrollBox();
      if (box) box.scrollBy(delta);
    },
    { isActive: scrollEnabled },
  );

  if (fullscreen) {
    // The header occupies synthetic index 0; messages are 1..N. The window
    // returns start/end over that combined list, so the header is visible
    // exactly when fsWindow.start === 0, and the visible message slice is
    // [max(0, start-1), end-1).
    const headerVisible = fsWindow.start === 0 && headerRows > 0;
    const msgStart = Math.max(0, fsWindow.start - 1);
    const msgEnd = Math.max(0, fsWindow.end - 1);
    const visible = collapsedMessages.slice(msgStart, msgEnd);
    return (
      <Box flexDirection="column" height={viewportRows} overflow="hidden">
        {/* PgUp/PgDn page through history in-app (no scrollback in the alt screen). */}
        <ScrollKeybindingHandler
          scrollRef={fsScrollHandleRef}
          pageSize={Math.max(1, viewportRows - 1)}
          enabled={scrollEnabled}
          pageKeysOnly
        />
        <Box flexDirection="column" marginTop={-fsWindow.topClip}>
          {headerVisible ? header : null}
          {visible.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" ref={scrollContainerRef}>
      {/* Past messages — written once into terminal scrollback, never re-rendered */}
      {staticMessages.length > 0 && (
        <Static items={staticMessages}>
          {(msg) => <MessageBubble key={msg.id} message={msg} />}
        </Static>
      )}

      {/* Live tail — last LIVE_TAIL stable messages + any streaming message */}
      {liveMessages.map((msg, idx) => {
        // Freeze all but the actively-animating message to prevent offscreen repaints
        const isActive = isStreaming ? !!msg.streaming : idx === liveMessages.length - 1;
        return (
          <Box key={msg.id}>
            <OffscreenFreeze frozen={!isActive}>
              <MessageBubble message={msg} />
            </OffscreenFreeze>
          </Box>
        );
      })}
    </Box>
  );
}
