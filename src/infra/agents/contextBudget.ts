import { createHash } from "node:crypto";
import type { GordonConfig } from "../../types/index.ts";
import { GORDON_PRODUCT_TRUTH } from "./capabilityTruth.ts";
import { buildEventDrivenReminders, getExecutionReadiness } from "./runtimeHarness.ts";
import type { GordonContext } from "./types.ts";
import type { IntegrationGlossarySelection } from "./integrationGlossary.ts";
import { determineWorkflowPhase } from "./workflowPhase.ts";
import { composeRuntimePromptSections } from "./promptSections.ts";

export const PROJECT_TRUTH_MARKER = "[GORDON_PROJECT_TRUTH]";
export const INTEGRATION_GLOSSARY_MARKER = "[GORDON_INTEGRATION_GLOSSARY]";
export const TOOL_CONTEXT_MARKER = "[GORDON_TOOL_CONTEXT]";
export const RUNTIME_STATE_MARKER = "[GORDON_RUNTIME_STATE]";
export const PHASE_GUIDANCE_MARKER = "[GORDON_PHASE_GUIDANCE]";
export const REMINDER_MARKER = "[GORDON_RUNTIME_REMINDERS]";

export type PromptContextPieceKind =
  | "runtime_state"
  | "project_truth"
  | "integration_glossary"
  | "tool_hints"
  | "phase_guidance"
  | "runtime_reminders"
  | "transcript_repair"
  | "planning_handoff";

export interface PromptContextPiece {
  id: string;
  kind: PromptContextPieceKind;
  source: string;
  stable: boolean;
  priority: number;
  content: string;
  tokenEstimate: number;
}

export interface AdditionalPromptContextSection {
  id?: string;
  kind: PromptContextPieceKind;
  source: string;
  stable?: boolean;
  priority?: number;
  content: string;
}

export interface PromptContextSectionBudget {
  runtimeState: number;
  projectTruth: number;
  glossary: number;
  toolHints: number;
  phaseGuidance: number;
  reminders: number;
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
  workflowPhase: string;
  executionReadiness: "ready" | "blocked" | "not_applicable";
  cache: PromptCacheMetadata;
  contextPieces: Array<{
    id: string;
    kind: PromptContextPieceKind;
    source: string;
    stable: boolean;
    tokenEstimate: number;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cumulativeUsage?: {
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    updatedAt: string;
  };
  updatedAt: number;
}

export interface AnthropicCacheBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface GroundedPromptMessage {
  role: "system" | "user";
  content: string;
  providerOptions?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
  experimental_providerMetadata?: Record<string, unknown>;
}

export interface PromptEnvelope {
  prompt: string;
  stablePrefix: string;
  runtimeStateBlock: string;
  projectTruthBlock: string;
  glossaryBlock: string;
  toolHintsBlock: string;
  dynamicContextBlock: string;
  contextPieces: PromptContextPiece[];
  report: PromptContextReport;
  requestOptions: Record<string, unknown>;
  messages: GroundedPromptMessage[];
  /** Anthropic-specific system blocks with cache_control for prompt caching. Only populated for Anthropic providers. */
  anthropicSystemBlocks?: AnthropicCacheBlock[];
}

const latestReports = new Map<string, PromptContextReport>();

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

function buildContextPiece(
  id: string,
  kind: PromptContextPieceKind,
  source: string,
  stable: boolean,
  priority: number,
  content: string,
): PromptContextPiece {
  return {
    id,
    kind,
    source,
    stable,
    priority,
    content,
    tokenEstimate: estimateTokens(content),
  };
}

function normalizeModel(config: GordonConfig): { provider: string; model: string | null } {
  return {
    provider: config.modelConfig?.provider ?? process.env.GORDON_PROVIDER ?? "unknown",
    model: config.modelConfig?.model ?? process.env.GORDON_MODEL ?? null,
  };
}

function formatRuntimeState(context: GordonContext): string {
  const workflowPhase = determineWorkflowPhase(context);
  const executionReadiness = getExecutionReadiness(context);
  const lines = [
    `- Mode: ${context.config.mode}`,
    `- Credential profile: ${context.credentialProfile ?? "default"}`,
    `- Workflow phase: ${workflowPhase}`,
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
  if (workflowPhase === "execution") {
    lines.push(`- Execution readiness: ${executionReadiness.ready ? "ready" : executionReadiness.reason ?? "blocked"}`);
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

function formatPhaseGuidance(context: GordonContext): string {
  const workflowPhase = determineWorkflowPhase(context);
  const guidance = buildEventDrivenReminders(context, workflowPhase).slice(0, 3);
  return `${PHASE_GUIDANCE_MARKER}\n- Current workflow phase: ${workflowPhase}\n${guidance.map((line) => `- ${line}`).join("\n")}`;
}

function formatRuntimeReminders(context: GordonContext): string {
  const reminders = buildEventDrivenReminders(context, determineWorkflowPhase(context));
  if (reminders.length === 0) {
    return "";
  }
  return `${REMINDER_MARKER}\n${reminders.map((line) => `- ${line}`).join("\n")}`;
}

function getActiveIntegrationIds(context: GordonContext, selection: IntegrationGlossarySelection): string[] {
  const ids = new Set<string>(selection.matchedIds);
  if (context.exchange?.exchangeId) ids.add(context.exchange.exchangeId);
  if (context.broker?.brokerId) ids.add(context.broker.brokerId);
  const provider = context.config.modelConfig?.provider;
  if (provider) ids.add(provider);
  return [...ids];
}

function isAnthropicProvider(provider: string): boolean {
  return provider === "anthropic" || provider.includes("anthropic") || provider === "claude";
}

function getPromptCacheMetadata(
  context: GordonContext,
  stablePrefix: string,
): PromptCacheMetadata {
  const provider = context.config.modelConfig?.provider ?? process.env.GORDON_PROVIDER ?? "unknown";

  if (isAnthropicProvider(provider)) {
    // Anthropic caches by content automatically — we just need to mark the cache boundary
    return {
      supported: true,
      provider,
      key: "anthropic-stable-prefix",
    };
  }

  if (provider !== "openai") {
    return {
      supported: false,
      provider,
      reason: "Prompt-cache key hooks are only enabled on the native OpenAI and Anthropic paths.",
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

/**
 * Build Anthropic system content blocks with cache_control for prompt caching.
 * Places a single cache breakpoint at the boundary between stable and dynamic content.
 *
 * Pass the result as the `system` parameter to Anthropic API calls when provider is Anthropic.
 * This gives ~88% cost reduction on the stable portion after the first call.
 */
export function buildAnthropicCacheControlBlocks(envelope: PromptEnvelope): AnthropicCacheBlock[] {
  const blocks: AnthropicCacheBlock[] = [];

  if (envelope.stablePrefix.trim()) {
    // Add cache_control on the stable prefix — this is the cache breakpoint
    blocks.push({
      type: "text",
      text: envelope.stablePrefix,
      cache_control: { type: "ephemeral" },
    });
  }

  if (envelope.dynamicContextBlock.trim()) {
    // Dynamic block is NOT cached — it changes every request
    blocks.push({
      type: "text",
      text: envelope.dynamicContextBlock,
    });
  }

  return blocks;
}

function buildReport(
  context: GordonContext,
  selection: IntegrationGlossarySelection,
  contextPieces: PromptContextPiece[],
  userMessage: string,
): PromptContextReport {
  const workflowPhase = determineWorkflowPhase(context);
  const executionReadiness = getExecutionReadiness(context);
  const model = normalizeModel(context.config);
  const runtimeStateBlock = contextPieces.find((piece) => piece.kind === "runtime_state")?.content ?? "";
  const projectTruthBlock = contextPieces.find((piece) => piece.kind === "project_truth")?.content ?? "";
  const glossaryBlock = contextPieces.find((piece) => piece.kind === "integration_glossary")?.content ?? "";
  const toolHintsBlock = contextPieces.find((piece) => piece.kind === "tool_hints")?.content ?? "";
  const phaseGuidanceBlock = contextPieces.find((piece) => piece.kind === "phase_guidance")?.content ?? "";
  const reminderBlock = contextPieces.find((piece) => piece.kind === "runtime_reminders")?.content ?? "";
  const sectionBudget: PromptContextSectionBudget = {
    runtimeState: estimateTokens(runtimeStateBlock),
    projectTruth: estimateTokens(projectTruthBlock),
    glossary: estimateTokens(glossaryBlock),
    toolHints: estimateTokens(toolHintsBlock),
    phaseGuidance: estimateTokens(phaseGuidanceBlock),
    reminders: estimateTokens(reminderBlock),
    userMessage: estimateTokens(userMessage),
    totalEstimated: 0,
  };
  sectionBudget.totalEstimated =
    sectionBudget.runtimeState +
    sectionBudget.projectTruth +
    sectionBudget.glossary +
    sectionBudget.toolHints +
    sectionBudget.phaseGuidance +
    sectionBudget.reminders +
    sectionBudget.userMessage;

  const stablePrefix = contextPieces
    .filter((piece) => piece.stable)
    .sort((a, b) => a.priority - b.priority)
    .map((piece) => piece.content)
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
    workflowPhase,
    executionReadiness: workflowPhase === "execution"
      ? (executionReadiness.ready ? "ready" : "blocked")
      : "not_applicable",
    cache: getPromptCacheMetadata(context, stablePrefix),
    contextPieces: contextPieces.map((piece) => ({
      id: piece.id,
      kind: piece.kind,
      source: piece.source,
      stable: piece.stable,
      tokenEstimate: piece.tokenEstimate,
    })),
    updatedAt: Date.now(),
  };
}

export function buildPromptEnvelope(
  userMessage: string,
  context: GordonContext,
  selection: IntegrationGlossarySelection,
  glossaryText: string,
  options: {
    additionalSections?: AdditionalPromptContextSection[];
  } = {},
): PromptEnvelope {
  const runtimeStateBlock = formatRuntimeState(context);
  const projectTruthBlock = formatProjectTruth();
  const glossaryBlock = glossaryText
    ? `${INTEGRATION_GLOSSARY_MARKER}\n${glossaryText}`
    : "";
  const toolHintsBlock = formatToolHints(selection.toolHints);
  const phaseGuidanceBlock = formatPhaseGuidance(context);
  const reminderBlock = formatRuntimeReminders(context);

  const contextPieces: PromptContextPiece[] = [
    buildContextPiece("runtime-state", "runtime_state", "runtime", true, 10, runtimeStateBlock),
    buildContextPiece("project-truth", "project_truth", "product-truth", true, 20, projectTruthBlock),
    buildContextPiece("integration-glossary", "integration_glossary", "glossary", true, 30, glossaryBlock),
    buildContextPiece("tool-hints", "tool_hints", "tool-routing", true, 40, toolHintsBlock),
    buildContextPiece("phase-guidance", "phase_guidance", "workflow-phase", false, 50, phaseGuidanceBlock),
    buildContextPiece("runtime-reminders", "runtime_reminders", "runtime-harness", false, 60, reminderBlock),
    ...(options.additionalSections ?? []).map((section, index) =>
      buildContextPiece(
        section.id ?? `${section.kind}-${index + 1}`,
        section.kind,
        section.source,
        section.stable ?? false,
        section.priority ?? 100 + index,
        section.content,
      ),
    ),
    ...composeRuntimePromptSections(context).map((section) =>
      buildContextPiece(
        section.id,
        "phase_guidance",
        "prompt-section-registry",
        section.stable,
        section.priority,
        section.content,
      )
    ),
  ].filter((piece) => piece.content.trim().length > 0);

  const stablePrefix = contextPieces
    .filter((piece) => piece.stable)
    .sort((a, b) => a.priority - b.priority)
    .map((piece) => piece.content)
    .join("\n\n");
  const dynamicContextBlock = contextPieces
    .filter((piece) => !piece.stable)
    .sort((a, b) => a.priority - b.priority)
    .map((piece) => piece.content)
    .join("\n\n");
  const prompt = [stablePrefix, dynamicContextBlock, `[USER_REQUEST]\n${userMessage}`]
    .filter(Boolean)
    .join("\n\n");
  const report = buildReport(context, selection, contextPieces, userMessage);

  latestReports.set(report.threadId, report);

  const requestOptions: Record<string, unknown> = {};
  if (report.cache.supported && report.cache.key) {
    requestOptions.promptCacheKey = report.cache.key;
  }

  const providerOptions = report.cache.key === "anthropic-stable-prefix"
    ? { anthropic: { cacheControl: { type: "ephemeral" as const } } }
    : undefined;

  const messages: GroundedPromptMessage[] = [];
  if (stablePrefix.trim()) {
    messages.push({
      role: "system",
      content: stablePrefix,
      ...(providerOptions ? {
        providerOptions,
        // Keep both metadata fields for compatibility with older AI SDK paths.
        providerMetadata: providerOptions,
        experimental_providerMetadata: providerOptions,
      } : {}),
    });
  }
  if (dynamicContextBlock.trim()) {
    messages.push({
      role: "system",
      content: dynamicContextBlock,
    });
  }
  const reminderLines = contextPieces
    .filter((piece) => piece.kind === "runtime_reminders")
    .flatMap((piece) => piece.content.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(REMINDER_MARKER));
  if (reminderLines.length > 0) {
    const uniqueReminderLines = [...new Set(reminderLines)];
    messages.push({
      role: "user",
      content: `[GORDON_RUNTIME_REMINDERS_NOTE]\n${uniqueReminderLines.join("\n")}`,
    });
  }
  messages.push({
    role: "user",
    content: userMessage,
  });

  const envelope: PromptEnvelope = {
    prompt,
    stablePrefix,
    runtimeStateBlock,
    projectTruthBlock,
    glossaryBlock,
    toolHintsBlock,
    dynamicContextBlock,
    contextPieces,
    report,
    requestOptions,
    messages,
  };

  // Populate Anthropic cache blocks when provider is Anthropic
  if (report.cache.key === "anthropic-stable-prefix") {
    envelope.anthropicSystemBlocks = buildAnthropicCacheControlBlocks(envelope);
  }

  if (providerOptions) {
    requestOptions.providerOptions = {
      ...(requestOptions.providerOptions as Record<string, unknown> | undefined),
      anthropic: { cacheControl: { type: "ephemeral" as const } },
    };
  }

  return envelope;
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

export function attachCumulativeUsageToPromptReport(
  threadId: string | undefined,
  usage: {
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    updatedAt: string;
  },
): void {
  const key = threadId || "default";
  const current = latestReports.get(key);
  if (!current) return;
  latestReports.set(key, {
    ...current,
    cumulativeUsage: usage,
    updatedAt: Date.now(),
  });
}

export function clearPromptContextReports(): void {
  latestReports.clear();
}

export function formatPromptContextReport(report: PromptContextReport | null): string {
  if (!report) {
    return "No prompt/context report is available for this session yet.";
  }

  const cacheLine = report.cache.supported
    ? report.cache.key === "anthropic-stable-prefix"
      ? "Enabled (anthropic-cache-control)"
      : `Enabled (${report.cache.key})`
    : `Unavailable (${report.cache.reason ?? "unsupported"})`;
  const usageLine = report.usage
    ? `${report.usage.promptTokens} prompt / ${report.usage.completionTokens} completion / ${report.usage.totalTokens} total`
    : "No provider usage reported yet.";
  const cumulativeUsageLine = report.cumulativeUsage
    ? `${report.cumulativeUsage.requestCount} req · ${report.cumulativeUsage.promptTokens} prompt / ${report.cumulativeUsage.completionTokens} completion / ${report.cumulativeUsage.totalTokens} total`
    : "No cumulative usage recorded yet.";

  const lines = [
    "**Prompt Context Report**",
    "",
    `Thread: \`${report.threadId}\``,
    `Model: ${report.provider}${report.model ? ` · ${report.model}` : ""}`,
    `Action: ${report.requestedActionId ?? "none"}${report.requestedTaskScope ? ` (${report.requestedTaskScope})` : ""}`,
    `Prompt cache: ${cacheLine}`,
    `Latest provider usage: ${usageLine}`,
    `Cumulative session usage: ${cumulativeUsageLine}`,
    `Workflow phase: ${report.workflowPhase}`,
    `Execution readiness: ${report.executionReadiness}`,
    "",
    "| Section | Estimated tokens |",
    "| --- | ---: |",
    `| Runtime state | ${report.sectionBudget.runtimeState} |`,
    `| Project truth | ${report.sectionBudget.projectTruth} |`,
    `| Integration glossary | ${report.sectionBudget.glossary} |`,
    `| Tool hints | ${report.sectionBudget.toolHints} |`,
    `| Phase guidance | ${report.sectionBudget.phaseGuidance} |`,
    `| Runtime reminders | ${report.sectionBudget.reminders} |`,
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

  if (report.contextPieces.length > 0) {
    lines.push("");
    lines.push("Context pieces:");
    for (const piece of report.contextPieces) {
      lines.push(`- ${piece.kind} · ${piece.source} · ${piece.tokenEstimate} tok${piece.stable ? " · stable" : ""}`);
    }
  }

  lines.push("");
  lines.push("Compaction policy:");
  lines.push("- Stable project truth and integration glossary grounding are rebuilt on every turn.");
  lines.push("- They sit outside conversation summaries and are preserved even if chat history is compacted.");

  return lines.join("\n");
}
