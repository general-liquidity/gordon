/**
 * Playbook Engine
 *
 * Markdown-based trading strategy definitions that are simultaneously
 * human-readable, agent-parseable, backtestable, and publishable.
 *
 * Usage:
 *   import {
 *     PlaybookParser,
 *     PlaybookRegistry,
 *     PlaybookLoader,
 *     PlaybookPromptGenerator,
 *     playbookRegistry,
 *   } from "./core/playbooks/index.ts";
 *
 *   // Load all built-in playbooks
 *   const loader = new PlaybookLoader(new PlaybookParser(), playbookRegistry);
 *   await loader.loadBuiltins();
 *
 *   // Get a playbook
 *   const pb = playbookRegistry.get("momentum-breakout");
 *
 *   // Generate a prompt for Scanner
 *   const gen = new PlaybookPromptGenerator();
 *   const scannerPrompt = gen.generateForScanner(pb);
 */

// Types
export type {
  Playbook,
  PlaybookTrigger,
  PlaybookAnalysis,
  PlaybookExecution,
  PlaybookManagement,
  PlaybookReview,
  TriggerCondition,
  ManagementRule,
  StopLossRule,
  TakeProfitRule,
  PositionSizingRule,
  ValidationResult,
  FormattedPlaybook,
  FormattedPlaybookList,
} from "./types.ts";

// Parser
export { PlaybookParser } from "./parser.ts";

// Registry
export { PlaybookRegistry, playbookRegistry } from "./registry.ts";

// Loader
export { PlaybookLoader } from "./loader.ts";

// Prompt Generator
export { PlaybookPromptGenerator } from "./prompt.ts";
