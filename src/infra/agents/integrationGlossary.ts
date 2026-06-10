import type { GordonConfig } from "../../types/index.ts";
import { discoverProviderCapabilities } from "../runtime/actions/discovery.ts";
import { getActionById } from "../runtime/actions/registry.ts";
import type { ActionProviderKind, ActionTaskScope, CapabilitySnapshot } from "../runtime/actions/types.ts";
import type { GordonContext } from "./types.ts";

export interface IntegrationGlossaryEntry {
  id: string;
  displayName: string;
  aliases: string[];
  summary: string;
  integrationDomain: string;
  providerKind: ActionProviderKind | "unknown";
  notes: string[];
  tags: string[];
}

export interface IntegrationGlossarySelection {
  entries: IntegrationGlossaryEntry[];
  matchedIds: string[];
  reasons: string[];
  toolHints: string[];
}

const glossaryCache = new Map<string, Promise<IntegrationGlossaryEntry[]>>();

const ACTION_PROVIDER_KIND_TO_DOMAINS: Partial<Record<ActionProviderKind, string[]>> = {
  exchange: ["execution_venue"],
  broker: ["execution_venue"],
  llm: ["model_provider", "model_gateway"],
  data: ["market_data_source", "research_analytics_provider"],
  automation: ["automation_provider"],
  observability: ["observability_provider"],
  mcp: ["plugin_runtime"],
  system: ["service_backend", "system", "agent_toolkit"],
};

const TASK_SCOPE_FALLBACK_DOMAINS: Partial<Record<ActionTaskScope, string[]>> = {
  scan: ["execution_venue", "market_data_source"],
  analysis: ["execution_venue", "market_data_source", "research_analytics_provider"],
  planning: ["execution_venue", "market_data_source"],
  execution: ["execution_venue"],
  funding: ["execution_venue"],
  ops: ["observability_provider", "service_backend", "plugin_runtime"],
  setup: ["model_provider", "model_gateway", "execution_venue"],
  system: ["service_backend", "system", "observability_provider"],
};

const DOMAIN_TOOL_HINTS: Partial<Record<string, string>> = {
  execution_venue: "Use normalized venue adapters for execution facts, positions, orders, and account state.",
  market_data_source: "Use read-only market-data sources for candles, quotes, order books, and discovery context.",
  research_analytics_provider: "Use research analytics providers for forecasting, option-pricing, and probabilistic context rather than treating them as raw feeds.",
  model_provider: "Provider/model identity should come from grounded runtime metadata, not general model priors.",
  model_gateway: "Gateway-routed models inherit the gateway parent and should not be described as native providers.",
  automation_provider: "Automation providers are browser/web operators, not market-data vendors or execution venues.",
  observability_provider: "Observability surfaces are for tracing, telemetry, and diagnostics rather than trading decisions.",
  plugin_runtime: "Plugin runtime surfaces expose installable tools and should be described as extensions, not native provider capabilities.",
};

function fingerprintConfig(config: GordonConfig): string {
  return JSON.stringify({
    exchanges: config.exchanges.map((exchange) => `${exchange.id}:${exchange.type}:${exchange.isDefault ? "1" : "0"}`).sort(),
    brokers: config.brokers.map((broker) => `${broker.id}:${broker.type}:${broker.isDefault ? "1" : "0"}`).sort(),
    modelProvider: config.modelConfig?.provider ?? "default",
    modelId: config.modelConfig?.model ?? "",
  });
}

function buildAliases(snapshot: CapabilitySnapshot): string[] {
  const aliases = new Set<string>();
  aliases.add(snapshot.providerId.toLowerCase());
  aliases.add(snapshot.label.toLowerCase());

  const integration = snapshot.integration;
  if (integration) {
    aliases.add(integration.id.toLowerCase());
    aliases.add(integration.displayName.toLowerCase());
    if (integration.gatewayParent) {
      aliases.add(integration.gatewayParent.toLowerCase());
    }
  }

  for (const token of snapshot.label.split(/[\s/().:-]+/)) {
    if (token.length >= 3) {
      aliases.add(token.toLowerCase());
    }
  }

  return [...aliases].filter(Boolean);
}

function defaultSummary(snapshot: CapabilitySnapshot): string {
  const integration = snapshot.integration;
  if (!integration) {
    return `${snapshot.label} is a ${snapshot.providerKind} surface used by Gordon.`;
  }

  const note = integration.notes?.[0] ?? snapshot.notes[0];
  if (note) {
    return note;
  }

  switch (integration.integrationDomain) {
    case "automation_provider":
      return `${integration.displayName} is a browser automation and web-operator surface used for guided web workflows.`;
    case "research_analytics_provider":
      return `${integration.displayName} is a probabilistic research and forecasting surface, not a raw market-data feed.`;
    case "market_data_source":
      return `${integration.displayName} is a read-only market-data surface used for research and analysis.`;
    case "execution_venue":
      return `${integration.displayName} is an execution venue surfaced through Gordon's normalized trading adapters.`;
    case "model_gateway":
      return `${integration.displayName} is a routed model gateway that fronts multiple provider catalogs.`;
    case "model_provider":
      return `${integration.displayName} is a model-provider surface used by Gordon for inference.`;
    case "agent_toolkit":
      return `${integration.displayName} is an agent toolkit surface that wraps domain-specific tools.`;
    case "observability_provider":
      return `${integration.displayName} is an observability surface for tracing and diagnostics.`;
    case "plugin_runtime":
      return `${integration.displayName} is Gordon's plugin runtime for installable tools.`;
    case "service_backend":
      return `${integration.displayName} is a backend system surface used by Gordon services.`;
    default:
      return `${integration.displayName} is a Gordon integration surface.`;
  }
}

function buildTags(snapshot: CapabilitySnapshot): string[] {
  const integration = snapshot.integration;
  const tags = new Set<string>();
  tags.add(snapshot.providerKind);
  if (integration?.integrationDomain) {
    tags.add(integration.integrationDomain);
  }
  if (integration?.marketFamily) {
    tags.add(integration.marketFamily);
  }
  if (integration?.venueKind) {
    tags.add(integration.venueKind);
  }
  if (integration?.venueSubtype) {
    tags.add(integration.venueSubtype);
  }
  if (integration?.sourceKind) {
    tags.add(integration.sourceKind);
  }
  if (integration?.railKind) {
    tags.add(integration.railKind);
  }
  if (integration?.infraKind) {
    tags.add(integration.infraKind);
  }
  if (integration?.automationKind) {
    tags.add(integration.automationKind);
  }
  return [...tags];
}

function toGlossaryEntry(snapshot: CapabilitySnapshot): IntegrationGlossaryEntry {
  return {
    id: snapshot.providerId,
    displayName: snapshot.label,
    aliases: buildAliases(snapshot),
    summary: defaultSummary(snapshot),
    integrationDomain: snapshot.integration?.integrationDomain ?? "system",
    providerKind: snapshot.providerKind,
    notes: [...snapshot.notes, ...(snapshot.integration?.notes ?? [])],
    tags: buildTags(snapshot),
  };
}

export async function getCanonicalIntegrationGlossary(config: GordonConfig): Promise<IntegrationGlossaryEntry[]> {
  const key = fingerprintConfig(config);
  let cached = glossaryCache.get(key);
  if (!cached) {
    cached = discoverProviderCapabilities(config).then((snapshots) => {
      const unique = new Map<string, IntegrationGlossaryEntry>();
      for (const snapshot of snapshots) {
        unique.set(snapshot.providerId, toGlossaryEntry(snapshot));
      }
      return [...unique.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
    glossaryCache.set(key, cached);
  }
  return cached;
}

function collectActiveIntegrationIds(context: GordonContext): string[] {
  const ids = new Set<string>();
  if (context.exchange?.exchangeId) {
    ids.add(context.exchange.exchangeId);
  }
  if (context.broker?.brokerId) {
    ids.add(context.broker.brokerId);
  }
  const provider = context.config.modelConfig?.provider;
  if (provider) {
    ids.add(provider);
    const model = context.config.modelConfig?.model?.toLowerCase();
    if (provider === "dedalus" && model?.includes("/")) {
      const [gatewayChild = ""] = model.split(/\s+/);
      const routedProvider = gatewayChild.split("/")[0];
      if (routedProvider) {
        ids.add(`dedalus/${routedProvider}`);
      }
    }
  }
  return [...ids];
}

function collectMentionMatches(message: string, glossary: IntegrationGlossaryEntry[]): IntegrationGlossaryEntry[] {
  const lower = message.toLowerCase();
  return glossary.filter((entry) =>
    entry.aliases.some((alias) => alias.length >= 3 && matchesAlias(lower, alias))
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAlias(message: string, alias: string): boolean {
  if (alias.includes(" ")) {
    return message.includes(alias);
  }
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, "i");
  return pattern.test(message);
}

function getRelevantDomains(requestedActionId?: string, requestedTaskScope?: ActionTaskScope): string[] {
  const domains = new Set<string>();
  if (requestedActionId) {
    const action = getActionById(requestedActionId);
    for (const requirement of action?.providerRequirements ?? []) {
      for (const domain of ACTION_PROVIDER_KIND_TO_DOMAINS[requirement.kind] ?? []) {
        domains.add(domain);
      }
    }
  }
  if (requestedTaskScope) {
    for (const domain of TASK_SCOPE_FALLBACK_DOMAINS[requestedTaskScope] ?? []) {
      domains.add(domain);
    }
  }
  return [...domains];
}

export async function selectRelevantIntegrationGlossary(
  userMessage: string,
  context: GordonContext,
): Promise<IntegrationGlossarySelection> {
  const glossary = await getCanonicalIntegrationGlossary(context.config);
  const explicitMatches = collectMentionMatches(userMessage, glossary);
  const selected = new Map<string, IntegrationGlossaryEntry>();
  const reasons: string[] = [];

  for (const match of explicitMatches) {
    selected.set(match.id, match);
  }
  if (explicitMatches.length > 0) {
    reasons.push("Matched integrations named directly in the user request.");
  }

  const relevantDomains = new Set(getRelevantDomains(context.requestedActionId, context.requestedTaskScope));
  if (relevantDomains.size > 0) {
    reasons.push(`Constrained glossary to domains relevant for ${context.requestedTaskScope ?? "the active action"}.`);
  }

  const activeIds = collectActiveIntegrationIds(context);
  for (const activeId of activeIds) {
    const entry = glossary.find((candidate) => candidate.id === activeId || candidate.aliases.includes(activeId.toLowerCase()));
    if (!entry) continue;
    if (relevantDomains.size === 0 || relevantDomains.has(entry.integrationDomain) || selected.size === 0) {
      selected.set(entry.id, entry);
    }
  }
  if (activeIds.length > 0) {
    reasons.push("Included active providers configured for this session.");
  }

  if (selected.size === 0 && relevantDomains.size > 0) {
    for (const entry of glossary) {
      if (relevantDomains.has(entry.integrationDomain)) {
        selected.set(entry.id, entry);
      }
      if (selected.size >= 4) break;
    }
  }

  const toolHints = [...relevantDomains]
    .map((domain) => DOMAIN_TOOL_HINTS[domain])
    .filter((hint): hint is string => typeof hint === "string");

  const orderedEntries = [...selected.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, explicitMatches.length > 0 ? 10 : 4);

  return {
    entries: orderedEntries,
    matchedIds: orderedEntries.map((entry) => entry.id),
    reasons,
    toolHints,
  };
}

export function formatIntegrationGlossary(entries: IntegrationGlossaryEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  return entries
    .map((entry) => {
      const tagSuffix = entry.tags.length > 0 ? ` [${entry.tags.slice(0, 3).join(", ")}]` : "";
      return `- ${entry.displayName}${tagSuffix}: ${entry.summary}`;
    })
    .join("\n");
}
