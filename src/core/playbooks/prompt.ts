/**
 * Playbook-to-Agent Prompt Generator
 *
 * Converts a structured Playbook into concise text fragments that can be
 * injected into agent prompts. Each method targets a specific agent in
 * Gordon's network (Scanner, Analyst, Planner, Monitor, Teacher).
 *
 * Design goals:
 * - Keep output compact to avoid bloating agent context windows
 * - Use structured Markdown for readability by both agents and humans
 * - Include only the information relevant to each agent's role
 */

import type { Playbook } from "./types.ts";

// ============================================================================
// PlaybookPromptGenerator
// ============================================================================

/**
 * Generates agent-specific prompt text from a Playbook.
 */
export class PlaybookPromptGenerator {
  /**
   * Generate text for the Scanner agent.
   * Contains trigger conditions the Scanner should watch for.
   *
   * @param playbook - Source playbook
   * @returns Prompt fragment for Scanner
   */
  generateForScanner(playbook: Playbook): string {
    const lines: string[] = [
      `### Playbook: ${playbook.name}`,
      "",
      `Watch for these conditions on ${playbook.timeframes.join(", ")}:`,
    ];

    for (const cond of playbook.trigger.conditions) {
      lines.push(`- ${cond.description}`);
    }

    if (playbook.symbols && playbook.symbols.length > 0) {
      lines.push("");
      lines.push(`Priority symbols: ${playbook.symbols.join(", ")}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate text for the Analyst agent.
   * Contains validation and invalidation criteria.
   *
   * @param playbook - Source playbook
   * @returns Prompt fragment for Analyst
   */
  generateForAnalyst(playbook: Playbook): string {
    const lines: string[] = [
      `### Playbook: ${playbook.name}`,
      "",
    ];

    if (playbook.analysis.validationCriteria.length > 0) {
      lines.push("Validate:");
      for (const c of playbook.analysis.validationCriteria) {
        lines.push(`- ${c}`);
      }
    }

    if (playbook.analysis.invalidationCriteria.length > 0) {
      lines.push("");
      lines.push("Invalidate if:");
      for (const c of playbook.analysis.invalidationCriteria) {
        lines.push(`- ${c}`);
      }
    }

    if (playbook.analysis.requiredIndicators.length > 0) {
      lines.push("");
      lines.push(
        `Required indicators: ${playbook.analysis.requiredIndicators.join(", ")}`
      );
    }

    return lines.join("\n");
  }

  /**
   * Generate text for the Planner agent.
   * Contains execution rules (entry, stop, target, sizing).
   *
   * @param playbook - Source playbook
   * @returns Prompt fragment for Planner
   */
  generateForPlanner(playbook: Playbook): string {
    const exec = playbook.execution;
    const lines: string[] = [
      `### Playbook: ${playbook.name}`,
      "",
      `Entry: ${exec.entryDescription || exec.entryType + " order"}`,
      `Stop Loss: ${exec.stopLoss.description || exec.stopLoss.type}`,
      `Take Profit: ${exec.takeProfit.description || "See management rules"}`,
      `Position Sizing: ${exec.positionSizing.description || "Default sizing"}`,
    ];

    if (exec.takeProfit.riskRewardRatio) {
      lines.push(`Minimum R:R: ${exec.takeProfit.riskRewardRatio}:1`);
    }

    if (exec.positionSizing.riskPercent) {
      lines.push(`Risk per trade: ${exec.positionSizing.riskPercent}%`);
    }

    lines.push("");
    lines.push(`Risk level: ${playbook.riskLevel}`);

    return lines.join("\n");
  }

  /**
   * Generate text for the Monitor agent.
   * Contains trade management rules in execution order.
   *
   * @param playbook - Source playbook
   * @returns Prompt fragment for Monitor
   */
  generateForMonitor(playbook: Playbook): string {
    const lines: string[] = [
      `### Playbook: ${playbook.name}`,
      "",
      "Management rules (execute in order):",
    ];

    for (let i = 0; i < playbook.management.rules.length; i++) {
      const rule = playbook.management.rules[i]!;
      lines.push(`${i + 1}. ${rule.description}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate text for the Teacher agent.
   * Contains review criteria and scoring factors.
   *
   * @param playbook - Source playbook
   * @returns Prompt fragment for Teacher
   */
  generateForTeacher(playbook: Playbook): string {
    const lines: string[] = [
      `### Playbook: ${playbook.name}`,
      "",
    ];

    if (playbook.review.criteria.length > 0) {
      lines.push("Evaluate:");
      for (const c of playbook.review.criteria) {
        lines.push(`- ${c}`);
      }
    }

    if (playbook.review.scoringFactors.length > 0) {
      lines.push("");
      lines.push("Score based on:");
      for (const f of playbook.review.scoringFactors) {
        lines.push(`- ${f}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate a full human-readable summary of the playbook.
   * Suitable for display in the terminal or chat.
   *
   * @param playbook - Source playbook
   * @returns Formatted summary string
   */
  generateSummary(playbook: Playbook): string {
    const lines: string[] = [
      `# ${playbook.name}`,
      "",
      playbook.description,
      "",
      `Tier: ${playbook.tier} | Risk: ${playbook.riskLevel} | Markets: ${playbook.markets.join(", ")}`,
      `Timeframes: ${playbook.timeframes.join(", ")}`,
    ];

    if (playbook.symbols && playbook.symbols.length > 0) {
      lines.push(`Symbols: ${playbook.symbols.join(", ")}`);
    }

    lines.push("");
    lines.push("## Trigger");
    for (const cond of playbook.trigger.conditions) {
      lines.push(`- ${cond.description}`);
    }

    lines.push("");
    lines.push("## Execution");
    lines.push(`Entry: ${playbook.execution.entryDescription || playbook.execution.entryType}`);
    lines.push(`Stop: ${playbook.execution.stopLoss.description}`);
    lines.push(`Target: ${playbook.execution.takeProfit.description}`);
    lines.push(`Sizing: ${playbook.execution.positionSizing.description}`);

    if (playbook.management.rules.length > 0) {
      lines.push("");
      lines.push("## Management");
      for (let i = 0; i < playbook.management.rules.length; i++) {
        lines.push(`${i + 1}. ${playbook.management.rules[i]!.description}`);
      }
    }

    if (playbook.tags.length > 0) {
      lines.push("");
      lines.push(`Tags: ${playbook.tags.join(", ")}`);
    }

    return lines.join("\n");
  }
}
