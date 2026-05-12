import { createKeyringProvider, KEYRING_SUPPORTED_KEYS } from "../../infra/storage/keyring.ts";
import { checkEnvStatus, createEnvFile, saveEnvKeys, type EnvKeys } from "../../infra/storage/config/env.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { getProviderCredentialStatuses, type ProviderCredentialStatus } from "../../infra/runtime/actions/index.ts";
import { BROKER_ENV_MAP, type BrokerId } from "../../infra/broker/types.ts";
import { EXCHANGE_ENV_MAP, type ExchangeId } from "../../infra/exchange/types.ts";
import { pluginInstaller } from "../../infra/ai/mcp/marketplace/installer.ts";
import {
  getStructuredAxiomPrivacyStatus,
  getTracingConfig,
  recordStructuredObservation,
} from "../../infra/platform/observability/index.ts";
import { getExecutionVenueMetadata, getIntegrationSurfaceMetadata } from "../../infra/domain/integrations/index.ts";
import type {
  GordonConfig,
  MultiBrokerConfig,
  MultiExchangeConfig,
  Preferences,
} from "../../types/index.ts";
import { parseSetupWizardMode, type SetupWizardMode } from "./setup-flow.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface DoctorCheck {
  id: string;
  ok: boolean;
  severity: "info" | "warn" | "error";
  message: string;
}

export interface DoctorReport {
  generatedAt: string;
  healthy: boolean;
  summary: {
    onboardingComplete: boolean;
    startupBannerMode: "full" | "quiet";
    llmReady: boolean;
    activeExchange: string | null;
    activeBroker: string | null;
    keyringEnabled: boolean;
    keyringAvailable: boolean;
    installedMcpPlugins: number;
    enabledMcpPlugins: number;
    structuredAxiomRequested: boolean;
    structuredAxiomEnabled: boolean;
    structuredAxiomConsentEnabled: boolean;
    structuredAxiomHashSaltConfigured: boolean;
    tracingEnabled: boolean;
    tracingRequested: boolean;
    tracingReviewed: boolean;
    tracingConsentEnabled: boolean;
  };
  checks: DoctorCheck[];
  providerStatuses: ProviderCredentialStatus[];
  nextActions: string[];
}

export interface BootstrapOptions {
  profile: SetupWizardMode;
  llmProvider?: "openai" | "inception" | "dedalus";
  llmKey?: string;
  exchange?: ExchangeId;
  exchangeKey?: string;
  exchangeSecret?: string;
  exchangePassphrase?: string;
  exchangeWallet?: string;
  broker?: BrokerId;
  brokerKey?: string;
  brokerSecret?: string;
  brokerPaper?: boolean;
  brokerAccountId?: string;
  solanaPrivateKey?: string;
  solanaRpcUrl?: string;
  polkadotMnemonic?: string;
  polkadotPrivateKey?: string;
  chainlinkApiKey?: string;
  chainlinkApiSecret?: string;
  evmPrivateKey?: string;
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  cdpWalletSecret?: string;
  synthDataApiKey?: string;
  heliusApiKey?: string;
  moonpayApiKey?: string;
  moonpaySecretKey?: string;
  polygonRecipient?: string;
  polygonPrivateKey?: string;
  cashReservePercent?: number;
  useKeyring?: boolean;
  json?: boolean;
  runDoctor?: boolean;
}

export interface BootstrapResult {
  config: GordonConfig;
  savedEnvKeys: string[];
  keyringStoredKeys: string[];
  summary: string[];
  doctor?: DoctorReport;
}

function parseBoolean(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "paper"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "live"].includes(normalized)) return false;
  return undefined;
}

function parseDecimalPercent(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const raw = Number.parseFloat(value.trim().replace(/%$/, ""));
  if (Number.isNaN(raw)) return undefined;
  return raw > 1 ? raw / 100 : raw;
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function setEnvKey<K extends keyof EnvKeys>(
  envKeys: Partial<EnvKeys>,
  key: K | undefined,
  value: EnvKeys[K] | undefined,
): void {
  if (!key || !value) return;
  envKeys[key] = value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export function parseBootstrapArgs(args: string[]): BootstrapOptions {
  const parsed = parseArgs(args);
  const profile = parseSetupWizardMode(
    typeof parsed.profile === "string" ? parsed.profile : undefined,
    "quickstart",
  );

  return {
    profile,
    llmProvider:
      parsed["llm-provider"] === "openai"
      || parsed["llm-provider"] === "inception"
      || parsed["llm-provider"] === "dedalus"
        ? parsed["llm-provider"]
        : undefined,
    llmKey: typeof parsed["llm-key"] === "string" ? parsed["llm-key"] : undefined,
    exchange: typeof parsed.exchange === "string" ? parsed.exchange as ExchangeId : undefined,
    exchangeKey: typeof parsed["exchange-key"] === "string" ? parsed["exchange-key"] : undefined,
    exchangeSecret: typeof parsed["exchange-secret"] === "string" ? parsed["exchange-secret"] : undefined,
    exchangePassphrase: typeof parsed["exchange-passphrase"] === "string" ? parsed["exchange-passphrase"] : undefined,
    exchangeWallet: typeof parsed["exchange-wallet"] === "string" ? parsed["exchange-wallet"] : undefined,
    broker: typeof parsed.broker === "string" ? parsed.broker as BrokerId : undefined,
    brokerKey: typeof parsed["broker-key"] === "string" ? parsed["broker-key"] : undefined,
    brokerSecret: typeof parsed["broker-secret"] === "string" ? parsed["broker-secret"] : undefined,
    brokerPaper: parseBoolean(parsed["broker-paper"]),
    brokerAccountId: typeof parsed["broker-account-id"] === "string" ? parsed["broker-account-id"] : undefined,
    solanaPrivateKey: typeof parsed["solana-private-key"] === "string" ? parsed["solana-private-key"] : undefined,
    solanaRpcUrl: typeof parsed["solana-rpc-url"] === "string" ? parsed["solana-rpc-url"] : undefined,
    polkadotMnemonic: typeof parsed["polkadot-mnemonic"] === "string" ? parsed["polkadot-mnemonic"] : undefined,
    polkadotPrivateKey: typeof parsed["polkadot-private-key"] === "string" ? parsed["polkadot-private-key"] : undefined,
    chainlinkApiKey: typeof parsed["chainlink-api-key"] === "string" ? parsed["chainlink-api-key"] : undefined,
    chainlinkApiSecret: typeof parsed["chainlink-api-secret"] === "string" ? parsed["chainlink-api-secret"] : undefined,
    evmPrivateKey: typeof parsed["evm-private-key"] === "string" ? parsed["evm-private-key"] : undefined,
    cdpApiKeyId: typeof parsed["cdp-api-key-id"] === "string" ? parsed["cdp-api-key-id"] : undefined,
    cdpApiKeySecret: typeof parsed["cdp-api-key-secret"] === "string" ? parsed["cdp-api-key-secret"] : undefined,
    cdpWalletSecret: typeof parsed["cdp-wallet-secret"] === "string" ? parsed["cdp-wallet-secret"] : undefined,
    synthDataApiKey: typeof parsed["synthdata-api-key"] === "string" ? parsed["synthdata-api-key"] : undefined,
    heliusApiKey: typeof parsed["helius-api-key"] === "string" ? parsed["helius-api-key"] : undefined,
    moonpayApiKey: typeof parsed["moonpay-api-key"] === "string" ? parsed["moonpay-api-key"] : undefined,
    moonpaySecretKey: typeof parsed["moonpay-secret-key"] === "string" ? parsed["moonpay-secret-key"] : undefined,
    polygonRecipient: typeof parsed["polygon-recipient"] === "string" ? parsed["polygon-recipient"] : undefined,
    polygonPrivateKey: typeof parsed["polygon-private-key"] === "string" ? parsed["polygon-private-key"] : undefined,
    cashReservePercent: parseDecimalPercent(
      typeof parsed["cash-reserve-percent"] === "string" ? parsed["cash-reserve-percent"] : undefined,
    ),
    useKeyring: parseBoolean(parsed["use-keyring"]),
    json: Boolean(parsed.json),
    runDoctor: Boolean(parsed.doctor),
  };
}

function getProviderDefaultModel(provider: "openai" | "inception" | "dedalus"): string {
  switch (provider) {
    case "openai":
      return "openai/gpt-5.4";
    case "inception":
      return "mercury-2";
    case "dedalus":
      return "openai/gpt-5.2";
  }
}

function upsertExchange(
  config: GordonConfig,
  exchangeType: ExchangeId,
  payload: Partial<MultiExchangeConfig>,
): GordonConfig {
  const existing = config.exchanges.find((exchange) => exchange.type === exchangeType);
  const id = existing?.id ?? exchangeType;
  const next: MultiExchangeConfig = {
    id,
    type: exchangeType,
    apiKey: payload.apiKey ?? existing?.apiKey ?? "***",
    apiSecret: payload.apiSecret ?? existing?.apiSecret ?? "***",
    passphrase: payload.passphrase ?? existing?.passphrase,
    walletPrivateKey: payload.walletPrivateKey ?? existing?.walletPrivateKey,
    sandbox: payload.sandbox ?? existing?.sandbox ?? false,
    isDefault: true,
  };

  return {
    ...config,
    exchanges: [
      ...config.exchanges.filter((exchange) => exchange.type !== exchangeType).map((exchange) => ({
        ...exchange,
        isDefault: false,
      })),
      next,
    ],
    activeExchangeId: id,
  };
}

function upsertBroker(
  config: GordonConfig,
  brokerType: BrokerId,
  payload: Partial<MultiBrokerConfig>,
): GordonConfig {
  const existing = config.brokers.find((broker) => broker.type === brokerType);
  const id = existing?.id ?? brokerType;
  const next: MultiBrokerConfig = {
    id,
    type: brokerType,
    apiKey: payload.apiKey ?? existing?.apiKey ?? "***",
    apiSecret: payload.apiSecret ?? existing?.apiSecret ?? "***",
    paper: payload.paper ?? existing?.paper ?? true,
    accountId: payload.accountId ?? existing?.accountId,
    baseUrl: payload.baseUrl ?? existing?.baseUrl,
    dataBaseUrl: payload.dataBaseUrl ?? existing?.dataBaseUrl,
    isDefault: true,
  };

  return {
    ...config,
    brokers: [
      ...config.brokers.filter((broker) => broker.type !== brokerType).map((broker) => ({
        ...broker,
        isDefault: false,
      })),
      next,
    ],
    activeBrokerId: id,
  };
}

function withAgentRails(config: GordonConfig, options: BootstrapOptions): GordonConfig {
  const agentRails = {
    ...config.agentRails,
    walletProviders: [...config.agentRails.walletProviders],
    chainProviders: [...config.agentRails.chainProviders],
    paymentProviders: [...config.agentRails.paymentProviders],
  };

  if (options.moonpayApiKey || options.moonpaySecretKey) {
    agentRails.walletProviders = [
      ...agentRails.walletProviders.filter((provider) => provider.type !== "moonpay").map((provider) => ({
        ...provider,
        isDefault: false,
      })),
      {
        id: "moonpay",
        type: "moonpay",
        authMode: "native",
        enabled: true,
        isDefault: true,
      },
    ];
    agentRails.activeWalletProviderId = "moonpay";
  }

  if (options.heliusApiKey) {
    agentRails.chainProviders = [
      ...agentRails.chainProviders.filter((provider) => provider.type !== "helius").map((provider) => ({
        ...provider,
        isDefault: false,
      })),
      {
        id: "helius",
        type: "helius",
        authMode: "native",
        enabled: true,
        isDefault: true,
        network: "solana",
      },
    ];
    agentRails.activeChainProviderId = "helius";
  }

  if (options.polygonRecipient || options.polygonPrivateKey) {
    agentRails.paymentProviders = [
      ...agentRails.paymentProviders.filter((provider) => provider.type !== "polygon").map((provider) => ({
        ...provider,
        isDefault: false,
      })),
      {
        id: "polygon",
        type: "polygon",
        authMode: "native",
        enabled: true,
        isDefault: true,
        network: "polygon",
        recipient: options.polygonRecipient,
      },
    ];
    agentRails.activePaymentProviderId = "polygon";
  }

  return {
    ...config,
    agentRails,
  };
}

async function persistEnvKeys(keys: Partial<EnvKeys>): Promise<void> {
  const filteredKeys = Object.fromEntries(
    Object.entries(keys).filter((entry): entry is [keyof EnvKeys, string] => Boolean(entry[1])),
  ) as Partial<EnvKeys>;
  if (Object.keys(filteredKeys).length === 0) return;

  const status = await checkEnvStatus();
  if (status.fileExists) {
    await saveEnvKeys(filteredKeys);
  } else {
    await createEnvFile(filteredKeys);
  }
}

async function persistKeysToKeyring(
  useKeyring: boolean,
  keys: Partial<EnvKeys>,
): Promise<string[]> {
  if (!useKeyring) return [];
  const provider = createKeyringProvider();
  if (!(await provider.isAvailable())) return [];

  const stored: string[] = [];
  for (const [key, value] of Object.entries(keys)) {
    if (!value) continue;
    if (!KEYRING_SUPPORTED_KEYS.includes(key as typeof KEYRING_SUPPORTED_KEYS[number])) continue;
    await provider.set(key, value);
    stored.push(key);
  }
  return stored;
}

export async function collectDoctorReport(configInput?: GordonConfig): Promise<DoctorReport> {
  const config = configInput ?? await loadConfig();
  const envStatus = await checkEnvStatus();
  const keyring = createKeyringProvider();
  const keyringAvailable = await keyring.isAvailable();
  const providerStatuses = await getProviderCredentialStatuses(config);
  const structuredPrivacy = getStructuredAxiomPrivacyStatus();
  const tracingConfig = getTracingConfig();
  const structuredRequested = envStatus.hasStructuredAxiomEnabled || structuredPrivacy.requested;
  const structuredConsentEnabled = structuredPrivacy.consentEnabled;
  const structuredEnabled = structuredRequested && structuredConsentEnabled;
  const structuredHashSaltConfigured = envStatus.hasAxiomHashSalt || structuredPrivacy.hashSaltConfigured;
  const tracingRequested = envStatus.tracingRequested || tracingConfig.requested;
  const tracingReviewed = envStatus.tracingReviewed || tracingConfig.reviewed;
  const tracingConsentEnabled = tracingConfig.consentEnabled;
  const tracingEnabled = tracingRequested && tracingReviewed && tracingConsentEnabled;

  let installedMcpPlugins = 0;
  let enabledMcpPlugins = 0;
  try {
    await withTimeout(pluginInstaller.initialize(), 2_000);
    const installed = pluginInstaller.getInstalled();
    installedMcpPlugins = installed.length;
    enabledMcpPlugins = installed.filter((plugin) => plugin.enabled).length;
  } catch {
    installedMcpPlugins = 0;
    enabledMcpPlugins = 0;
  }

  const activeExchange = config.exchanges.find((exchange) => exchange.id === config.activeExchangeId)
    ?? config.exchanges.find((exchange) => exchange.isDefault)
    ?? null;
  const activeBroker = config.brokers.find((broker) => broker.id === config.activeBrokerId)
    ?? config.brokers.find((broker) => broker.isDefault)
    ?? null;

  const checks: DoctorCheck[] = [
    {
      id: "onboarding",
      ok: config.onboardingComplete,
      severity: config.onboardingComplete ? "info" : "warn",
      message: config.onboardingComplete
        ? "Onboarding has been completed."
        : "Onboarding is not marked complete. Run Gordon and finish QuickStart or Advanced setup.",
    },
    {
      id: "llm",
      ok: envStatus.hasLLMKey,
      severity: envStatus.hasLLMKey ? "info" : "error",
      message: envStatus.hasLLMKey
        ? "At least one LLM provider key is configured."
        : "No LLM provider key is configured.",
    },
    {
      id: "exchange",
      ok: Boolean(activeExchange),
      severity: activeExchange ? "info" : "warn",
      message: activeExchange
        ? `Active execution venue: ${getExecutionVenueMetadata(activeExchange.type).displayName}.`
        : "No active exchange is configured.",
    },
    {
      id: "broker",
      ok: Boolean(activeBroker),
      severity: activeBroker ? "info" : "info",
      message: activeBroker
        ? `Active broker: ${getExecutionVenueMetadata(activeBroker.type).displayName}${activeBroker.paper ? " (paper)" : " (live)"}.`
        : "No active stock broker is configured.",
    },
    {
      id: "keyring",
      ok: !config.useKeyring || keyringAvailable,
      severity: !config.useKeyring || keyringAvailable ? "info" : "warn",
      message: config.useKeyring
        ? keyringAvailable
          ? "OS keyring is enabled and available."
          : "Keyring is enabled in config but is not available on this machine."
        : "Keyring is disabled. Secrets are loaded from env/process sources.",
    },
    {
      id: "mcp",
      ok: true,
      severity: installedMcpPlugins > 0 ? "info" : "info",
      message: `${enabledMcpPlugins}/${installedMcpPlugins} ${getIntegrationSurfaceMetadata("gordon_mcp").displayName} plugins are enabled.`,
    },
    {
      id: "axiom_privacy",
      ok: !structuredEnabled || structuredHashSaltConfigured,
      severity: !structuredEnabled || structuredHashSaltConfigured ? "info" : "warn",
      message: !structuredRequested
        ? "Structured Axiom export is disabled unless GORDON_AXIOM_STRUCTURED_ENABLED=true."
        : !structuredConsentEnabled
          ? "Structured Axiom export is configured but blocked until telemetry consent is enabled."
        : structuredHashSaltConfigured
          ? "Structured Axiom export is enabled with GORDON_AXIOM_HASH_SALT configured."
          : "Structured Axiom export is enabled without GORDON_AXIOM_HASH_SALT. Configure a salt before collecting tester data.",
    },
    {
      id: "otel_review",
      ok: !tracingRequested || (tracingReviewed && tracingConsentEnabled),
      severity: !tracingRequested || tracingReviewed ? "info" : "warn",
      message: !tracingRequested
        ? "OTEL tracing is disabled by default."
        : !tracingReviewed
          ? "OTEL tracing was requested but is blocked until GORDON_TRACING_REVIEWED=true is set."
        : tracingConsentEnabled
          ? "OTEL tracing review gate is acknowledged."
          : "OTEL tracing is reviewed but blocked until telemetry consent is enabled.",
    },
  ];

  const nextActions: string[] = [];
  if (!envStatus.hasLLMKey) nextActions.push("Run `gordon configure llm` or QuickStart to set an LLM provider key.");
  if (!activeExchange) nextActions.push("Run `gordon configure exchange` to add a primary trading venue.");
  if (config.useKeyring && !keyringAvailable) nextActions.push("Disable keyring or install a supported OS keyring backend.");
  if (!config.onboardingComplete) nextActions.push("Finish QuickStart or Advanced onboarding so Gordon can skip first-run setup next time.");
  if (config.agentRails.walletProviders.length === 0 && config.agentRails.chainProviders.length === 0 && config.agentRails.paymentProviders.length === 0) {
    nextActions.push("Use `gordon configure rails` if you want MoonPay, Helius, or Polygon x402 integrated natively.");
  }
  if (structuredEnabled && !structuredHashSaltConfigured) {
    nextActions.push("Set `GORDON_AXIOM_HASH_SALT` before collecting structured Axiom telemetry from external testers.");
  }
  if (structuredRequested && !structuredConsentEnabled) {
    nextActions.push("Run `/telemetry enable` if you want structured Axiom export to activate for this install.");
  }
  if (tracingRequested && !tracingReviewed) {
    nextActions.push("Keep OTEL tracing disabled or explicitly acknowledge review with `GORDON_TRACING_REVIEWED=true` after checking trace payloads.");
  }
  if (tracingRequested && tracingReviewed && !tracingConsentEnabled) {
    nextActions.push("Run `/telemetry enable` if you want reviewed OTEL tracing to activate for this install.");
  }

  const healthy = checks.every((check) => check.ok || check.severity === "info");

  const report: DoctorReport = {
    generatedAt: new Date().toISOString(),
    healthy,
    summary: {
      onboardingComplete: config.onboardingComplete,
      llmReady: envStatus.hasLLMKey,
      activeExchange: activeExchange?.type ?? null,
      activeBroker: activeBroker?.type ?? null,
      startupBannerMode: config.startupBannerMode,
      keyringEnabled: config.useKeyring,
      keyringAvailable,
      installedMcpPlugins,
      enabledMcpPlugins,
      structuredAxiomRequested: structuredRequested,
      structuredAxiomEnabled: structuredEnabled,
      structuredAxiomConsentEnabled: structuredConsentEnabled,
      structuredAxiomHashSaltConfigured: structuredHashSaltConfigured,
      tracingEnabled,
      tracingRequested,
      tracingReviewed,
      tracingConsentEnabled,
    },
    checks,
    providerStatuses,
    nextActions,
  };

  recordStructuredObservation({
    eventType: "ops.doctor_report_generated",
    workflow: "ops",
    source: "doctor",
    component: "setup_runtime",
    outcome: healthy ? "success" : "failure",
    status: healthy ? "healthy" : "needs_attention",
    exchange: activeExchange?.type ?? undefined,
    broker: activeBroker?.type ?? undefined,
    healthy,
    actionCount: checks.length,
    missingCount: providerStatuses.filter((status) => !status.ready).length,
    details: {
      onboardingComplete: report.summary.onboardingComplete,
      llmReady: report.summary.llmReady,
      startupBannerMode: report.summary.startupBannerMode,
      keyringEnabled: report.summary.keyringEnabled,
      keyringAvailable: report.summary.keyringAvailable,
      installedMcpPlugins: report.summary.installedMcpPlugins,
      enabledMcpPlugins: report.summary.enabledMcpPlugins,
      structuredAxiomRequested: structuredRequested,
      structuredAxiomEnabled: structuredEnabled,
      structuredAxiomConsentEnabled: structuredConsentEnabled,
      structuredHashSaltConfigured,
      tracingEnabled,
      tracingRequested,
      tracingReviewed,
      tracingConsentEnabled,
      failingChecks: checks.filter((check) => !check.ok).map((check) => check.id),
      blockedProviders: providerStatuses
        .filter((status) => !status.ready)
        .map((status) => ({
          providerId: status.providerId,
          providerKind: status.providerKind,
          missing: status.missing,
        })),
      nextActions,
    },
  });

  return report;
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    "**Gordon Doctor**",
    "",
    `Generated: ${report.generatedAt}`,
    `Healthy: ${report.healthy ? "yes" : "no"}`,
    `Onboarding complete: ${report.summary.onboardingComplete ? "yes" : "no"}`,
    `Startup banner: ${report.summary.startupBannerMode}`,
    `LLM ready: ${report.summary.llmReady ? "yes" : "no"}`,
    `Active crypto venue: ${report.summary.activeExchange ?? "none"}`,
    `Active broker: ${report.summary.activeBroker ?? "none"}`,
    `Keyring: ${report.summary.keyringEnabled ? "enabled" : "disabled"} (${report.summary.keyringAvailable ? "available" : "unavailable"})`,
    `MCP plugins: ${report.summary.enabledMcpPlugins}/${report.summary.installedMcpPlugins} enabled`,
    `Structured Axiom: ${report.summary.structuredAxiomRequested ? (report.summary.structuredAxiomEnabled ? (report.summary.structuredAxiomHashSaltConfigured ? "enabled" : "enabled (hash salt missing)") : "requested but blocked by telemetry consent") : "disabled"}`,
    `OTEL tracing: ${report.summary.tracingRequested ? (!report.summary.tracingReviewed ? "requested but blocked by review gate" : report.summary.tracingEnabled ? "enabled/reviewed" : "reviewed but blocked by telemetry consent") : "disabled"}`,
    "",
    "**Checks**",
  ];

  for (const check of report.checks) {
    const prefix = check.ok ? "[OK]" : check.severity === "error" ? "[!!]" : "[--]";
    lines.push(`${prefix} ${check.message}`);
  }

  if (report.providerStatuses.length > 0) {
    lines.push("", "**Provider readiness**");
    for (const status of report.providerStatuses) {
      const prefix = status.ready ? "[OK]" : "[--]";
      const missing = status.missing.length > 0 ? ` | missing: ${status.missing.join(", ")}` : "";
      const label = status.integration?.displayName ?? status.label;
      const domain = status.integration?.integrationDomain ?? status.providerKind;
      lines.push(`${prefix} ${label} [${domain}] (${status.sessionMode})${missing}`);
    }
  }

  if (report.nextActions.length > 0) {
    lines.push("", "**Next actions**");
    for (const action of report.nextActions) {
      lines.push(`- ${action}`);
    }
  }

  return lines.join("\n");
}

export async function applyBootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  let config = await loadConfig();
  const envKeys: Partial<EnvKeys> = {};

  if (options.llmProvider && options.llmKey) {
    if (options.llmProvider === "openai") envKeys.OPENAI_API_KEY = options.llmKey;
    if (options.llmProvider === "inception") envKeys.INCEPTION_API_KEY = options.llmKey;
    if (options.llmProvider === "dedalus") envKeys.DEDALUS_API_KEY = options.llmKey;
    envKeys.GORDON_PROVIDER = options.llmProvider;
    envKeys.GORDON_MODEL = getProviderDefaultModel(options.llmProvider);
  }

  if (options.exchange) {
    const envMap = EXCHANGE_ENV_MAP[options.exchange];
    setEnvKey(envKeys, envMap.key as keyof EnvKeys | undefined, options.exchangeKey);
    setEnvKey(envKeys, envMap.secret as keyof EnvKeys | undefined, options.exchangeSecret);
    setEnvKey(envKeys, envMap.passphrase as keyof EnvKeys | undefined, options.exchangePassphrase);
    setEnvKey(envKeys, envMap.wallet as keyof EnvKeys | undefined, options.exchangeWallet);
    config = upsertExchange(config, options.exchange, {
      apiKey: envMap.key ? "***" : "",
      apiSecret: envMap.secret ? "***" : "",
      passphrase: options.exchangePassphrase ? "***" : undefined,
      walletPrivateKey: options.exchangeWallet ? "***" : undefined,
      sandbox: false,
    });
  }

  if (options.broker) {
    const envMap = BROKER_ENV_MAP[options.broker];
    setEnvKey(envKeys, envMap.key as keyof EnvKeys, options.brokerKey);
    setEnvKey(envKeys, envMap.secret as keyof EnvKeys, options.brokerSecret);
    if (envMap.paper && options.brokerPaper !== undefined) {
      setEnvKey(envKeys, envMap.paper as keyof EnvKeys, options.brokerPaper ? "true" : "false");
    }
    if (envMap.accountId && options.brokerAccountId) {
      setEnvKey(envKeys, envMap.accountId as keyof EnvKeys, options.brokerAccountId);
    }
    config = upsertBroker(config, options.broker, {
      apiKey: "***",
      apiSecret: "***",
      paper: options.brokerPaper ?? true,
      accountId: options.brokerAccountId,
    });
  }

  if (options.solanaPrivateKey) envKeys.SOLANA_PRIVATE_KEY = options.solanaPrivateKey;
  if (options.solanaRpcUrl) envKeys.SOLANA_RPC_URL = options.solanaRpcUrl;
  if (options.polkadotMnemonic) envKeys.POLKADOT_MNEMONIC = options.polkadotMnemonic;
  if (options.polkadotPrivateKey) envKeys.POLKADOT_PRIVATE_KEY = options.polkadotPrivateKey;
  if (options.chainlinkApiKey) envKeys.CHAINLINK_API_KEY = options.chainlinkApiKey;
  if (options.chainlinkApiSecret) envKeys.CHAINLINK_API_SECRET = options.chainlinkApiSecret;
  if (options.evmPrivateKey) envKeys.EVM_PRIVATE_KEY = options.evmPrivateKey;
  if (options.cdpApiKeyId) envKeys.CDP_API_KEY_ID = options.cdpApiKeyId;
  if (options.cdpApiKeySecret) envKeys.CDP_API_KEY_SECRET = options.cdpApiKeySecret;
  if (options.cdpWalletSecret) envKeys.CDP_WALLET_SECRET = options.cdpWalletSecret;
  if (options.synthDataApiKey) envKeys.SYNTHDATA_API_KEY = options.synthDataApiKey;
  if (options.heliusApiKey) envKeys.HELIUS_API_KEY = options.heliusApiKey;
  if (options.moonpayApiKey) envKeys.MOONPAY_API_KEY = options.moonpayApiKey;
  if (options.moonpaySecretKey) envKeys.MOONPAY_SECRET_KEY = options.moonpaySecretKey;
  if (options.polygonPrivateKey) envKeys.POLYGON_X402_PRIVATE_KEY = options.polygonPrivateKey;
  if (options.polygonRecipient) envKeys.POLYGON_X402_RECIPIENT = options.polygonRecipient;

  if (options.cashReservePercent !== undefined) {
    const nextPreferences: Preferences = {
      ...config.preferences,
      cashReservePercent: options.cashReservePercent,
    };
    config = { ...config, preferences: nextPreferences };
  }

  if (options.useKeyring !== undefined) {
    config = { ...config, useKeyring: options.useKeyring };
  }

  config = withAgentRails(config, options);
  config = {
    ...config,
    onboardingComplete: true,
  };

  await persistEnvKeys(envKeys);
  const keyringStoredKeys = await persistKeysToKeyring(config.useKeyring, envKeys);
  await saveConfig(config);

  const summary = [
    `Bootstrap profile: ${options.profile}`,
    `Onboarding complete: yes`,
    `LLM provider: ${options.llmProvider ?? "unchanged"}`,
    `Exchange: ${options.exchange ?? "unchanged"}`,
    `Broker: ${options.broker ?? "unchanged"}`,
    `Saved env keys: ${Object.keys(envKeys).length}`,
    `Stored in keyring: ${keyringStoredKeys.length}`,
  ];

  const result: BootstrapResult = {
    config,
    savedEnvKeys: Object.keys(envKeys),
    keyringStoredKeys,
    summary,
  };

  if (options.runDoctor) {
    result.doctor = await collectDoctorReport(config);
  }

  recordStructuredObservation({
    eventType: "setup.bootstrap_applied",
    workflow: "setup",
    source: "bootstrap",
    component: "setup_runtime",
    outcome: "success",
    status: "completed",
    exchange: options.exchange,
    broker: options.broker,
    provider: options.llmProvider,
    selectedCount: [
      options.solanaPrivateKey || options.solanaRpcUrl,
      options.polkadotMnemonic || options.polkadotPrivateKey,
      options.chainlinkApiKey || options.chainlinkApiSecret,
      options.evmPrivateKey,
      options.cdpApiKeyId || options.cdpApiKeySecret || options.cdpWalletSecret,
      options.synthDataApiKey,
    ].filter(Boolean).length,
    details: {
      profile: options.profile,
      runDoctor: Boolean(options.runDoctor),
      useKeyring: config.useKeyring,
      savedEnvKeys: Object.keys(envKeys),
      keyringStoredKeys,
      onboardingComplete: config.onboardingComplete,
      activeExchangeId: config.activeExchangeId,
      activeBrokerId: config.activeBrokerId,
    },
  });

  return result;
}

export function doctorReportToJson(report: DoctorReport): Record<string, JsonValue> {
  return report as unknown as Record<string, JsonValue>;
}
