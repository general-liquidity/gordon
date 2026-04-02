interface ThreadDensityMessage {
  content: string;
}

export interface VisibleThreadPolicyInput {
  messages: ThreadDensityMessage[];
  isStreaming: boolean;
  hasTaskTree: boolean;
  hasBackgroundTasks: boolean;
  bottomOffset?: number;
}

export interface VisibleThreadPolicy {
  visibleLimit: number;
  hiddenCount: number;
  hiddenBefore: number;
  hiddenAfter: number;
  startIndex: number;
  endIndex: number;
  bottomOffset: number;
  isPinnedBottom: boolean;
}

const MIN_VISIBLE_MESSAGES = 72;
const MAX_VISIBLE_MESSAGES = 160;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRecentCharacterLoad(messages: ThreadDensityMessage[], sampleSize: number = 36): number {
  return messages
    .slice(-sampleSize)
    .reduce((sum, message) => sum + message.content.length, 0);
}

export function getVisibleMessageLimit(input: VisibleThreadPolicyInput): number {
  const isReaderMode = (input.bottomOffset ?? 0) > 0;
  let visibleLimit = isReaderMode
    ? 132
    : input.isStreaming || input.hasTaskTree || input.hasBackgroundTasks ? 96 : 132;
  const recentCharacterLoad = getRecentCharacterLoad(input.messages);

  if (recentCharacterLoad >= 22_000) {
    visibleLimit -= 16;
  } else if (recentCharacterLoad >= 14_000) {
    visibleLimit -= 8;
  }

  if (input.messages.length >= 240) {
    visibleLimit -= 8;
  } else if (input.messages.length >= 140) {
    visibleLimit -= 4;
  }

  return clamp(visibleLimit, MIN_VISIBLE_MESSAGES, MAX_VISIBLE_MESSAGES);
}

export function buildVisibleThreadPolicy(input: VisibleThreadPolicyInput): VisibleThreadPolicy {
  const visibleLimit = getVisibleMessageLimit(input);
  const maxOffset = Math.max(0, input.messages.length - visibleLimit);
  const requestedOffset = input.bottomOffset ?? 0;
  const bottomOffset = clamp(requestedOffset, 0, maxOffset);
  const endIndex = Math.max(0, input.messages.length - bottomOffset);
  const startIndex = Math.max(0, endIndex - visibleLimit);
  const hiddenBefore = startIndex;
  const hiddenAfter = Math.max(0, input.messages.length - endIndex);
  const hiddenCount = hiddenBefore;

  return {
    visibleLimit,
    hiddenCount,
    hiddenBefore,
    hiddenAfter,
    startIndex,
    endIndex,
    bottomOffset,
    isPinnedBottom: bottomOffset === 0,
  };
}

export function formatHiddenMessageNotice(hiddenCount: number, visibleLimit: number): string {
  if (hiddenCount <= 0) {
    return "";
  }
  return `${hiddenCount} earlier message${hiddenCount === 1 ? "" : "s"} hidden · showing last ${visibleLimit} to keep the thread responsive.`;
}

export function formatHiddenNewerNotice(hiddenCount: number): string {
  if (hiddenCount <= 0) {
    return "";
  }

  return `${hiddenCount} newer message${hiddenCount === 1 ? "" : "s"} below · PgDn or End returns to the latest reply.`;
}
