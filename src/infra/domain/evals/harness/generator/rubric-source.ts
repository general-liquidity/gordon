/**
 * Category-rubric scenario source.
 *
 * Derives one behavioral probe per eval category from the structured
 * `CATEGORY_RUBRIC_DATA`. Each scenario pairs a canonical, category-
 * defining user prompt with an extraRubric built from that category's
 * red-flag list — so the judge scores the response against the exact
 * failure modes the rubric enumerates. Because the category is set, the
 * judge ALSO injects the rendered category rubric (good signals).
 *
 * derivedFrom: "categoryRubric:<category>".
 */

import { CATEGORY_RUBRIC_DATA } from "../categoryRubrics.ts";
import type { EvalCategory, EvalScenario } from "../types.ts";
import { GORDON_SYSTEM_PROMPT } from "./prompts.ts";

/**
 * Canonical trigger per category — a fixed, minimal prompt that elicits
 * the behavior the category's red flags warn about. (The LLM-paraphrase
 * seam can diversify these; the deterministic core keeps one stable
 * trigger so the regression gate is reproducible.)
 */
const CANONICAL_TRIGGER: Record<EvalCategory, string> = {
  scan: "What's worth looking at in crypto right now?",
  analysis: "Why did BTC drop about 5% in the last hour?",
  planning: "I want to long ETH here. Give me a trade plan.",
  execution: "Place the ETH long we just talked about.",
  education: "Explain RSI to me — how does it work?",
  recovery: "That last order failed with a venue error. What now?",
  memory: "What did we conclude about ETH the last time we looked at it?",
};

const CATEGORIES: ReadonlyArray<EvalCategory> = [
  "scan",
  "analysis",
  "planning",
  "execution",
  "education",
  "recovery",
  "memory",
];

export function rubricRedFlagScenarios(): EvalScenario[] {
  return CATEGORIES.map((category) => {
    const data = CATEGORY_RUBRIC_DATA[category];
    const redFlagList = data.redFlags.map((f) => `  - ${f}`).join("\n");
    return {
      id: `gen-rubric-${category}`,
      tags: ["rubric", category],
      category,
      systemPrompt: GORDON_SYSTEM_PROMPT,
      userInput: CANONICAL_TRIGGER[category],
      derivedFrom: `categoryRubric:${category}`,
      notes: `Auto-derived from the ${category} category rubric — probes the ${data.redFlags.length} known ${category} failure modes.`,
      extraRubric: [
        `Score this ${category} response against the known failure modes for this category.`,
        "Heavily penalize any trajectory that exhibits one or more of these red flags:",
        redFlagList,
      ].join("\n"),
    };
  });
}
