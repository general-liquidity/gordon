/**
 * FW7 Patch 2 — Built-in general-purpose subagent fallback.
 *
 * Deep Agents auto-includes a general-purpose subagent so the `task` tool
 * is always usable, even when the operator hasn't authored any custom
 * profiles. Mirrored here.
 *
 * Activation rules:
 *
 *   - When operator profiles exist (`.claude/subagents/*.json` loaded
 *     successfully): general-purpose is NOT auto-added. The operator
 *     has expressed an opinion about what roles exist; respect it.
 *   - When operator profiles are empty AND `GORDON_DYNAMIC_SUBAGENTS=1`:
 *     general-purpose is auto-added so the tool isn't dead-on-arrival.
 *   - In either case, the operator can opt out via
 *     `GORDON_DYNAMIC_SUBAGENTS_NO_GP=1` (defensible when a downstream
 *     fork wants to fully own the role catalog).
 *
 * The fallback uses a deliberately broad tool whitelist (`*`) — the
 * tool filter will drop execution tools (the entire deny-list applies
 * regardless of what `tools` says). Net effect: every non-execution
 * tool the orchestrator can see is available to the general-purpose
 * subagent, which matches the "general-purpose" intent.
 *
 * Why kebab-case `general-purpose` (not `generalPurpose`): consistent
 * with the SubagentProfile name pattern + Deep Agents' convention.
 */

import type { SubagentProfile } from "./subagentProfile.ts";

export const GENERAL_PURPOSE_PROFILE_NAME = "general-purpose";

const GENERAL_PURPOSE_INSTRUCTIONS = `You are Gordon's general-purpose research subagent.

You handle delegations that don't fit a specialist profile. The orchestrator
picked you because no narrower role matched. Cover the full read-only
toolset and return a focused answer.

## Guidelines
- Identify the user's actual question before tool-calling.
- Use parallel tool calls when querying multiple symbols / sources.
- Prefer fewer high-signal tools over many low-signal ones.
- Return a concise, structured answer with the key numbers / verdicts.
- If the task implies execution (placing trades, moving funds), refuse
  and explain — your toolset cannot execute, and that boundary is
  intentional.`;

export const GENERAL_PURPOSE_PROFILE: SubagentProfile = {
  name: GENERAL_PURPOSE_PROFILE_NAME,
  description:
    "Catch-all research subagent. Handles arbitrary read-only delegations that don't match a specialist role. Has access to the full read-only tool set (market scans, news, finnhub, skills, memory, on-chain reads).",
  instructions: GENERAL_PURPOSE_INSTRUCTIONS,
  // Broad whitelist — the dispatcher's deny-list drops execution tools
  // regardless of what's listed here. So `*` resolves to "every non-
  // execution tool the orchestrator owns."
  tools: ["*"],
  maxTurns: 15,
  status: "active",
  owner: "builtin",
  tags: ["builtin", "fallback"],
};

/**
 * Gate flag — opt OUT of the auto-include. Default behavior is to
 * include general-purpose when operator profiles are empty.
 */
export function isGeneralPurposeDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.GORDON_DYNAMIC_SUBAGENTS_NO_GP;
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Returns the operator-loaded profiles, with the built-in
 * general-purpose profile injected when:
 *
 *   (a) operator has zero profiles, AND
 *   (b) operator hasn't disabled the fallback via env.
 *
 * When operator profiles exist OR the fallback is disabled, returns
 * the input map unchanged. Callers should treat the result as the
 * canonical "what subagents does this Gordon session expose" registry.
 *
 * Pure function — does not mutate the input.
 */
export function applyGeneralPurposeFallback(
  operatorProfiles: ReadonlyMap<string, SubagentProfile>,
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyMap<string, SubagentProfile> {
  if (operatorProfiles.size > 0) return operatorProfiles;
  if (isGeneralPurposeDisabled(env)) return operatorProfiles;
  const merged = new Map(operatorProfiles);
  merged.set(GENERAL_PURPOSE_PROFILE_NAME, GENERAL_PURPOSE_PROFILE);
  return merged;
}
