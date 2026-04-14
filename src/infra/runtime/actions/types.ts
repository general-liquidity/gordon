import type { ZodTypeAny } from "zod";
import type { IntegrationSurfaceMetadata } from "../../domain/integrations/taxonomy.ts";

export type ActionDomain =
  | "market"
  | "trading"
  | "account"
  | "wallet"
  | "payments"
  | "system"
  | "setup";

export type ActionCapability = "read" | "plan" | "execute" | "configure";

export type ActionTaskScope =
  | "scan"
  | "analysis"
  | "planning"
  | "execution"
  | "funding"
  | "ops"
  | "setup"
  | "system";

export type ActionSideEffectLevel = "none" | "preview" | "state" | "funds";

export type ActionApprovalPolicy = "none" | "confirm" | "trade_permission" | "external";

export type ActionProviderKind =
  | "exchange"
  | "broker"
  | "wallet"
  | "chain"
  | "payments"
  | "llm"
  | "data"
  | "automation"
  | "observability"
  | "mcp"
  | "system";

export type ActionVisibilitySurface = "interactive" | "json" | "agent" | "mcp";

export type ActionRateLimitBudget = "minimal" | "analysis" | "scanning" | "execution" | "ops";

export interface ActionProviderRequirement {
  kind: ActionProviderKind;
  optional?: boolean;
  ids?: string[];
}

export interface SlashActionSurface {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  category: "trading" | "market" | "account" | "system" | "strategy";
  level: 1 | 2 | 3;
  workflow?: "discover" | "analyze" | "trade" | "run" | "accounts" | "operate" | "monitor";
  audience?: "core" | "advanced" | "operator";
  action: "agent" | "tool" | "menu";
  target?: string;
  executionTime?: string;
  whenToUse?: string;
}

export interface ActionToolSurface {
  toolName: string;
  agentTarget?: string;
  description: string;
}

export interface ActionCliSurface {
  id: string;
  summary: string;
  usage: string;
}

export interface ActionPromptContext {
  args: string;
}

export interface ActionDefinition {
  id: string;
  title: string;
  description: string;
  domain: ActionDomain;
  capability: ActionCapability;
  taskScope: ActionTaskScope;
  sideEffectLevel: ActionSideEffectLevel;
  approvalPolicy: ActionApprovalPolicy;
  dryRunSupported: boolean;
  providerRequirements: ActionProviderRequirement[];
  rateLimitBudget: ActionRateLimitBudget;
  visibility: ActionVisibilitySurface[];
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  slash?: SlashActionSurface;
  tool?: ActionToolSurface;
  cli?: ActionCliSurface;
  prompt: (context: ActionPromptContext) => string;
  tags?: string[];
}

export interface ActionExecutionStep {
  id: string;
  title: string;
  status: "ready" | "blocked" | "informational";
  detail: string;
}

export interface ActionExecutionPlan {
  actionId: string;
  title: string;
  taskScope: ActionTaskScope;
  dryRun: boolean;
  ready: boolean;
  summary: string;
  blockers: string[];
  steps: ActionExecutionStep[];
  approvalPolicy: ActionApprovalPolicy;
  sideEffectLevel: ActionSideEffectLevel;
  preview?: Record<string, unknown>;
  credentialSummary?: {
    ready: boolean;
    providers: string[];
    missing: string[];
  };
}

export interface CapabilitySnapshot {
  providerId: string;
  providerKind: ActionProviderKind;
  label: string;
  supportsExecution: boolean;
  capabilities: string[];
  notes: string[];
  integration?: IntegrationSurfaceMetadata;
}

export type CredentialProfile = "default" | "paper" | "live" | "ops";

export type CredentialValueSource =
  | "runtime"
  | "process_env"
  | "keyring"
  | "env_file"
  | "config"
  | "missing";

export interface CredentialFieldStatus {
  key: string;
  label: string;
  present: boolean;
  source: CredentialValueSource;
  sensitive: boolean;
}

export interface ProviderCredentialStatus {
  providerId: string;
  providerKind: ActionProviderKind;
  label: string;
  profile: CredentialProfile;
  authMode: string;
  ready: boolean;
  sessionMode: "static" | "session" | "oauth" | "mcp" | "hybrid";
  fields: CredentialFieldStatus[];
  missing: string[];
  notes: string[];
  integration?: IntegrationSurfaceMetadata;
}
