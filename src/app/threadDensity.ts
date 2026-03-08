interface ThreadDensityMessage {
  content: string;
}

export interface VisibleThreadPolicyInput {
  messages: ThreadDensityMessage[];
  isStreaming: boolean;
  hasTaskTree: boolean;
  hasBackgroundTasks: boolean;
}

export interface VisibleThreadPolicy {
  visibleLimit: number;
  hiddenCount: number;
}

const MIN_VISIBLE_MESSAGES = 48;
const MAX_VISIBLE_MESSAGES = 112;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRecentCharacterLoad(messages: ThreadDensityMessage[], sampleSize: number = 36): number {
  return messages
    .slice(-sampleSize)
    .reduce((sum, message) => sum + message.content.length, 0);
}

export function getVisibleMessageLimit(input: VisibleThreadPolicyInput): number {
  let visibleLimit = input.isStreaming || input.hasTaskTree || input.hasBackgroundTasks ? 64 : 96;
  const recentCharacterLoad = getRecentCharacterLoad(input.messages);

  if (recentCharacterLoad >= 16_000) {
    visibleLimit -= 16;
  } else if (recentCharacterLoad >= 9_000) {
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
  const hiddenCount = Math.max(0, input.messages.length - visibleLimit);
  return { visibleLimit, hiddenCount };
}

export function formatHiddenMessageNotice(hiddenCount: number, visibleLimit: number): string {
  if (hiddenCount <= 0) {
    return "";
  }
  return `${hiddenCount} earlier message${hiddenCount === 1 ? "" : "s"} hidden · showing last ${visibleLimit} to keep the thread responsive.`;
}
