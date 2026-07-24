import { createKeyringProvider, KEYRING_SUPPORTED_KEYS } from "../../infra/storage/keyring.ts";
import { checkEnvStatus, createEnvFile, saveEnvKeys, type EnvKeys } from "../../infra/storage/config/env.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { resolveFlag } from "../../infra/config/flagResolver.ts";
import { getProviderCredentialStatuses, type ProviderCredentialStatus } from "../../infra/runtime/actions/index.ts";
import { BROKER_ENV_MAP, type BrokerId } from "../../infra/broker/types.ts";
import {
  EXCHANGE_ENV_MAP,
  ccxtEnvNames,
  isCcxtExchangeId,
  extractCcxtSubId,
  normalizeExchangeId,
  type ExchangeId,
  type NativeExchangeId,
} from "../../infra/exchange/types.ts";
import { pluginInstaller } from "../../infra/ai/mcp/marketplace/installer.ts";
import { recordStructuredObservation } from "../../infra/platform/observability/index.ts";
import { getExecutionVenueMetadata, getIntegrationSurfaceMetadata } from "../../infra/domain/integrations/index.ts";
import { setCostBudget } from "../../infra/platform/costTracker.ts";
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
  };
  checks: DoctorCheck[];
  providerStatuses: ProviderCredentialStatus[];
  nextActions: string[];
}

export interface BootstrapOptions {
  profile: SetupWizardMode;
  llmProvider?: "anthropic" | "openai";
  llmKey?: string;
  exchange?: ExchangeId;
  exchangeKey?: string;
  exchangeSecret?: string;
  exchangePassphrase?: string;
  exchangeWallet?: string;
  /** Explicit live opt-out of the paper-first default (`--exchange-live`). */
  exchangeLive?: boolean;
  broker?: BrokerId;
  brokerKey?: string;
  brokerSecret?: string;
  brokerPaper?: boolean;
  brokerAccountId?: string;
  synthDataApiKey?: string;
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
      || parsed["llm-provider"] === "anthropic"
        ? parsed["llm-provider"]
        : undefined,
    llmKey: typeof parsed["llm-key"] === "string" ? parsed["llm-key"] : undefined,
    exchange: typeof parsed.exchange === "string" ? parsed.exchange as ExchangeId : undefined,
    exchangeKey: typeof parsed["exchange-key"] === "string" ? parsed["exchange-key"] : undefined,
    exchangeSecret: typeof parsed["exchange-secret"] === "string" ? parsed["exchange-secret"] : undefined,
    exchangePassphrase: typeof parsed["exchange-passphrase"] === "string" ? parsed["exchange-passphrase"] : undefined,
    exchangeWallet: typeof parsed["exchange-wallet"] === "string" ? parsed["exchange-wallet"] : undefined,
    exchangeLive: parsed["exchange-live"] === true || parseBoolean(parsed["exchange-live"]) === true,
    broker: typeof parsed.broker === "string" ? parsed.broker as BrokerId : undefined,
    brokerKey: typeof parsed["broker-key"] === "string" ? parsed["broker-key"] : undefined,
    brokerSecret: typeof parsed["broker-secret"] === "string" ? parsed["broker-secret"] : undefined,
    brokerPaper: parseBoolean(parsed["broker-paper"]),
    brokerAccountId: typeof parsed["broker-account-id"] === "string" ? parsed["broker-account-id"] : undefined,
    synthDataApiKey: typeof parsed["synthdata-api-key"] === "string" ? parsed["synthdata-api-key"] : undefined,
    cashReservePercent: parseDecimalPercent(
      typeof parsed["cash-reserve-percent"] === "string" ? parsed["cash-reserve-percent"] : undefined,
    ),
    useKeyring: parseBoolean(parsed["use-keyring"]),
    json: Boolean(parsed.json),
    runDoctor: Boolean(parsed.doctor),
  };
}

/**
 * Paper-first ramp: a NEW exchange entry defaults to sandbox/paper unless the
 * operator explicitly opts into live (`--exchange-live`). Existing entries
 * keep their configured mode (undefined → `upsertExchange` preserves it).
 */
export function resolveBootstrapExchangeSandbox(
  exchangeLive: boolean | undefined,
  hasExistingEntry: boolean,
): boolean | undefined {
  if (exchangeLive) return false;
  return hasExistingEntry ? undefined : true;
}

function getProviderDefaultModel(provider: "anthropic" | "openai"): string {
  switch (provider) {
    case "anthropic":
      return "anthropic/claude-opus-4-8";
    case "openai":
      return "openai/gpt-5.6";
  }
}

function upsertExchange(
  config: GordonConfig,
  exchangeType: ExchangeId,
  payload: Partial<MultiExchangeConfig>,
): GordonConfig {
  const canonicalType = normalizeExchangeId(exchangeType);
  const existing = config.exchanges.find((exchange) => exchange.type === canonicalType);
  const id = existing?.id ?? canonicalType;
  const next: MultiExchangeConfig = {
    id,
    type: canonicalType,
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
      ...config.exchanges.filter((exchange) => exchange.type !== canonicalType).map((exchange) => ({
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
        ? `Active execution venue: ${getExecutionVenueMetadata(activeExchange.type as ExchangeId).displayName}.`
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
  ];

  const nextActions: string[] = [];
  if (!envStatus.hasLLMKey) nextActions.push("Run `gordon configure llm` or QuickStart to set an LLM provider key.");
  if (!activeExchange) nextActions.push("Run `gordon configure exchange` to add a primary trading venue.");
  if (config.useKeyring && !keyringAvailable) nextActions.push("Disable keyring or install a supported OS keyring backend.");
  if (!config.onboardingComplete) nextActions.push("Finish QuickStart or Advanced onboarding so Gordon can skip first-run setup next time.");

  // Harness wires (A3 + A4 + sandbox + kv-cache + claude.md linter):
  // cold by default, surface in doctor report when their flags are on.
  try {
    const {
      collectInitProbeChecks,
      collectSafetyBaselineChecks,
      collectSandboxChecks,
      collectKvCacheCheck,
      collectClaudeMdLintChecks,
      collectAgentReadinessChecks,
    } = await import("./harness-checks.ts");
    const probeChecks = await collectInitProbeChecks();
    const safetyChecks = collectSafetyBaselineChecks({});
    const sandboxChecks = collectSandboxChecks();
    const kvCacheChecks = collectKvCacheCheck();
    const claudeMdChecks = collectClaudeMdLintChecks();
    const readinessChecks = await collectAgentReadinessChecks();
    checks.push(...probeChecks, ...safetyChecks, ...sandboxChecks, ...kvCacheChecks, ...claudeMdChecks, ...readinessChecks);
  } catch {
    // harness-checks failures must not break the doctor report
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

  // Cost-budget enforcement: install a session (and optional daily) USD
  // budget with action="halt" at boot. Once exceeded, LLM dispatch and tool
  // calls are blocked until /cost reset. Disable via GORDON_COST_BUDGET_DISABLE=1
  // or by setting the session budget to 0.
  const costBudgetRaw = resolveFlag("GORDON_COST_BUDGET_USD");
  const sessionBudgetUsd = costBudgetRaw !== undefined ? Number(costBudgetRaw) : 25;
  const dailyBudgetRaw = resolveFlag("GORDON_DAILY_COST_BUDGET_USD");
  if (resolveFlag("GORDON_COST_BUDGET_DISABLE") === "1" || sessionBudgetUsd === 0) {
    setCostBudget(null);
  } else {
    setCostBudget({
      sessionUsd: sessionBudgetUsd,
      dailyUsd: dailyBudgetRaw ? Number(dailyBudgetRaw) : undefined,
      action: "halt",
      warnThresholds: [0.5, 0.75, 0.9],
    });
  }

  if (options.llmProvider && options.llmKey) {
    if (options.llmProvider === "anthropic") envKeys.ANTHROPIC_API_KEY = options.llmKey;
    if (options.llmProvider === "openai") envKeys.OPENAI_API_KEY = options.llmKey;
    envKeys.GORDON_PROVIDER = options.llmProvider;
    envKeys.GORDON_MODEL = getProviderDefaultModel(options.llmProvider);
  }

  if (options.exchange) {
    // CCXT-routed exchanges use the CCXT_<UPPER>_* env pattern instead of
    // the per-native EXCHANGE_ENV_MAP. The credential-resolver in
    // `infra/exchange/types.ts` (`resolveExchangeCredentials`) reads them
    // at adapter construct time.
    if (isCcxtExchangeId(options.exchange)) {
      const subId = extractCcxtSubId(options.exchange);
      const envs = ccxtEnvNames(subId);
      setEnvKey(envKeys, envs.key as keyof EnvKeys, options.exchangeKey);
      setEnvKey(envKeys, envs.secret as keyof EnvKeys, options.exchangeSecret);
      setEnvKey(envKeys, envs.passphrase as keyof EnvKeys, options.exchangePassphrase);
      setEnvKey(envKeys, envs.walletKey as keyof EnvKeys, options.exchangeWallet);
    } else {
      const envMap = EXCHANGE_ENV_MAP[options.exchange as NativeExchangeId];
      setEnvKey(envKeys, envMap.key as keyof EnvKeys | undefined, options.exchangeKey);
      setEnvKey(envKeys, envMap.secret as keyof EnvKeys | undefined, options.exchangeSecret);
      setEnvKey(envKeys, envMap.passphrase as keyof EnvKeys | undefined, options.exchangePassphrase);
      setEnvKey(envKeys, envMap.wallet as keyof EnvKeys | undefined, options.exchangeWallet);
    }
    // Both CCXT and native exchanges that use API keys store "***" placeholders
    // here; the credential resolver swaps them out for the real values from env
    // at adapter construct time. Wallet-only venues (hyperliquid) store ""
    // instead — checked against the native env map.
    const usesApiKey = isCcxtExchangeId(options.exchange)
      ? Boolean(options.exchangeKey)
      : Boolean(EXCHANGE_ENV_MAP[options.exchange as NativeExchangeId].key);
    const usesApiSecret = isCcxtExchangeId(options.exchange)
      ? Boolean(options.exchangeSecret)
      : Boolean(EXCHANGE_ENV_MAP[options.exchange as NativeExchangeId].secret);
    const hasExistingEntry = config.exchanges.some(
      (exchange) => exchange.type === normalizeExchangeId(options.exchange!),
    );
    config = upsertExchange(config, options.exchange, {
      apiKey: usesApiKey ? "***" : "",
      apiSecret: usesApiSecret ? "***" : "",
      passphrase: options.exchangePassphrase ? "***" : undefined,
      walletPrivateKey: options.exchangeWallet ? "***" : undefined,
      sandbox: resolveBootstrapExchangeSandbox(options.exchangeLive, hasExistingEntry),
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

  if (options.synthDataApiKey) envKeys.SYNTHDATA_API_KEY = options.synthDataApiKey;

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

  config = {
    ...config,
    onboardingComplete: true,
  };

  await persistEnvKeys(envKeys);
  const keyringStoredKeys = await persistKeysToKeyring(config.useKeyring, envKeys);
  await saveConfig(config);

  const exchangeSummary = options.exchange
    ? config.exchanges.find((exchange) => exchange.type === normalizeExchangeId(options.exchange!))?.sandbox
      ? `${options.exchange} (sandbox/paper — pass --exchange-live to trade real money)`
      : `${options.exchange} (live)`
    : "unchanged";

  const summary = [
    `Bootstrap profile: ${options.profile}`,
    `Onboarding complete: yes`,
    `LLM provider: ${options.llmProvider ?? "unchanged"}`,
    `Exchange: ${exchangeSummary}`,
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
    selectedCount: [options.synthDataApiKey].filter(Boolean).length,
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

  // A2 wire: record an initialization marker so subsequent sessions can
  // detect "first session" vs "resume." No-op when the flag is off.
  try {
    const { runInitializerOnBootstrap } = await import("./harness-checks.ts");
    runInitializerOnBootstrap(Object.keys(envKeys), [`profile:${options.profile ?? "unknown"}`]);
  } catch {
    // initializer failures must not break bootstrap
  }

  return result;
}

export function doctorReportToJson(report: DoctorReport): Record<string, JsonValue> {
  return report as unknown as Record<string, JsonValue>;
}
