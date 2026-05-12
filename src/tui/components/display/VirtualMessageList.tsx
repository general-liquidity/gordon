import React, { useCallback, useRef, useMemo } from "react";
import { Box, Static, type DOMElement } from "../../ink-custom";
import { MessageBubble, type Message } from "../messages/MessageBubble.tsx";
import { OffscreenFreeze } from "../layout/OffscreenFreeze.tsx";
import useMouse, { type MouseEvent } from "../../ink-custom/hooks/use-mouse.js";
import { createScrollBox, type ScrollBox } from "../../ink-custom/scrollBox.js";

/** Lines per wheel-tick. Matches the muscle memory of most pagers. */
const WHEEL_STEP = 3;

// ============================================================================
// VirtualMessageList — Static scrollback + live tail
//
// Past messages are committed to <Static> and written into the terminal's
// scrollback buffer (rendered once by Ink, never touched again). Only the
// last LIVE_TAIL stable messages plus any currently-streaming message live
// in Ink's layout tree, keeping the Ink frame small enough to fit the
// terminal without height estimation or overflow.
//
// History access: terminal scroll (mouse wheel / Shift+PgUp).
// History access: terminal scroll only.
// ============================================================================

interface Props {
  messages: Message[];
  /** Reserved — currently unused since transcript search was removed. */
  scrollEnabled?: boolean;
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

export function VirtualMessageList({ messages, scrollEnabled = true }: Props) {
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
  if (cutoff > commitCursorRef.current) {
    commitCursorRef.current = cutoff;
  }
  const commitCursor = commitCursorRef.current;
  const staticMessages = collapsedMessages.slice(0, commitCursor);
  const liveMessages = collapsedMessages.slice(commitCursor);

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
      if (event.button === "wheel-up") {
        const box = getScrollBox();
        if (box) box.scrollBy(-WHEEL_STEP);
      } else if (event.button === "wheel-down") {
        const box = getScrollBox();
        if (box) box.scrollBy(WHEEL_STEP);
      }
    },
    { isActive: scrollEnabled },
  );

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
