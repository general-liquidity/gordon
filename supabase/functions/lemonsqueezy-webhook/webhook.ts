/**
 * Core webhook handler (processor-agnostic).
 *
 * Consumes a NormalizedEvent (produced by any ProcessorAdapter) and applies
 * the money-leg side effects through injected ports:
 *   - purchase -> mint a single-use invite code, persist it, email the buyer
 *   - revoke   -> flip the matching activations to status='revoked'
 *
 * Ports (WebhookDb, EmailSender) are injected so this module carries no Deno
 * or Supabase imports and is fully unit-testable under bun:test.
 */

import type { NormalizedEvent } from "./adapter.ts";

/** Row inserted into the existing `invite_codes` table. */
export interface InviteRow {
  code: string;
  label: string;
  max_uses: number;
  expires_at: string | null;
  plan: string;
  subscription_id: string | null;
}

export interface WebhookDb {
  insertInviteCode(row: InviteRow): Promise<void>;
  /** Flip every activation linked to this subscription to revoked. Returns count. */
  revokeBySubscription(subscriptionId: string): Promise<number>;
}

export interface EmailSender {
  sendInviteCode(to: string, code: string, plan: string): Promise<void>;
}

export interface WebhookDeps {
  db: WebhookDb;
  email: EmailSender;
  /** Override the code generator for deterministic tests. */
  generateCode?: () => string;
  /** Days until an unredeemed code expires (default 30). */
  codeTtlDays?: number;
  /** Clock override for deterministic tests. */
  now?: () => Date;
}

export interface HandleResult {
  status: number;
  body: Record<string, unknown>;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L

/** Mint a single-use code, e.g. "GORDON-A1B2-C3D4-E5F6". */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  const group = (i: number) => chars.slice(i, i + 4).join("");
  return `GORDON-${group(0)}-${group(4)}-${group(8)}`;
}

export async function handleNormalizedEvent(
  event: NormalizedEvent,
  deps: WebhookDeps,
): Promise<HandleResult> {
  switch (event.kind) {
    case "invalid":
      return { status: 401, body: { error: "Invalid signature", reason: event.reason } };

    case "ignore":
      return { status: 200, body: { ok: true, ignored: event.eventName } };

    case "purchase": {
      const generate = deps.generateCode ?? generateInviteCode;
      const now = (deps.now ?? (() => new Date()))();
      const ttlDays = deps.codeTtlDays ?? 30;
      const expiresAt =
        ttlDays > 0
          ? new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

      const code = generate();
      const row: InviteRow = {
        code,
        label: `paid:${event.email}`,
        max_uses: 1,
        expires_at: expiresAt,
        plan: event.plan,
        subscription_id: event.subscriptionId,
      };

      // If persistence fails the code was never issued, so surface a 500 and
      // let the processor retry. Email failure is non-fatal (the code already
      // exists): we log inside the sender and continue so a retry can't mint a
      // second code.
      await deps.db.insertInviteCode(row);

      let emailed = true;
      try {
        await deps.email.sendInviteCode(event.email, code, event.plan);
      } catch {
        emailed = false;
      }

      return {
        status: 200,
        body: { ok: true, issued: true, plan: event.plan, emailed },
      };
    }

    case "revoke": {
      const revoked = await deps.db.revokeBySubscription(event.subscriptionId);
      return { status: 200, body: { ok: true, revoked } };
    }
  }
}
