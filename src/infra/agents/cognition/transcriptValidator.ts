import { listActionLogEntries } from "../../action-log/store.ts";
import type { SystemModelMessage, UserModelMessage } from "ai";
import type { GroundedPromptMessage } from "../context/contextBudget.ts";
import type { GordonContext } from "../types.ts";

export interface TranscriptValidationResult {
  sanitizedUserMessage: string;
  repairNotes: string[];
  anomalyCount: number;
}

export interface ModelMessageValidationResult {
  messages: GroundedPromptMessage[];
  repairNotes: string[];
  anomalyCount: number;
}

const RESERVED_MARKERS = [
  "[GORDON_RUNTIME_STATE]",
  "[GORDON_PROJECT_TRUTH]",
  "[GORDON_INTEGRATION_GLOSSARY]",
  "[GORDON_TOOL_CONTEXT]",
  "[GORDON_PHASE_GUIDANCE]",
  "[GORDON_RUNTIME_REMINDERS]",
  "[GORDON_TRANSCRIPT_REPAIR]",
  "[GORDON_PLANNING_HANDOFF]",
] as const;

function sanitizeReservedMarkers(message: string): string {
  return RESERVED_MARKERS.reduce(
    (current, marker) => current.replaceAll(marker, marker.replace("[", "\\[")),
    message,
  );
}

function normalizeWhitespace(message: string): string {
  return message
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForDeduplication(message: string): string {
  return normalizeWhitespace(message).toLowerCase();
}

type GroundedProviderOptions = SystemModelMessage["providerOptions"] | UserModelMessage["providerOptions"];

function getProviderOptions(message: GroundedPromptMessage): GroundedProviderOptions | undefined {
  return "providerOptions" in message
    ? message.providerOptions
    : undefined;
}

function isMeaningfulUserContent(message: string): boolean {
  const unescaped = RESERVED_MARKERS.reduce(
    (current, marker) => current.replaceAll(marker.replace("[", "\\["), ""),
    message,
  );
  return normalizeWhitespace(unescaped).length > 0;
}

export function formatTranscriptRepairBlock(validation: TranscriptValidationResult): string {
  if (validation.repairNotes.length === 0) {
    return "";
  }
  return [
    "[GORDON_TRANSCRIPT_REPAIR]",
    ...validation.repairNotes.map((note) => `- ${note}`),
  ].join("\n");
}

export function validateAndRepairTranscript(
  userMessage: string,
  context: GordonContext,
): TranscriptValidationResult {
  const repairNotes: string[] = [];
  let sanitized = normalizeWhitespace(userMessage);

  if (!sanitized) {
    sanitized = "Help with the current thread request.";
    repairNotes.push("The incoming request was empty after normalization, so Gordon inserted a minimal fallback instruction.");
  }

  const markerSanitized = sanitizeReservedMarkers(sanitized);
  if (markerSanitized !== sanitized) {
    sanitized = markerSanitized;
    repairNotes.push("Reserved Gordon runtime markers were escaped so user text cannot override grounded system context.");
  }

  if (!isMeaningfulUserContent(sanitized)) {
    sanitized = "Help with the current thread request.";
    repairNotes.push("The incoming request only contained reserved runtime markers, so Gordon replaced it with a minimal fallback instruction.");
  }

  const threadId = context.threadId;
  if (threadId) {
    const entries = listActionLogEntries({ threadId, limit: 24 });
    let consecutiveAssistant = 0;
    let toolResultWithoutCall = 0;
    let repeatedFailures = 0;
    let lastFailureSignature = "";

    const chronological = [...entries].reverse();
    for (const entry of chronological) {
      if (entry.entryType === "assistant_message") {
        consecutiveAssistant += 1;
      } else if (entry.entryType === "user_message") {
        consecutiveAssistant = 0;
      }

      if (entry.entryType === "tool_result") {
        const hasParent = Boolean(entry.parentEntryId);
        const hasLinkedCall = entries.some((candidate) => candidate.id === entry.parentEntryId || candidate.correlationId === entry.correlationId && candidate.entryType === "tool_call");
        if (!hasParent && !hasLinkedCall) {
          toolResultWithoutCall += 1;
        }
      }

      if (entry.entryType === "run_status" && /failed|blocked|rate.?limit/i.test(`${entry.title} ${entry.content}`)) {
        const signature = `${entry.title}:${entry.content}`;
        if (signature === lastFailureSignature) {
          repeatedFailures += 1;
        } else {
          lastFailureSignature = signature;
          repeatedFailures = 1;
        }
      }
    }

    if (consecutiveAssistant >= 4) {
      repairNotes.push("Recent thread history has several assistant-side turns without a fresh user turn. Favor the latest user intent over stale assistant momentum.");
    }

    if (toolResultWithoutCall > 0) {
      repairNotes.push("Recent action-log history contains tool results without an obvious originating tool-call entry. Treat recent runtime history cautiously and prefer current grounded state.");
    }

    if (repeatedFailures >= 2) {
      repairNotes.push("Recent thread history shows repeated identical failures. Avoid looping on the same failing path without changing venue, provider, or scope.");
    }
  }

  return {
    sanitizedUserMessage: sanitized,
    repairNotes,
    anomalyCount: repairNotes.length,
  };
}

export function validateAndRepairModelMessages(
  messages: GroundedPromptMessage[],
): ModelMessageValidationResult {
  const repairNotes: string[] = [];
  const repaired: GroundedPromptMessage[] = [];
  const seenDynamicSystemBlocks = new Set<string>();
  const seenReminderBlocks = new Set<string>();
  const seenUserIntents = new Set<string>();

  for (const rawMessage of messages) {
    const role = rawMessage.role === "system" ? "system" : "user";
    const normalizedContent = normalizeWhitespace(String(rawMessage.content ?? ""));
    const providerOptions = getProviderOptions(rawMessage);
    if (!normalizedContent) {
      repairNotes.push(`Dropped empty ${role} message before model call.`);
      continue;
    }

    const sanitizedContent = sanitizeReservedMarkers(normalizedContent);
    const previous = repaired[repaired.length - 1];
    const normalizedForDedup = normalizeForDeduplication(sanitizedContent);

    if (role === "system" && normalizedForDedup.includes("[gordon_runtime_reminders_note]")) {
      repairNotes.push("Converted a misplaced runtime reminder block into user-side guidance semantics.");
    }

    if (role === "system" && !providerOptions) {
      if (seenDynamicSystemBlocks.has(normalizedForDedup)) {
        repairNotes.push("Dropped a duplicate dynamic system block before provider call.");
        continue;
      }
      seenDynamicSystemBlocks.add(normalizedForDedup);
    }

    if (role === "user" && sanitizedContent.startsWith("[GORDON_RUNTIME_REMINDERS_NOTE]")) {
      if (seenReminderBlocks.has(normalizedForDedup)) {
        repairNotes.push("Dropped a duplicate runtime reminder note before provider call.");
        continue;
      }
      seenReminderBlocks.add(normalizedForDedup);
    }

    if (
      role === "user" &&
      !sanitizedContent.startsWith("[GORDON_RUNTIME_REMINDERS_NOTE]") &&
      !sanitizedContent.startsWith("[GORDON_TRANSCRIPT_REPAIR]")
    ) {
      if (seenUserIntents.has(normalizedForDedup) && normalizedForDedup.length > 0) {
        repairNotes.push("Dropped a duplicate user-intent message before provider call.");
        continue;
      }
      seenUserIntents.add(normalizedForDedup);
    }

    if (
      previous &&
      previous.role === "system" &&
      role === "system" &&
      !getProviderOptions(previous) &&
      !providerOptions
    ) {
      previous.content = `${previous.content}\n\n${sanitizedContent}`;
      repairNotes.push("Merged adjacent uncached system messages before provider call.");
      continue;
    }

    if (role === "system") {
      repaired.push({
        role: "system",
        content: sanitizedContent,
        ...(providerOptions ? { providerOptions } : {}),
      });
    } else {
      repaired.push({
        role: "user",
        content: sanitizedContent,
        ...(providerOptions ? { providerOptions } : {}),
      });
    }
  }

  if (repaired.length === 0 || repaired[repaired.length - 1]?.role !== "user") {
    repaired.push({
      role: "user",
      content: "Help with the current thread request.",
    });
    repairNotes.push("Inserted a fallback user message because the model-facing transcript did not end with user intent.");
  }

  return {
    messages: repaired,
    repairNotes,
    anomalyCount: repairNotes.length,
  };
}
