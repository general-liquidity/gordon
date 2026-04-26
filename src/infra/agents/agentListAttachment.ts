/**
 * Agent List Attachment — prompt-cache-friendly agent surface.
 *
 * Claude Code optimization: the dynamic list of available subagents
 * gets injected into the model's context as a separate system message
 * (an "attachment") rather than baked into the tool schema. Tool
 * schemas are part of the prefix prompt cache; injecting a dynamic
 * list there busts the cache on every change. Attachments live in the
 * variable section of the prompt — cheaper to update.
 *
 * For Gordon, the gain is small at the current 3-agent surface (gordon,
 * executor, researcher) — but if the fork-subagent pattern lands, the
 * list could grow, and this primitive is ready.
 *
 * Pure function — caller decides where to splice the result into the
 * outgoing prompt.
 */

export interface AgentListEntry {
  /** Stable identifier — e.g. "executor", "fork:btc-analysis". */
  id: string;
  /** Short purpose blurb. Kept under ~80 chars to avoid bloat. */
  description: string;
  /** Optional capability tags for the model to filter on. */
  tags?: string[];
  /** Whether the agent is currently spawnable (false = registered but disabled). */
  available?: boolean;
}

export interface AgentListAttachmentOptions {
  /** Cap on the body string. Default 4000 chars. */
  maxChars?: number;
  /** Header line. Default `<agent_listing>`. */
  header?: string;
}

export interface AgentListAttachment {
  /** Role for the message envelope. Always "system". */
  role: "system";
  /** The rendered attachment body. */
  content: string;
  /** Stable hash of `entries` so the orchestrator can skip re-injection
   *  when nothing has changed. */
  fingerprint: string;
}

const DEFAULT_MAX_CHARS = 4000;

function fnv1aHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Build an agent-list attachment message. Caller injects the result
 * after the stable system prompt but before user/assistant turns —
 * mirroring Claude Code's `agent_listing_delta` placement.
 */
export function buildAgentListAttachment(
  entries: AgentListEntry[],
  options: AgentListAttachmentOptions = {},
): AgentListAttachment {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const header = options.header ?? "[GORDON_AGENT_LIST]";

  // Sort by id for stable fingerprints across runs.
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [header];
  for (const e of sorted) {
    if (e.available === false) continue;
    const tags = e.tags && e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
    lines.push(`- ${e.id}: ${e.description}${tags}`);
  }
  let body = lines.join("\n");

  if (body.length > maxChars) {
    // Truncate — keep header, drop tail, append marker.
    const marker = "\n…[truncated]";
    const sliceTo = Math.max(0, maxChars - marker.length);
    body = body.slice(0, sliceTo) + marker;
  }

  // Fingerprint over the *sorted, available* entries so re-renders that
  // don't change the surface produce an identical hash.
  const fpInput = sorted
    .filter((e) => e.available !== false)
    .map((e) => `${e.id}|${e.description}|${(e.tags ?? []).join(",")}`)
    .join("\n");

  return {
    role: "system",
    content: body,
    fingerprint: fnv1aHash(fpInput),
  };
}

/**
 * Decide whether to inject a new attachment given the previous
 * fingerprint. Returns true when the surface has changed and the
 * orchestrator should refresh the attachment in the next prompt.
 */
export function shouldRefreshAgentList(
  current: AgentListAttachment,
  previousFingerprint: string | undefined,
): boolean {
  return current.fingerprint !== previousFingerprint;
}
