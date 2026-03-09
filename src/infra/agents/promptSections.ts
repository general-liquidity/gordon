import { existsSync, readFileSync } from "node:fs";
import { formatCapabilityTruthSummary, GORDON_PRODUCT_TRUTH } from "./capabilityTruth.ts";
import { ROLE_PROMPT_SECTIONS, type PromptAgentRole } from "./prompt-sections/roles.ts";
import { SHARED_PROMPT_SECTIONS, type PromptSectionDefinition as LegacyPromptSectionDefinition } from "./prompt-sections/shared.ts";
import type { GordonContext } from "./types.ts";
import { determineWorkflowPhase } from "./workflowPhase.ts";
import { getThinkingDepthFromContext } from "./thinkingPhase.ts";
import { getExecutionReadiness, getPlanningHandoff } from "./runtimeHarness.ts";
import { getMCPServerSummary } from "../mcp/client.ts";

export type { PromptAgentRole };

type PromptSectionMount = "instructions" | "context";

interface PromptSectionRegistryRecord {
  id: string;
  file: string;
  mount: PromptSectionMount;
  priority: number;
  stable?: boolean;
  roles?: PromptAgentRole[];
  workflowPhases?: string[];
  taskScopes?: string[];
  providers?: string[];
  requiresExchange?: boolean;
  requiresBroker?: boolean;
  requiresMcp?: boolean;
  executionBlocked?: boolean;
  liveModeOnly?: boolean;
  thinkingEnabledOnly?: boolean;
  requiresPlanningHandoff?: boolean;
  requiresExecutionReady?: boolean;
  requiresRequestedAction?: boolean;
  activeVenueOnly?: boolean;
}

export interface PromptSectionRenderOptions {
  role?: PromptAgentRole;
  context?: GordonContext;
}

export interface ConditionalPromptSection {
  id: string;
  priority: number;
  stable: boolean;
  content: string;
}

const registryPath = new URL("./prompt-sections/registry.json", import.meta.url);
const templateDir = new URL("./prompt-sections/templates/", import.meta.url);
const sectionCache = new Map<string, string>();
let registryCache: PromptSectionRegistryRecord[] | null = null;

const fallbackSectionContent = new Map<string, string | (() => string)>([
  ...SHARED_PROMPT_SECTIONS.map((section) => [section.id, section.content] as const),
  ...Object.values(ROLE_PROMPT_SECTIONS).flat().map((section) => [section.id, section.content] as const),
  [
    "context.execution-blocked",
    `## Runtime Execution Block
- Execution is currently blocked by the runtime harness.
- Explain the blocker directly, do not improvise around it, and keep the response read-only until the blocker is cleared.`,
  ],
  [
    "context.exchange-connected",
    `## Connected Crypto Venue
- A crypto execution venue is active in this request.
- Use exchange-specific market structure when it matters, but keep shared trading terms consistent with stocks when the workflow is cross-market.`,
  ],
  [
    "context.broker-connected",
    `## Connected Stock Broker
- A stock broker is active in this request.
- Use broker-specific language for portfolio, orders, positions, and account state, and avoid flattening broker workflows into crypto exchange semantics.`,
  ],
  [
    "context.mcp-summary",
    `## External Tool Surface
- External MCP plugin servers are available.
- Prefer native Gordon tools first, and only lean on MCP-backed tools when the request clearly targets plugin or external-tool capabilities.`,
  ],
]);

function loadRegistry(): PromptSectionRegistryRecord[] {
  if (registryCache) {
    return registryCache;
  }

  if (existsSync(registryPath)) {
    const raw = readFileSync(registryPath, "utf8");
    registryCache = JSON.parse(raw) as PromptSectionRegistryRecord[];
    return registryCache;
  }

  registryCache = [
    ...SHARED_PROMPT_SECTIONS.map((section) => ({
      id: section.id,
      file: `${section.id}.md`,
      mount: "instructions" as const,
      priority: section.priority,
    })),
    ...Object.entries(ROLE_PROMPT_SECTIONS).flatMap(([role, sections]) =>
      sections.map((section) => ({
        id: section.id,
        file: `${section.id}.md`,
        mount: "instructions" as const,
        priority: section.priority,
        roles: [role as PromptAgentRole],
      }))
    ),
  ];
  return registryCache;
}

function renderLegacySection(section: string | (() => string)): string {
  const content = typeof section === "function" ? section() : section;
  return content.trim();
}

function formatMCPServerSummary(): string {
  const summary = getMCPServerSummary();
  if (summary.length === 0) {
    return "No MCP plugin servers are currently enabled.";
  }

  return summary
    .slice(0, 6)
    .map((server) => `${server.name} (${server.category})`)
    .join(", ");
}

function renderTemplate(template: string, options: PromptSectionRenderOptions): string {
  const context = options.context;
  const workflowPhase = context ? determineWorkflowPhase(context) : "unknown";
  const executionReadiness = context?.requestedTaskScope === "execution"
    ? context
      ? (() => {
          const readiness = getExecutionReadiness(context);
          return readiness.ready
            ? "Execution may proceed, but remain within the most recent approved plan or preview."
            : readiness.reason ?? "Execution is blocked because Gordon is not live-enabled.";
        })()
      : "Execution readiness unknown."
    : "not_applicable";
  const activeVenue = context?.exchange?.exchangeId ?? context?.broker?.brokerId ?? "none";
  const modelProvider = context?.config.modelConfig?.provider ?? "current provider";
  const requestedScope = context?.requestedTaskScope ?? "none";
  const planningHandoff = context ? getPlanningHandoff(context)?.handoffSummary ?? "No current planning handoff." : "No current planning handoff.";
  const thinkingDepth = context ? getThinkingDepthFromContext(context) : "off";

  return template
    .replaceAll("{{CAPABILITY_TRUTH_SUMMARY}}", formatCapabilityTruthSummary())
    .replaceAll("{{HEADLINE}}", GORDON_PRODUCT_TRUTH.headline)
    .replaceAll("{{MODEL_PROVIDER}}", modelProvider)
    .replaceAll("{{WORKFLOW_PHASE}}", workflowPhase)
    .replaceAll("{{REQUESTED_SCOPE}}", requestedScope)
    .replaceAll("{{ACTIVE_VENUE}}", activeVenue)
    .replaceAll("{{EXECUTION_READINESS}}", executionReadiness)
    .replaceAll("{{PLANNING_HANDOFF}}", planningHandoff)
    .replaceAll("{{THINKING_DEPTH}}", thinkingDepth)
    .replaceAll("{{MCP_SERVER_SUMMARY}}", formatMCPServerSummary())
    .trim();
}

function loadSectionContent(record: PromptSectionRegistryRecord, options: PromptSectionRenderOptions): string {
  const cacheKey = `${record.id}:${options.role ?? "none"}:${options.context?.requestedTaskScope ?? "none"}:${options.context?.config.modelConfig?.provider ?? "none"}:${options.context?.exchange?.exchangeId ?? "no-exchange"}:${options.context?.broker?.brokerId ?? "no-broker"}`;
  const cached = sectionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let template = "";
  const fileUrl = new URL(`./prompt-sections/templates/${record.file}`, import.meta.url);
  if (existsSync(fileUrl)) {
    template = readFileSync(fileUrl, "utf8");
  } else {
    const fallback = fallbackSectionContent.get(record.id);
    if (fallback) {
      template = renderLegacySection(fallback);
    }
  }

  const rendered = renderTemplate(template, options);
  sectionCache.set(cacheKey, rendered);
  return rendered;
}

function recordMatches(record: PromptSectionRegistryRecord, options: PromptSectionRenderOptions): boolean {
  const { role, context } = options;
  const workflowPhase = context ? determineWorkflowPhase(context) : undefined;
  const provider = context?.config.modelConfig?.provider;

  if (record.roles?.length && (!role || !record.roles.includes(role))) {
    return false;
  }
  if (record.workflowPhases?.length && (!workflowPhase || !record.workflowPhases.includes(workflowPhase))) {
    return false;
  }
  if (record.taskScopes?.length && (!context?.requestedTaskScope || !record.taskScopes.includes(context.requestedTaskScope))) {
    return false;
  }
  if (record.providers?.length && (!provider || !record.providers.includes(provider))) {
    return false;
  }
  if (record.requiresExchange && !context?.exchange) {
    return false;
  }
  if (record.requiresBroker && !context?.broker) {
    return false;
  }
  if (record.requiresMcp && getMCPServerSummary().length === 0) {
    return false;
  }
  if (record.liveModeOnly && context?.config.mode !== "ARMED") {
    return false;
  }
  if (record.thinkingEnabledOnly && context && getThinkingDepthFromContext(context) === "off") {
    return false;
  }
  if (record.requiresPlanningHandoff && context && !getPlanningHandoff(context)) {
    return false;
  }
  if (record.requiresExecutionReady && context) {
    const readiness = getExecutionReadiness(context);
    if (!readiness.ready) {
      return false;
    }
  }
  if (record.requiresRequestedAction && !context?.requestedActionId) {
    return false;
  }
  if (record.activeVenueOnly && !context?.exchange && !context?.broker) {
    return false;
  }
  if (record.executionBlocked && context?.requestedTaskScope === "execution") {
    const isBlocked = !getExecutionReadiness(context).ready;
    if (!isBlocked) {
      return false;
    }
  }
  return true;
}

function getSectionsForMount(mount: PromptSectionMount, options: PromptSectionRenderOptions): PromptSectionRegistryRecord[] {
  return loadRegistry()
    .filter((record) => record.mount === mount)
    .filter((record) => recordMatches(record, options))
    .sort((a, b) => a.priority - b.priority);
}

export function composeAgentInstructions(
  role: PromptAgentRole,
  legacyInstructions: string,
  options: PromptSectionRenderOptions = {},
): string {
  const sections = getSectionsForMount("instructions", { ...options, role })
    .map((record) => loadSectionContent(record, { ...options, role }))
    .filter(Boolean);

  return [...sections, legacyInstructions.trim()].join("\n\n");
}

export function composeRuntimePromptSections(context: GordonContext): ConditionalPromptSection[] {
  return getSectionsForMount("context", { context })
    .map((record) => ({
      id: record.id,
      priority: record.priority,
      stable: record.stable ?? false,
      content: loadSectionContent(record, { context }),
    }))
    .filter((section) => section.content.trim().length > 0);
}

export function resetPromptSectionCache(): void {
  sectionCache.clear();
  registryCache = null;
}
