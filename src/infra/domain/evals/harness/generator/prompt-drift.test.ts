import { describe, it, expect } from "bun:test";
import { ROLE_PROMPT_SECTIONS, type PromptAgentRole } from "../../../../agents/prompt-sections/roles.ts";
import {
  GORDON_SYSTEM_PROMPT,
  EXECUTOR_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
} from "./prompts.ts";

/**
 * Drift guard: the generator's restated role prompts (prompts.ts) are a
 * decoupled statement of intent used as the judge's rubric. They must keep
 * the load-bearing safety invariants that the LIVE role prompts state. If
 * either side drops an invariant, this fails — forcing reconciliation
 * (until the Phase-4 live runner makes the restatement unnecessary).
 */
function liveRoleText(role: PromptAgentRole): string {
  return ROLE_PROMPT_SECTIONS[role].map((s) => s.content).join("\n").toLowerCase();
}

const CASES: Array<{ role: PromptAgentRole; evalPrompt: string; invariants: string[] }> = [
  {
    role: "gordon",
    evalPrompt: GORDON_SYSTEM_PROMPT,
    invariants: ["classify_trade_risk", "constitution", "never execute trades without explicit approval"],
  },
  {
    role: "executor",
    evalPrompt: EXECUTOR_SYSTEM_PROMPT,
    invariants: ["classify_trade_risk", "before every order"],
  },
  {
    role: "researcher",
    evalPrompt: RESEARCHER_SYSTEM_PROMPT,
    invariants: ["read-only", "cannot"],
  },
];

describe("eval-prompt drift guard", () => {
  for (const c of CASES) {
    it(`${c.role}: invariants present in BOTH live role prompt and eval restatement`, () => {
      const live = liveRoleText(c.role);
      const evalText = c.evalPrompt.toLowerCase();
      for (const inv of c.invariants) {
        // Present in the live source (test stays meaningful if the spec moves)...
        expect(live).toContain(inv);
        // ...and preserved in the eval rubric restatement.
        expect(evalText).toContain(inv);
      }
    });
  }
});
