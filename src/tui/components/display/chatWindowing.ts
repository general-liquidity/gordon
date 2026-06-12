// ============================================================================
// chatWindowing — pure windowing math for the fullscreen chat viewport
//
// In fullscreen (alt-screen) mode there is no terminal scrollback, so
// VirtualMessageList cannot commit history to <Static>. Instead it renders a
// windowed slice of messages sized to the viewport. This module is the pure
// computation: approximate per-message line heights, clamped scroll position,
// the visible message slice, and the partial-line clip for the first visible
// message (applied as a negative marginTop inside an overflow-hidden Box).
//
// Scroll semantics (classic chat behavior):
//   - scrollTop is measured in lines from the TOP of the transcript.
//   - requestedScrollTop === null means "stick to bottom": follow the tail
//     as new content streams in.
//   - A scrolled-up user (scrollTop < maxScroll) sees a frozen window —
//     appending content grows totalLines but does not move their view.
// ============================================================================

/** Rows MessageBubble chrome adds beyond the wrapped content lines
 *  (marginTop above the bubble + byline/badge row). Approximate. */
const MESSAGE_CHROME_ROWS = 2;

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Approximate the number of terminal rows `content` occupies at `width`. */
export function estimateWrappedLines(content: string, width: number): number {
  const cols = Math.max(1, Math.floor(width));
  const lines = content.split("\n");
  let total = 0;
  for (const line of lines) {
    const visible = line.replace(ANSI_PATTERN, "").length;
    total += Math.max(1, Math.ceil(visible / cols));
  }
  return total;
}

/** Approximate rows a rendered message occupies (content + bubble chrome). */
export function estimateMessageLines(
  message: { content: string },
  width: number,
): number {
  return estimateWrappedLines(message.content, width) + MESSAGE_CHROME_ROWS;
}

export interface ChatWindow {
  /** Index of the first visible message (inclusive). */
  start: number;
  /** Index past the last visible message (exclusive). */
  end: number;
  /** Lines of the first visible message hidden above the viewport —
   *  render the slice with marginTop={-topClip} inside an
   *  overflow-hidden Box of height viewportRows. */
  topClip: number;
  /** Sum of all message heights. */
  totalLines: number;
  /** Maximum scrollTop (0 when everything fits). */
  maxScroll: number;
  /** Clamped effective scrollTop. */
  scrollTop: number;
  /** True when the window is showing the tail (follow mode). */
  atBottom: boolean;
}

/**
 * Compute the visible window over `heights` (per-message row estimates).
 *
 * @param heights       estimated rows per message, transcript order
 * @param viewportRows  rows available to the chat viewport
 * @param requestedScrollTop  lines from the top, or null for stick-to-bottom
 */
export function computeChatWindow(
  heights: readonly number[],
  viewportRows: number,
  requestedScrollTop: number | null,
): ChatWindow {
  const viewport = Math.max(1, Math.floor(viewportRows));
  let totalLines = 0;
  for (const h of heights) totalLines += Math.max(0, h);
  const maxScroll = Math.max(0, totalLines - viewport);

  const scrollTop =
    requestedScrollTop === null
      ? maxScroll
      : Math.min(maxScroll, Math.max(0, Math.floor(requestedScrollTop)));
  const atBottom = scrollTop >= maxScroll;

  if (heights.length === 0 || totalLines === 0) {
    return { start: 0, end: 0, topClip: 0, totalLines, maxScroll, scrollTop, atBottom };
  }

  const windowStart = scrollTop;
  const windowEnd = scrollTop + viewport;

  let start = 0;
  let end = heights.length;
  let topClip = 0;
  let cursor = 0;
  let startFound = false;
  for (let i = 0; i < heights.length; i++) {
    const h = Math.max(0, heights[i]!);
    const msgStart = cursor;
    const msgEnd = cursor + h;
    if (!startFound && msgEnd > windowStart) {
      start = i;
      topClip = windowStart - msgStart;
      startFound = true;
    }
    if (msgStart >= windowEnd) {
      end = i;
      break;
    }
    cursor = msgEnd;
  }
  if (!startFound) {
    // scrollTop landed past all content (only possible with zero-height
    // tails); show nothing rather than a phantom window.
    return { start: heights.length, end: heights.length, topClip: 0, totalLines, maxScroll, scrollTop, atBottom };
  }

  return { start, end, topClip, totalLines, maxScroll, scrollTop, atBottom };
}
