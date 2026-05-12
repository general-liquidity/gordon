import {
  auditCacheBlocks,
  formatCacheBlockAudit,
  getLatestAuditedRequest,
} from "../../infra/agents/context/promptCacheAudit.ts";

export interface CacheAuditCommandResult {
  success: boolean;
  message: string;
}

/**
 * `/cache-audit` — inspect the most recent prompt request and verify
 * provider-specific prompt caching is wired correctly.
 *
 * Returns a human-readable diagnostic that includes:
 *   - Stable prefix / dynamic block hashes (so callers can diff across turns)
 *   - Whether explicit cache_control markers are present
 *   - Whether the active provider expects them
 *   - Whether the prefix is large enough to actually trigger a cache hit
 */
export async function handleCacheAuditCommand(_args: string): Promise<CacheAuditCommandResult> {
  const captured = getLatestAuditedRequest();
  if (!captured) {
    return {
      success: false,
      message:
        "No prompt request has been captured yet. Send a message to Gordon first, then run /cache-audit.",
    };
  }

  const result = auditCacheBlocks(captured.messages, captured.provider);
  const formatted = formatCacheBlockAudit(result);
  const ageSec = Math.max(0, Math.round((Date.now() - captured.capturedAt) / 1000));
  const header = `Audited request from ${ageSec}s ago${captured.threadId ? ` (thread: ${captured.threadId})` : ""}.`;
  return {
    success: true,
    message: `${header}\n\n${formatted}`,
  };
}
