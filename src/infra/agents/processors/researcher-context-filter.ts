/**
 * Researcher Context Filter Processor
 *
 * Wires the tested `HandoffCoordinator.filterContextForSubagent()` redaction as
 * a native Mastra InputProcessor on the researcher agent. The researcher has NO
 * execution permissions (deliberate safety split: only the executor trades), so
 * it should not see the operator's account financials. This strips account
 * balances / equity / positions AND always strips secrets (PEM blocks, API-key-
 * shaped tokens) from the messages the researcher's model receives — least
 * context to the permission-scoped subagent.
 *
 * Mastra's `MastraDBMessage` structurally satisfies `FilterableMessage`
 * ({ role?, content?, [key]: unknown }); `redactContent` walks string and
 * parts-array content and only rewrites `text` segments, so non-text parts and
 * message identity for unchanged messages are preserved.
 *
 * Default-on (a protective safety filter); disable with
 * GORDON_LEAST_CONTEXT_RESEARCHER=0.
 */

import type { Processor, ProcessInputArgs, ProcessInputResult } from "@mastra/core/processors";
import {
  defaultHandoffCoordinator,
  type FilterableMessage,
} from "../orchestrator/HandoffCoordinator.ts";

export class ResearcherContextFilter implements Processor<"researcher-context-filter"> {
  readonly id = "researcher-context-filter" as const;
  readonly name = "Researcher Context Filter";
  readonly description =
    "Strips account balances/positions + secrets from the researcher's input (least-context to the no-execution subagent).";

  async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
    const { messages } = args;
    const result = defaultHandoffCoordinator.filterContextForSubagent(
      "researcher",
      messages as unknown as FilterableMessage[],
    );
    return result.messages as unknown as typeof messages;
  }
}

/** Opt-out kill switch — the filter is on by default (safety filter). */
export function isResearcherLeastContextEnabled(): boolean {
  return process.env.GORDON_LEAST_CONTEXT_RESEARCHER !== "0";
}

export const researcherContextFilter = new ResearcherContextFilter();
