/**
 * Goal-Mandate Linkage — GE2.
 *
 * When a `/goal` is set, stamp the active mandate's path + content
 * hash + snapshot timestamp into the goal state. This gives every
 * future score / progress log an audit trail back to the constraint
 * set the goal was authored against — answers the question "which
 * mandate was in effect when this goal was set?" without ambiguity.
 *
 * Mirrors the article's cross-citation pattern between the goal doc
 * and the rider doc: both reference each other's absolute path, so
 * the pair is verifiable and the round is reproducible.
 *
 * Pure compute. The Mastra wrapper reads the mandate file and passes
 * its contents in.
 */

import { createHash } from "node:crypto";

export const GOAL_MANDATE_LINK_FLAG_ENV = "GORDON_GOAL_MANDATE_LINK";

export function isGoalMandateLinkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GOAL_MANDATE_LINK_FLAG_ENV] === "1" || env[GOAL_MANDATE_LINK_FLAG_ENV] === "true";
}

export interface MandateLink {
  /** Absolute or repo-relative path to the mandate file. */
  path: string;
  /** SHA-256 hex digest of the mandate contents at snapshotAt. */
  sha256: string;
  /** ISO timestamp when the snapshot was taken. */
  snapshotAt: string;
  /** Byte length of the mandate contents (for quick equality check + tamper detection). */
  byteLength: number;
}

export interface LinkGoalToMandateInput {
  /** Mandate file contents (caller reads the file). */
  mandateContent: string;
  /** Path the contents were read from. */
  mandatePath: string;
  /** ISO timestamp for the snapshot. Default: now. */
  snapshotAt?: string;
}

export function linkGoalToMandate(input: LinkGoalToMandateInput): MandateLink {
  if (!input.mandatePath || input.mandatePath.length === 0) {
    throw new Error("mandatePath must not be empty");
  }
  if (typeof input.mandateContent !== "string") {
    throw new Error("mandateContent must be a string");
  }
  const snapshotAt = input.snapshotAt ?? new Date().toISOString();
  // Validate ISO format minimally.
  if (Number.isNaN(Date.parse(snapshotAt))) {
    throw new Error(`snapshotAt must be a valid ISO timestamp (got "${snapshotAt}")`);
  }

  const sha256 = createHash("sha256").update(input.mandateContent, "utf8").digest("hex");
  const byteLength = Buffer.byteLength(input.mandateContent, "utf8");

  return {
    path: input.mandatePath,
    sha256,
    snapshotAt,
    byteLength,
  };
}

/**
 * Compares two mandate links to detect drift. Useful when re-opening a
 * paused goal — has the mandate been edited since the goal was set?
 */
export interface MandateDriftResult {
  pathMatches: boolean;
  contentMatches: boolean;
  drifted: boolean;
  reasoning: string;
}

export function detectMandateDrift(prior: MandateLink, current: MandateLink): MandateDriftResult {
  const pathMatches = prior.path === current.path;
  const contentMatches = prior.sha256 === current.sha256;
  const drifted = !pathMatches || !contentMatches;
  const reasoning = drifted
    ? `mandate ${!pathMatches ? "path" : "content"} changed between ${prior.snapshotAt} and ${current.snapshotAt}` +
      (contentMatches ? "" : ` (sha ${prior.sha256.slice(0, 8)} → ${current.sha256.slice(0, 8)})`)
    : "mandate unchanged since goal was set";
  return { pathMatches, contentMatches, drifted, reasoning };
}

export function mandateLinkToPayload(link: MandateLink): Record<string, unknown> {
  return {
    kind: "goal_mandate_link.computed",
    path: link.path,
    sha256: link.sha256,
    snapshotAt: link.snapshotAt,
    byteLength: link.byteLength,
  };
}
