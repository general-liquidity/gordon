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
 *   } from "./index.ts";
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
 *
 *   // Validate against the formal protocol
 *   import { validatePlaybook } from "./index.ts";
 *   import { playbookToProtocol } from "./index.ts";
 *   const protocol = playbookToProtocol(pb);
 *   const result = validatePlaybook(protocol);
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

// Protocol (formal schema & types)
export {
  PLAYBOOK_PROTOCOL_VERSION,
  PlaybookProtocolSchema,
  TierEnum,
  TimeframeEnum,
  RegimeEnum,
  StopLossTypeEnum,
  OrderTypeEnum,
  EntryMethodEnum,
  LicenseEnum,
  IndicatorSchema,
  EntrySchema,
  ExitSchema,
  RiskSchema,
  ExecutionSchema,
  PerformanceSchema,
  LineageSchema,
} from "./protocol.ts";
export type { PlaybookProtocol } from "./protocol.ts";

// Validator
export { validatePlaybook } from "./validator.ts";
export type { ProtocolValidationResult } from "./validator.ts";

// Converters
export {
  markdownToProtocol,
  playbookToProtocol,
  protocolToMarkdown,
  protocolToJSON,
  jsonToProtocol,
} from "./converter.ts";

// Protocol Agent Tools
export {
  validatePlaybookTool,
  exportPlaybookTool,
  importPlaybookTool,
  comparePlaybooksTool,
  protocolTools,
} from "./protocol-tools.ts";

// Scenario-contingency plan + deterministic trigger resolver
export {
  resolveContingency,
  validateContingencyPlan,
  formatContingencyResolution,
} from "./contingency.ts";
export type {
  BranchName,
  TriggerOperator,
  ContingencyTrigger,
  AllocationLeg,
  ContingencyBranch,
  ContingencyPlan,
  MarketReading,
  TriggerEvaluation,
  BranchEvaluation,
  ContingencyResolution,
  ContingencyValidationResult,
} from "./contingency.ts";
