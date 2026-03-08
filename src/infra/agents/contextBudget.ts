import { createHash } from "node:crypto";
import type { GordonConfig } from "../../types/index.ts";
import { GORDON_PRODUCT_TRUTH } from "./capabilityTruth.ts";
import type { GordonContext } from "./types.ts";
import type { IntegrationGlossarySelection } from "./integrationGlossary.ts";

export const PROJECT_TRUTH_MARKER = "[GORDON_PROJECT_TRUTH]";
export const INTEGRATION_GLOSSARY_MARKER = "[GORDON_INTEGRATION_GLOSSARY]";
export const TOOL_CONTEXT_MARKER = "[GORDON_TOOL_CONTEXT]";
export const RUNTIME_STATE_MARKER = "[GORDON_RUNTIME_STATE]";

export interface PromptContextSectionBudget {
  runtimeState: number;
  projectTruth: number;
  glossary: number;
  toolHints: number;
  userMessage: number;
  totalEstimated: number;
}

export interface PromptCacheMetadata {
  supported: boolean;
  provider: string;
  key?: string;
  reason?: string;
}

export interface PromptContextReport {
  threadId: string;
  provider: string;
  model: string | null;
  requestedActionId?: string;
  requestedTaskScope?: string;
  activeIntegrationIds: string[];
  glossaryIds: string[];
  sectionBudget: PromptContextSectionBudget;
  selectionReasons: string[];
  cache: PromptCacheMetadata;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  updatedAt: number;
}

export interface PromptEnvelope {
  prompt: string;
  stablePrefix: string;
  runtimeStateBlock: string;
  projectTruthBlock: string;
  glossaryBlock: string;
  toolHintsBlock: string;
  report: PromptContextReport;
  requestOptions: Record<string, unknown>;
}

const latestReports = new Map<string, PromptContextReport>();

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

function normalizeModel(config: GordonConfig): { provider: string; model: string | null } {
  return {
    provider: config.modelConfig?.provider ?? process.env.GORDON_PROVIDER ?? "unknown",
    model: config.modelConfig?.model ?? process.env.GORDON_MODEL ?? null,
  };
}

function formatRuntimeState(context: GordonContext): string {
  const lines = [
    `- Mode: ${context.config.mode}`,
    `- Credential profile: ${context.credentialProfile ?? "default"}`,
  ];

  if (context.exchange?.exchangeId) {
    lines.push(`- Active execution venue: ${context.exchange.exchangeId}`);
  }
  if (context.broker?.brokerId) {
    lines.push(`- Active broker: ${context.broker.brokerId}`);
  }
  if (context.requestedActionId) {
    lines.push(`- Requested action: ${context.requestedActionId}`);
  }
  if (context.requestedTaskScope) {
    lines.push(`- Requested task scope: ${context.requestedTaskScope}`);
  }

  return `${RUNTIME_STATE_MARKER}\n${lines.join("\n")}`;
}

function formatProjectTruth(): string {
  const lines = [
    ...GORDON_PRODUCT_TRUTH.summaryLines.map((line) => `- ${line}`),
    `- ${GORDON_PRODUCT_TRUTH.discoveryRule}`,
    `- ${GORDON_PRODUCT_TRUTH.venueRule}`,
    ...GORDON_PRODUCT_TRUTH.wordingRules.map((line) => `- ${line}`),
  ];
  return `${PROJECT_TRUTH_MARKER}\n${lines.join("\n")}`;
}

function formatToolHints(toolHints: string[]): string {
  if (toolHints.length === 0) return "";
  return `${TOOL_CONTEXT_MARKER}\n${toolHints.map((hint) => `- ${hint}`).join("\n")}`;
}

function getActiveIntegrationIds(context: GordonContext, selection: IntegrationGlossarySelection): string[] {
  const ids = new Set<string>(selection.matchedIds);
  if (context.exchange?.exchangeId) ids.add(context.exchange.exchangeId);
  if (context.broker?.brokerId) ids.add(context.broker.brokerId);
  const provider = context.config.modelConfig?.provider;
  if (provider) ids.add(provider);
  return [...ids];
}

function getPromptCacheMetadata(
  context: GordonContext,
  stablePrefix: string,
): PromptCacheMetadata {
  const provider = context.config.modelConfig?.provider ?? process.env.GORDON_PROVIDER ?? "unknown";

  if (provider !== "openai") {
    return {
      supported: false,
      provider,
      reason: "Prompt-cache key hooks are only enabled on the native OpenAI path.",
    };
  }

  const hash = createHash("sha256")
    .update(stablePrefix)
    .digest("hex")
    .slice(0, 32);

  return {
    supported: true,
    provider,
    key: `gordon:${hash}`,
  };
}

function buildReport(
  context: GordonContext,
  selection: IntegrationGlossarySelection,
  blocks: {
    runtimeStateBlock: string;
    projectTruthBlock: string;
    glossaryBlock: string;
    toolHintsBlock: string;
  },
  userMessage: string,
): PromptContextReport {
  const model = normalizeModel(context.config);
  const sectionBudget: PromptContextSectionBudget = {
    runtimeState: estimateTokens(blocks.runtimeStateBlock),
    projectTruth: estimateTokens(blocks.projectTruthBlock),
    glossary: estimateTokens(blocks.glossaryBlock),
    toolHints: estimateTokens(blocks.toolHintsBlock),
    userMessage: estimateTokens(userMessage),
    totalEstimated: 0,
  };
  sectionBudget.totalEstimated =
    sectionBudget.runtimeState +
    sectionBudget.projectTruth +
    sectionBudget.glossary +
    sectionBudget.toolHints +
    sectionBudget.userMessage;

  const stablePrefix = [blocks.runtimeStateBlock, blocks.projectTruthBlock, blocks.glossaryBlock, blocks.toolHintsBlock]
    .filter(Boolean)
    .join("\n\n");

  return {
    threadId: context.threadId || "default",
    provider: model.provider,
    model: model.model,
    requestedActionId: context.requestedActionId,
    requestedTaskScope: context.requestedTaskScope,
    activeIntegrationIds: getActiveIntegrationIds(context, selection),
    glossaryIds: selection.matchedIds,
    sectionBudget,
    selectionReasons: selection.reasons,
    cache: getPromptCacheMetadata(context, stablePrefix),
    updatedAt: Date.now(),
  };
}

export function buildPromptEnvelope(
  userMessage: string,
  context: GordonContext,
  selection: IntegrationGlossarySelection,
  glossaryText: string,
): PromptEnvelope {
  const runtimeStateBlock = formatRuntimeState(context);
  const projectTruthBlock = formatProjectTruth();
  const glossaryBlock = glossaryText
    ? `${INTEGRATION_GLOSSARY_MARKER}\n${glossaryText}`
    : "";
  const toolHintsBlock = formatToolHints(selection.toolHints);

  const stablePrefix = [runtimeStateBlock, projectTruthBlock, glossaryBlock, toolHintsBlock]
    .filter(Boolean)
    .join("\n\n");
  const prompt = `${stablePrefix}\n\n[USER_REQUEST]\n${userMessage}`;
  const report = buildReport(
    context,
    selection,
    { runtimeStateBlock, projectTruthBlock, glossaryBlock, toolHintsBlock },
    userMessage,
  );

  latestReports.set(report.threadId, report);

  const requestOptions: Record<string, unknown> = {};
  if (report.cache.supported && report.cache.key) {
    requestOptions.promptCacheKey = report.cache.key;
  }

  return {
    prompt,
    stablePrefix,
    runtimeStateBlock,
    projectTruthBlock,
    glossaryBlock,
    toolHintsBlock,
    report,
    requestOptions,
  };
}

export function attachUsageToPromptReport(
  threadId: string | undefined,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
): void {
  const key = threadId || "default";
  const current = latestReports.get(key);
  if (!current) return;
  latestReports.set(key, {
    ...current,
    usage,
    updatedAt: Date.now(),
  });
}

export function getLatestPromptContextReport(threadId?: string): PromptContextReport | null {
  return latestReports.get(threadId || "default") ?? null;
}

export function clearPromptContextReports(): void {
  latestReports.clear();
}

export function formatPromptContextReport(report: PromptContextReport | null): string {
  if (!report) {
    return "No prompt/context report is available for this session yet.";
  }

  const cacheLine = report.cache.supported
    ? `Enabled (${report.cache.key})`
    : `Unavailable (${report.cache.reason ?? "unsupported"})`;
  const usageLine = report.usage
    ? `${report.usage.promptTokens} prompt / ${report.usage.completionTokens} completion / ${report.usage.totalTokens} total`
    : "No provider usage reported yet.";

  const lines = [
    "**Prompt Context Report**",
    "",
    `Thread: \`${report.threadId}\``,
    `Model: ${report.provider}${report.model ? ` · ${report.model}` : ""}`,
    `Action: ${report.requestedActionId ?? "none"}${report.requestedTaskScope ? ` (${report.requestedTaskScope})` : ""}`,
    `Prompt cache: ${cacheLine}`,
    `Latest provider usage: ${usageLine}`,
    "",
    "| Section | Estimated tokens |",
    "| --- | ---: |",
    `| Runtime state | ${report.sectionBudget.runtimeState} |`,
    `| Project truth | ${report.sectionBudget.projectTruth} |`,
    `| Integration glossary | ${report.sectionBudget.glossary} |`,
    `| Tool hints | ${report.sectionBudget.toolHints} |`,
    `| User request | ${report.sectionBudget.userMessage} |`,
    `| Total estimated | ${report.sectionBudget.totalEstimated} |`,
    "",
    `Active integration IDs: ${report.activeIntegrationIds.join(", ") || "none"}`,
    `Glossary slice: ${report.glossaryIds.join(", ") || "none"}`,
  ];

  if (report.selectionReasons.length > 0) {
    lines.push("");
    lines.push("Selection reasons:");
    for (const reason of report.selectionReasons) {
      lines.push(`- ${reason}`);
    }
  }

  lines.push("");
  lines.push("Compaction policy:");
  lines.push("- Stable project truth and integration glossary grounding are rebuilt on every turn.");
  lines.push("- They sit outside conversation summaries and are preserved even if chat history is compacted.");

  return lines.join("\n");
}
