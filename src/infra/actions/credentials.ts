import { join } from "node:path";

import type { GordonConfig } from "../../types/index.ts";
import { BROKER_ENV_MAP, type BrokerId } from "../broker/types.ts";
import { EXCHANGE_ENV_MAP, type ExchangeId } from "../exchange/types.ts";
import { credentialManager } from "../mcp/credentials.ts";
import { pluginInstaller } from "../mcp/marketplace/installer.ts";
import { createAgentRailsRegistry } from "../rails/registry.ts";
import { createKeyringProvider } from "../storage/keyring.ts";
import type {
  CredentialFieldStatus,
  CredentialProfile,
  ProviderCredentialStatus,
} from "./types.ts";

type EnvMapRecord = Record<string, string | undefined>;

function parseEnv(content: string): EnvMapRecord {
  const result: EnvMapRecord = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match?.[1]) continue;
    const key = match[1].trim();
    let value = match[2]?.trim() ?? "";
    if (
      (value.startsWith("'") && value.endsWith("'"))
      || (value.startsWith("\"") && value.endsWith("\""))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function readEnvFiles(): Promise<EnvMapRecord> {
  const merged: EnvMapRecord = {};
  const candidates = [
    join(process.env.HOME || "", ".gordon", ".env"),
    join(process.cwd(), ".env"),
  ];

  for (const candidate of candidates) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      Object.assign(merged, parseEnv(await file.text()));
    }
  }

  return merged;
}

async function getKeyringKeySet(enabled: boolean): Promise<Set<string>> {
  if (!enabled) return new Set<string>();

  try {
    const keyring = createKeyringProvider();
    if (!(await keyring.isAvailable())) return new Set<string>();
    return new Set(await keyring.list());
  } catch {
    return new Set<string>();
  }
}

function resolveFieldStatus(
  key: string,
  label: string,
  sensitive: boolean,
  options: {
    envKeys: EnvMapRecord;
    keyringKeys: Set<string>;
    configValue?: string;
  },
): CredentialFieldStatus {
  const runtimeValue = process.env[key];
  const envValue = options.envKeys[key];
  const hasKeyring = options.keyringKeys.has(key);
  const configValue = options.configValue;

  if (runtimeValue && (!envValue || runtimeValue !== envValue)) {
    return { key, label, sensitive, present: true, source: "process_env" };
  }
  if (envValue) {
    return { key, label, sensitive, present: true, source: "env_file" };
  }
  if (hasKeyring) {
    return { key, label, sensitive, present: true, source: "keyring" };
  }
  if (configValue && configValue !== "***") {
    return { key, label, sensitive, present: true, source: "config" };
  }
  return { key, label, sensitive, present: false, source: "missing" };
}

function buildStatus(
  providerId: string,
  providerKind: ProviderCredentialStatus["providerKind"],
  label: string,
  profile: CredentialProfile,
  authMode: string,
  sessionMode: ProviderCredentialStatus["sessionMode"],
  fields: CredentialFieldStatus[],
  notes: string[] = [],
): ProviderCredentialStatus {
  const missing = fields.filter((field) => !field.present).map((field) => field.key);
  return {
    providerId,
    providerKind,
    label,
    profile,
    authMode,
    ready: missing.length === 0,
    sessionMode,
    fields,
    missing,
    notes,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function getLlmStatuses(envKeys: EnvMapRecord, keyringKeys: Set<string>): ProviderCredentialStatus[] {
  const providers = [
    { id: "openai", key: "OPENAI_API_KEY", label: "OpenAI", authMode: "api_key" },
    { id: "dedalus", key: "DEDALUS_API_KEY", label: "Dedalus", authMode: "api_key" },
    { id: "inception", key: "INCEPTION_API_KEY", label: "Inception", authMode: "api_key" },
    { id: "anthropic", key: "ANTHROPIC_API_KEY", label: "Anthropic", authMode: "api_key" },
    { id: "google", key: "GOOGLE_API_KEY", label: "Google", authMode: "api_key" },
  ];

  return providers.map((provider) => buildStatus(
    provider.id,
    "llm",
    provider.label,
    "ops",
    provider.authMode,
    "static",
    [resolveFieldStatus(provider.key, provider.key, true, { envKeys, keyringKeys })],
  ));
}

function getExchangeSessionMode(exchangeId: ExchangeId): ProviderCredentialStatus["sessionMode"] {
  return exchangeId === "coinbase" ? "hybrid" : "static";
}

function getBrokerSessionMode(brokerId: BrokerId): ProviderCredentialStatus["sessionMode"] {
  if (brokerId === "tastytrade") return "session";
  if (brokerId === "schwab" || brokerId === "tradestation" || brokerId === "etrade" || brokerId === "ibkr") {
    return "oauth";
  }
  return "static";
}

function getExchangeStatuses(
  config: GordonConfig,
  envKeys: EnvMapRecord,
  keyringKeys: Set<string>,
): ProviderCredentialStatus[] {
  return config.exchanges.map((exchange) => {
    const envMap = EXCHANGE_ENV_MAP[exchange.type as ExchangeId];
    const fields: CredentialFieldStatus[] = [];
    if (envMap?.key) {
      fields.push(resolveFieldStatus(envMap.key, "API key", true, {
        envKeys,
        keyringKeys,
        configValue: exchange.apiKey,
      }));
    }
    if (envMap?.secret) {
      fields.push(resolveFieldStatus(envMap.secret, "API secret", true, {
        envKeys,
        keyringKeys,
        configValue: exchange.apiSecret,
      }));
    }
    if (envMap?.passphrase) {
      fields.push(resolveFieldStatus(envMap.passphrase, "Passphrase", true, {
        envKeys,
        keyringKeys,
        configValue: exchange.passphrase,
      }));
    }
    if (envMap?.wallet) {
      fields.push(resolveFieldStatus(envMap.wallet, "Wallet private key", true, {
        envKeys,
        keyringKeys,
        configValue: exchange.walletPrivateKey,
      }));
    }

    return buildStatus(
      exchange.id,
      "exchange",
      exchange.type,
      "default",
      exchange.type === "hyperliquid" ? "wallet" : "api_key",
      getExchangeSessionMode(exchange.type as ExchangeId),
      fields,
      exchange.isDefault ? ["active_exchange"] : [],
    );
  });
}

function getBrokerStatuses(
  config: GordonConfig,
  envKeys: EnvMapRecord,
  keyringKeys: Set<string>,
): ProviderCredentialStatus[] {
  return config.brokers.map((broker) => {
    const envMap = BROKER_ENV_MAP[broker.type as BrokerId];
    const fields: CredentialFieldStatus[] = [
      resolveFieldStatus(envMap.key, "API key", true, {
        envKeys,
        keyringKeys,
        configValue: broker.apiKey,
      }),
      resolveFieldStatus(envMap.secret, "API secret", true, {
        envKeys,
        keyringKeys,
        configValue: broker.apiSecret,
      }),
    ];

    if (envMap.accountId) {
      fields.push(resolveFieldStatus(envMap.accountId, "Account ID", false, {
        envKeys,
        keyringKeys,
        configValue: broker.accountId,
      }));
    }

    return buildStatus(
      broker.id,
      "broker",
      broker.type,
      broker.paper ? "paper" : "live",
      "api_key",
      getBrokerSessionMode(broker.type as BrokerId),
      fields,
      broker.isDefault ? ["active_broker"] : [],
    );
  });
}

function getRailStatuses(
  config: GordonConfig,
  envKeys: EnvMapRecord,
  keyringKeys: Set<string>,
): ProviderCredentialStatus[] {
  const rails = createAgentRailsRegistry(config);
  const statuses: ProviderCredentialStatus[] = [];

  for (const provider of rails.walletProviders) {
    statuses.push(buildStatus(
      provider.config.id,
      "wallet",
      provider.config.type,
      "ops",
      provider.config.authMode,
      provider.config.authMode === "mcp" ? "mcp" : provider.config.authMode === "hybrid" ? "hybrid" : "static",
      [
        resolveFieldStatus("MOONPAY_API_KEY", "MoonPay API key", true, { envKeys, keyringKeys }),
        resolveFieldStatus("MOONPAY_SECRET_KEY", "MoonPay secret key", true, { envKeys, keyringKeys }),
      ],
      [provider.config.isDefault ? "active_wallet_provider" : ""].filter(Boolean),
    ));
  }

  for (const provider of rails.chainProviders) {
    statuses.push(buildStatus(
      provider.config.id,
      "chain",
      provider.config.type,
      "ops",
      provider.config.authMode,
      provider.config.authMode === "mcp" ? "mcp" : provider.config.authMode === "hybrid" ? "hybrid" : "static",
      [resolveFieldStatus("HELIUS_API_KEY", "Helius API key", true, { envKeys, keyringKeys })],
      [provider.config.isDefault ? "active_chain_provider" : ""].filter(Boolean),
    ));
  }

  for (const provider of rails.paymentProviders) {
    statuses.push(buildStatus(
      provider.config.id,
      "payments",
      provider.config.type,
      "ops",
      provider.config.authMode,
      provider.config.authMode === "mcp" ? "mcp" : provider.config.authMode === "hybrid" ? "hybrid" : "static",
      [
        resolveFieldStatus("POLYGON_X402_PRIVATE_KEY", "Polygon x402 private key", true, { envKeys, keyringKeys }),
        resolveFieldStatus("POLYGON_X402_RECIPIENT", "Polygon x402 recipient", false, { envKeys, keyringKeys }),
      ],
      [provider.config.isDefault ? "active_payment_provider" : ""].filter(Boolean),
    ));
  }

  return statuses;
}

async function getMcpStatuses(): Promise<ProviderCredentialStatus[]> {
  try {
    await withTimeout(pluginInstaller.initialize(), 2_000);
    return pluginInstaller.getInstalled().map((plugin) => {
      const fields: CredentialFieldStatus[] = [];
      if (plugin.manifest.authentication.envVar) {
        fields.push({
          key: plugin.manifest.authentication.envVar,
          label: plugin.manifest.authentication.envVar,
          sensitive: true,
          present: Boolean(credentialManager.getWithFallback(
            plugin.id,
            "apiKey",
            plugin.manifest.authentication.envVar,
          )),
          source: credentialManager.hasCredentials(plugin.id)
            ? "runtime"
            : process.env[plugin.manifest.authentication.envVar]
            ? "process_env"
            : "missing",
        });
      }
      for (const field of plugin.manifest.authentication.fields ?? []) {
        const creds = credentialManager.retrieve(plugin.id);
        fields.push({
          key: field.name,
          label: field.label,
          sensitive: field.sensitive,
          present: Boolean(creds?.[field.name]),
          source: creds?.[field.name] ? "runtime" : "missing",
        });
      }

      return buildStatus(
        plugin.id,
        "mcp",
        plugin.manifest.name,
        "ops",
        plugin.manifest.authentication.type,
        "mcp",
        fields,
        [plugin.enabled ? "enabled" : "disabled", `category=${plugin.manifest.category}`],
      );
    });
  } catch {
    return [];
  }
}

export async function getProviderCredentialStatuses(config: GordonConfig): Promise<ProviderCredentialStatus[]> {
  const envKeys = await readEnvFiles();
  const keyringKeys = await getKeyringKeySet(config.useKeyring);

  return [
    ...getLlmStatuses(envKeys, keyringKeys),
    ...getExchangeStatuses(config, envKeys, keyringKeys),
    ...getBrokerStatuses(config, envKeys, keyringKeys),
    ...getRailStatuses(config, envKeys, keyringKeys),
    ...await getMcpStatuses(),
  ];
}

export async function getCredentialSummaryForKinds(
  config: GordonConfig,
  kinds: ProviderCredentialStatus["providerKind"][],
): Promise<{
  ready: boolean;
  providers: string[];
  missing: string[];
  statuses: ProviderCredentialStatus[];
}> {
  const statuses = (await getProviderCredentialStatuses(config))
    .filter((status) => kinds.includes(status.providerKind));

  const missing = statuses.flatMap((status) => status.missing.map((field) => `${status.providerId}:${field}`));
  return {
    ready: missing.length === 0,
    providers: statuses.map((status) => status.providerId),
    missing,
    statuses,
  };
}
