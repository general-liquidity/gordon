import React, { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react";
import { Box, Text, useInput, Static } from "ink";
import { MessageBubble, type Message } from "./MessageBubble.js";
import { UnseenDivider } from "./UnseenDivider.js";
import {
  useVirtualScroll,
  getScrollAction,
  reportMeasuredHeight,
} from "../hooks/useVirtualScroll.js";
import { useScrollAcceleration } from "../hooks/useScrollAcceleration.js";
import { useTranscriptSearch } from "../hooks/useTranscriptSearch.js";
import { SearchBar } from "./SearchBar.js";

// ============================================================================
// VirtualMessageList — Renders only visible messages via virtual scroll
//
// Replaces <Static> + manual slicing for large conversations.
// Supports j/k, Ctrl+D/U, G/g for scroll navigation.
// Shows "N new" indicator when not at bottom and messages arrive.
// ============================================================================

interface Props {
  messages: Message[];
  viewportHeight: number;
  /** Terminal column width, forwarded to height estimator (default 80) */
  terminalWidth?: number;
  /** Whether input focus should be on scroll keys (disable during typing) */
  scrollEnabled?: boolean;
}

/** Fallback step size passed to getScrollAction for j/k keys (3 rows ≈ one short message) */
const DEFAULT_ITEM_HEIGHT = 3;

/** Messages older than this many items are committed to <Static> and never re-rendered */
const LIVE_WINDOW_SIZE = 200;

export function VirtualMessageList({
  messages,
  viewportHeight,
  terminalWidth = 80,
  scrollEnabled = true,
}: Props) {
  const [unseenCount, setUnseenCount] = useState(0);
  const prevMessageCount = useRef(messages.length);
  // True only when the user explicitly pressed an up-scroll key — suppresses
  // auto-scroll so they can read history. Cleared when they jump to bottom.
  const userScrolledUp = useRef(false);
  const commitCursorRef = useRef(0);

  const isStreaming = messages.some((m) => m.streaming);

  // Message collapsing pipeline (Claude Code pattern): group consecutive
  // tool results. Keyed on (messages.length, last id, last content length)
  // instead of messages array identity — when only the last message's
  // content changes during streaming we still hit the cache because the
  // id is stable and the collapse structure doesn't depend on content.
  const lastMsg = messages[messages.length - 1];
  const collapseKey = `${messages.length}:${lastMsg?.id ?? ""}:${(lastMsg?.content ?? "").length}`;
  const collapsedMessages = useMemo(() => {
    const result: Message[] = [];
    let toolGroup: Message[] = [];

    for (const msg of messages) {
      if (msg.variant === "tool" || msg.variant === "hook_progress") {
        toolGroup.push(msg);
      } else {
        // Flush tool group
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
    // Flush remaining
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

  const deferredMessages = useDeferredValue(collapsedMessages);

  // Advance commitCursor monotonically — committed messages go to <Static> (rendered once, never again)
  const stableCount = deferredMessages.filter(m => !m.streaming).length;
  const candidateCursor = Math.max(0, stableCount - LIVE_WINDOW_SIZE);
  if (candidateCursor > commitCursorRef.current) {
    commitCursorRef.current = candidateCursor;
  }
  const commitCursor = commitCursorRef.current;
  const staticMessages = deferredMessages.slice(0, commitCursor);
  const liveMessages = deferredMessages.slice(commitCursor);

  const { getAcceleratedDelta } = useScrollAcceleration();

  const {
    startIndex,
    endIndex,
    isAtBottom,
    scrollToBottom,
    scrollTo,
    onScroll,
  } = useVirtualScroll({
    items: liveMessages,
    viewportHeight,
    terminalWidth,
  });

  // Track unseen messages when user has scrolled up.
  // Streaming always clears the unseen count — you're following live content.
  useEffect(() => {
    const newCount = messages.length - prevMessageCount.current;
    if (newCount > 0 && userScrolledUp.current && !isStreaming) {
      setUnseenCount((prev) => prev + newCount);
    }
    if (!userScrolledUp.current || isStreaming) {
      setUnseenCount(0);
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, isStreaming]);

  // Auto-scroll: always follow new content unless user explicitly scrolled up.
  // During streaming the chat must follow the response like Claude Code does.
  // Streaming also resets userScrolledUp so the unseen indicator clears.
  const lastMsgContentLen = messages[messages.length - 1]?.content?.length ?? 0;
  useEffect(() => {
    if (!userScrolledUp.current || isStreaming) {
      scrollToBottom();
      if (isStreaming) {
        userScrolledUp.current = false;
      }
    }
  }, [messages.length, lastMsgContentLen, isStreaming, scrollToBottom]);

  // Keyboard scroll bindings
  useInput(
    (input, key) => {
      if (!scrollEnabled) return;

      if (key.upArrow && !key.ctrl) {
        userScrolledUp.current = true;
        onScroll(-getAcceleratedDelta("up", DEFAULT_ITEM_HEIGHT));
        return;
      }
      if (key.downArrow && !key.ctrl) {
        if (isAtBottom) userScrolledUp.current = false;
        onScroll(getAcceleratedDelta("down", DEFAULT_ITEM_HEIGHT));
        return;
      }

      const action = getScrollAction(input, key, viewportHeight, DEFAULT_ITEM_HEIGHT);
      if (!action) return;

      if (action.delta === "bottom") {
        userScrolledUp.current = false;
        scrollToBottom();
        setUnseenCount(0);
      } else if (action.delta === "top") {
        userScrolledUp.current = true;
        scrollTo(0);
      } else if (action.delta === "pageUp") {
        userScrolledUp.current = true;
        onScroll(-viewportHeight);
      } else if (action.delta === "pageDown") {
        onScroll(viewportHeight);
        if (isAtBottom) userScrolledUp.current = false;
      } else {
        // Positive delta = down, negative = up
        if ((action.delta as number) < 0) {
          userScrolledUp.current = true;
          onScroll(-getAcceleratedDelta("up", Math.abs(action.delta as number)));
        } else {
          if (isAtBottom) userScrolledUp.current = false;
          onScroll(getAcceleratedDelta("down", action.delta as number));
        }
      }
    },
    { isActive: scrollEnabled },
  );

  const handleJumpToBottom = useCallback(() => {
    userScrolledUp.current = false;
    scrollToBottom();
    setUnseenCount(0);
  }, [scrollToBottom]);

  // Slice visible messages
  const visibleMessages = liveMessages.slice(startIndex, endIndex);

  // Post-render: collect actual Yoga heights for visible messages and feed back
  // into the height cache to improve virtual scroll accuracy over time.
  useEffect(() => {
    if (typeof (globalThis as any).__inkGetMeasuredHeight !== 'function') return;
    for (const msg of visibleMessages) {
      const h = (globalThis as any).__inkGetMeasuredHeight(msg.id);
      if (h != null && h > 0) {
        reportMeasuredHeight(msg.id, h);
      }
    }
  });

  const [searchMode, setSearchMode] = useState(false);
  const search = useTranscriptSearch(messages);

  // Message selection state — subtle background highlight
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  useInput((input, key) => {
    if (!scrollEnabled) return;
    // Ctrl+Up/Down for message selection
    if (key.ctrl && key.upArrow) {
      setSelectedIdx((prev) => prev == null ? visibleMessages.length - 1 : Math.max(0, prev - 1));
    } else if (key.ctrl && key.downArrow) {
      setSelectedIdx((prev) => prev == null ? 0 : Math.min(visibleMessages.length - 1, prev + 1));
    } else if (key.escape && selectedIdx != null) {
      setSelectedIdx(null);
    }
  }, { isActive: scrollEnabled });

  useInput((input, key) => {
    // "/" to enter search
    if (input === "/" && !searchMode) {
      setSearchMode(true);
      return;
    }
    if (!searchMode) return;
    // Escape to exit search
    if (key.escape) {
      setSearchMode(false);
      search.clearSearch();
      return;
    }
    // n = next match, N = prev match
    if (input === "n") { search.navigateNext(); return; }
    if (input === "N") { search.navigatePrev(); return; }
    // Backspace
    if (key.backspace || key.delete) {
      search.setQuery(search.query.slice(0, -1));
      return;
    }
    // Type character
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      search.setQuery(search.query + input);
    }
  }, { isActive: scrollEnabled });

  // Auto-scroll to current search match
  useEffect(() => {
    if (search.currentMatch) {
      const liveIdx = search.currentMatch.messageIndex - commitCursor;
      if (liveIdx >= 0) {
        scrollTo(liveIdx);
      }
      // If liveIdx < 0, match is in static zone — user must use terminal scroll buffer
    }
  }, [search.currentMatch, scrollTo, commitCursor]);

  return (
    <Box flexDirection="column" height={viewportHeight}>
      {/* Committed past messages — rendered once by Ink, never repainted */}
      {staticMessages.length > 0 && (
        <Static items={staticMessages}>
          {(msg) => <MessageBubble key={msg.id} message={msg} />}
        </Static>
      )}

      {/* Live window — virtual scroll over last LIVE_WINDOW_SIZE messages */}
      {visibleMessages.map((msg, i) => {
        const isSelected = i === selectedIdx;
        const isSearchMatch = !isSelected && search.currentMatch?.messageId === msg.id;
        return (
          <Box
            key={msg.id}
            {...({'data-measure-id': msg.id} as any)}
            {...(isSelected
              ? { borderStyle: "single" as const, borderColor: "gray" }
              : isSearchMatch
                ? { borderStyle: "single" as const, borderColor: "yellow" }
                : {})}
          >
            <MessageBubble message={msg} />
          </Box>
        );
      })}

      {/* Search bar */}
      <SearchBar
        query={search.query}
        matchCount={search.matches.length}
        currentMatchIndex={search.currentMatchIndex}
        isActive={search.isActive}
      />

      {/* Unseen indicator */}
      {unseenCount > 0 && !isAtBottom && (
        <UnseenDivider count={unseenCount} onJumpToBottom={handleJumpToBottom} />
      )}
    </Box>
  );
}
