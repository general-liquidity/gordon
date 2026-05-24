/**
 * FW7 (Tier 2 Rank 1) — Operator-Authored Subagent Profiles.
 *
 * Deep Agents parity: lets operators define ad-hoc subagent roles via
 * config (`.claude/subagents/*.json`) without code deploys. The
 * orchestrator can then call a `task` tool with `{ role, task }` to
 * delegate work to one of these profiles.
 *
 * Gordon's 3-agent topology (gordon/executor/researcher) is hardwired
 * and stays that way — it carries security boundaries. Profile-defined
 * subagents are a SECOND layer: they always inherit researcher-like
 * permissions (read-only, no execution tools), they cannot modify the
 * trade ledger, and the orchestrator decides when to delegate. They
 * are NOT a back door around the deny-list.
 *
 * Trust boundary: a profile-defined subagent is granted at most the
 * intersection of (its declared tools) ∩ (the read-only tool set). The
 * dispatch layer enforces this — see `subagentDispatcher.ts`.
 */
import { z } from "zod";

/**
 * The schema operator config files MUST validate against. Loose enough
 * to support the common case, strict enough to fail loudly on typos.
 *
 * Field naming matches Deep Agents' `AsyncSubAgent` shape where it
 * makes sense. `tools` accepts either explicit tool ids or glob-style
 * patterns; matching is done at dispatch time against the read-only
 * tool registry.
 */
export const SubagentProfileSchema = z.object({
  /** Kebab-case identifier. Must match file basename. */
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      message: "kebab-case only — lowercase letters, digits, single hyphens",
    }),
  /**
   * Human description. Shown to the orchestrator in the `task` tool's
   * schema so the model can pick the right role. Keep it tight — under
   * ~280 chars renders cleanly inside tool descriptions.
   */
  description: z.string().min(1).max(1024),
  /**
   * System prompt body. Concatenated AFTER the read-only base prompt
   * the dispatcher injects — operator content cannot replace the
   * security preamble that establishes "you are read-only," "no
   * trading," etc.
   */
  instructions: z.string().min(1),
  /**
   * Tool whitelist. Each entry is either an exact tool id (e.g.
   * `"scan_market"`) or a glob (e.g. `"finnhub_*"`, `"smc_*"`). The
   * dispatcher resolves these against the read-only tool registry —
   * execution tools (place_order, execute_plan, cancel_*) are NEVER
   * granted, even if listed, even if the glob matches.
   */
  tools: z.array(z.string().min(1)).max(64),
  /**
   * Optional model override in `provider:model` shape (same convention
   * as `GORDON_MODEL_<ROLE>`). When omitted, the dispatcher uses the
   * researcher role's resolved model.
   */
  model: z.string().optional(),
  /**
   * Maximum turns the dispatched subagent is allowed before forced
   * termination. Default 10. Hard ceiling 50.
   */
  maxTurns: z.number().int().min(1).max(50).optional(),
  /**
   * Optional tag list for grouping in /subagents list output. Cosmetic.
   */
  tags: z.array(z.string()).optional(),
  /**
   * Lifecycle status (mirrors the skill governance pattern). When
   * `deprecated` the dispatcher refuses to spawn but the profile still
   * loads (so audit reports can surface it).
   */
  status: z.enum(["active", "experimental", "deprecated"]).optional(),
  /** Operator name for audit reports. Cosmetic. */
  owner: z.string().optional(),
});

export type SubagentProfile = z.infer<typeof SubagentProfileSchema>;

export interface SubagentProfileValidationIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
}

/**
 * Validate a raw object against the SubagentProfile schema. Returns the
 * parsed profile + issues. Errors block loading; warnings advise.
 *
 * Out-of-band rules NOT in the zod schema (because they require config
 * context to evaluate):
 *
 *   - `name` should match the basename of the file the profile came
 *     from. The caller passes `expectedName` if it has one.
 *   - `model` should be parseable via `parseModelOverride()` from
 *     agentHelpers; the loader checks this and warns on malformed
 *     strings without blocking.
 */
export function validateSubagentProfile(
  raw: unknown,
  options: { expectedName?: string } = {},
): { profile?: SubagentProfile; issues: SubagentProfileValidationIssue[] } {
  const issues: SubagentProfileValidationIssue[] = [];

  const parsed = SubagentProfileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        severity: "error",
        field: issue.path.join(".") || "(root)",
        message: issue.message,
      });
    }
    return { issues };
  }

  const profile = parsed.data;

  if (options.expectedName && profile.name !== options.expectedName) {
    issues.push({
      severity: "error",
      field: "name",
      message: `'${profile.name}' does not match expected basename '${options.expectedName}'`,
    });
    return { issues };
  }

  // Soft check: model override format.
  if (profile.model !== undefined && profile.model.length > 0) {
    const colonIdx = profile.model.indexOf(":");
    const looksWrong =
      colonIdx === 0 ||
      colonIdx === profile.model.length - 1 ||
      profile.model.trim().length === 0;
    if (looksWrong) {
      issues.push({
        severity: "warning",
        field: "model",
        message:
          "model override does not look like 'provider:model' — dispatcher will fall back to default",
      });
    }
  }

  return { profile, issues };
}

/**
 * One-line summary for audit reports / /subagents list output.
 */
export function summarizeSubagentProfile(profile: SubagentProfile): string {
  const tags = profile.tags && profile.tags.length > 0 ? ` [${profile.tags.join(",")}]` : "";
  const status = profile.status && profile.status !== "active" ? ` (${profile.status})` : "";
  const tools = `${profile.tools.length} tool${profile.tools.length === 1 ? "" : "s"}`;
  return `${profile.name}${tags}${status} — ${tools}`;
}
