import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text } from "../../ink-custom";
import { Select, TextInput, PasswordInput } from "@inkjs/ui";
import { loadConfig, saveConfig } from "../../../infra/storage/config/config.ts";
import { saveEnvKeys } from "../../../infra/storage/config/env.ts";
import { exchangeSwitch } from "../../../app/commands/exchange.ts";
import { refreshRuntimeCredentials } from "../../../infra/runtime/credentialRefresh.ts";
import {
  ccxtIdToNativeVenue,
  extractCcxtSubId,
  genericEnvNames,
  normalizeExchangeId,
  type CcxtExchangeId,
  type ExchangeId,
} from "../../../infra/exchange/types.ts";
import { listCcxtExchanges, getExchangeCapabilities } from "../../../infra/exchange/ccxtCatalog.ts";
import type { ExchangeType } from "../../../types/config.ts";
import type { MultiExchangeConfig } from "../../../types/index.ts";
import { MultiStepPicker, type PickerStep } from "../../design-system/MultiStepPicker.tsx";
import { useTheme } from "../../themes/ThemeProvider.tsx";

/**
 * ExchangePicker — Interactive exchange selector + setup wizard.
 *
 * Switch flow: shows configured exchange IDs from config (including sandbox ones).
 * Add live flow: TIERED picker — a VERIFIED section (Gordon-tested venues) plus a
 *   searchable COMMUNITY section spanning every CCXT venue (~111). Community
 *   venues route end-to-end (the factory defers long-tail venues to CCXT) but
 *   are untested against Gordon's order/risk/WS path, so they carry a warning.
 * Add sandbox flow: pick from testnet-capable exchanges with sandbox=true credentials.
 *
 * Credential steps are CAPABILITY-DRIVEN: getExchangeCapabilities() reads the
 * venue's CCXT metadata to decide which fields to prompt (apiKey/secret always;
 * passphrase only when required; wallet key/address only for DEX venues).
 */

interface Props {
  onComplete: (message: string) => void;
  onCancel: () => void;
}

// Number of community matches shown at once — the full ~102 non-verified list is
// too long to scroll, so the search box narrows it before it reaches Select.
const COMMUNITY_RESULT_LIMIT = 12;

const SANDBOX_EXCHANGES = [
  { label: "Binance Testnet  (testnet.binance.vision)", value: "ccxt:binance", sandboxId: "binance-testnet" },
  { label: "OKX Demo  (simulated trading, x-simulated-trading: 1)", value: "ccxt:okx", sandboxId: "okx-demo" },
  { label: "Gemini Sandbox  (exchange.sandbox.gemini.com)", value: "ccxt:gemini", sandboxId: "gemini-sandbox" },
  { label: "Hyperliquid Testnet  (testnet.hyperliquid.xyz)", value: "ccxt:hyperliquid", sandboxId: "hyperliquid-testnet" },
];

const ACTIONS = [
  { label: "Switch active exchange", value: "switch" },
  { label: "Add live exchange", value: "add-live" },
  { label: "Add testnet / sandbox (paper trading)", value: "add-sandbox" },
  { label: "Remove exchange", value: "remove" },
  { label: "Check status", value: "status" },
];

function ccxtValue(id: string): string {
  return `ccxt:${id}`;
}

/** Capabilities for a `ccxt:<id>` value (or a bare sub-id). */
function capsFor(value: string): ReturnType<typeof getExchangeCapabilities> {
  const subId = value.startsWith("ccxt:") ? extractCcxtSubId(value as CcxtExchangeId) : value;
  return getExchangeCapabilities(subId);
}

function nativeVenueId(exchangeType: string): string {
  return ccxtIdToNativeVenue(normalizeExchangeId(exchangeType as ExchangeId)) ?? exchangeType;
}

interface AddState {
  exchangeType: string;
  sandboxId?: string;
  isSandbox: boolean;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  walletKey: string;
}

type ExchangePickerData = AddState & {
  action: string;
};

export function ExchangePicker({ onComplete, onCancel }: Props) {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [configuredExchanges, setConfiguredExchanges] = useState<MultiExchangeConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [communityQuery, setCommunityQuery] = useState("");
  const [add, setAdd] = useState<AddState>({
    exchangeType: "",
    sandboxId: undefined,
    isSandbox: false,
    apiKey: "",
    apiSecret: "",
    passphrase: "",
    walletKey: "",
  });

  const catalog = useMemo(() => listCcxtExchanges(), []);
  const verified = useMemo(() => catalog.filter((e) => e.verified), [catalog]);
  const community = useMemo(() => catalog.filter((e) => !e.verified), [catalog]);

  const communityMatches = useMemo(() => {
    const q = communityQuery.trim().toLowerCase();
    const pool = q
      ? community.filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      : community;
    return pool.slice(0, COMMUNITY_RESULT_LIMIT);
  }, [community, communityQuery]);

  useEffect(() => {
    loadConfig()
      .then((cfg) => {
        setConfiguredExchanges(cfg.exchanges ?? []);
        setActiveId(cfg.activeExchangeId ?? cfg.exchanges?.[0]?.id ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const switchOptions = configuredExchanges.map((exchange) => ({
    label: `${exchange.id}  (${exchange.type})${exchange.sandbox ? " [SANDBOX]" : ""}${exchange.id === activeId ? " <- active" : ""}`,
    value: exchange.id,
  }));

  const removeOptions = configuredExchanges.map((exchange) => ({
    label: `${exchange.id} (${exchange.type})${exchange.sandbox ? " [SANDBOX]" : ""}${exchange.id === activeId ? " <- active" : ""}`,
    value: exchange.id,
  }));

  const handleSwitch = useCallback(async (id: string) => {
    const result = await exchangeSwitch(id);
    onComplete(result.success ? result.message! : `Error: ${result.message}`);
  }, [onComplete]);

  const finishAdd = useCallback(async (state: AddState) => {
    try {
      const cfg = await loadConfig();
      const type = normalizeExchangeId(state.exchangeType as ExchangeId) as ExchangeType;
      const caps = capsFor(type);

      const baseId = state.sandboxId ?? extractCcxtSubId(type as CcxtExchangeId);
      let id = baseId;
      let n = 1;
      while (cfg.exchanges.some((exchange) => exchange.id === id)) {
        id = `${baseId}-${n++}`;
      }

      const entry: MultiExchangeConfig = {
        id,
        type,
        apiKey: caps.isDex ? "" : state.apiKey,
        apiSecret: caps.isDex ? "" : state.apiSecret,
        sandbox: state.isSandbox,
        isDefault: cfg.exchanges.length === 0,
        ...(state.passphrase ? { passphrase: state.passphrase } : {}),
        ...(state.walletKey ? { walletPrivateKey: state.walletKey } : {}),
      };

      cfg.exchanges.push(entry);
      if (!cfg.activeExchangeId) cfg.activeExchangeId = id;
      await saveConfig(cfg);

      // Persist credentials to .env under the generic <UPPER(subId)>_* names so
      // resolveExchangeCredentials picks them up for any (incl. uncurated) venue.
      const subId = extractCcxtSubId(type as CcxtExchangeId);
      const names = genericEnvNames(subId);
      const envWrite: Record<string, string> = {};
      if (caps.isDex) {
        if (state.walletKey) envWrite[names.walletKey] = state.walletKey;
      } else {
        if (state.apiKey) envWrite[names.key] = state.apiKey;
        if (state.apiSecret) envWrite[names.secret] = state.apiSecret;
        if (state.passphrase) envWrite[names.passphrase] = state.passphrase;
      }
      if (Object.keys(envWrite).length > 0) {
        await saveEnvKeys(envWrite as Parameters<typeof saveEnvKeys>[0]);
      }
      await refreshRuntimeCredentials();

      const label = state.isSandbox ? `${subId} (sandbox)` : subId;
      onComplete(`Added ${label} as '${id}'.${cfg.exchanges.length === 1 ? " Set as active exchange." : " Use /exchange switch to activate."}`);
    } catch (err) {
      onComplete(`Error saving exchange: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onComplete]);

  const handleRemove = useCallback(async (id: string) => {
    try {
      const cfg = await loadConfig();
      if (cfg.exchanges.length <= 1) {
        onComplete("Cannot remove the only configured exchange.");
        return;
      }
      cfg.exchanges = cfg.exchanges.filter((exchange) => exchange.id !== id);
      if (cfg.activeExchangeId === id) cfg.activeExchangeId = cfg.exchanges[0]?.id;
      await saveConfig(cfg);
      await refreshRuntimeCredentials();
      onComplete(`Removed exchange '${id}'.`);
    } catch (err) {
      onComplete(`Error removing exchange: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onComplete]);

  // Route a freshly-picked exchange to the right first credential step based on
  // its CCXT capabilities (DEX → wallet key; everything else → api key).
  const beginCredentials = useCallback(
    (
      value: string,
      isSandbox: boolean,
      sandboxId: string | undefined,
      go: (stepId: string) => void,
    ) => {
      const caps = capsFor(value);
      setAdd((prev) => ({ ...prev, exchangeType: value, isSandbox, sandboxId }));
      go(caps.isDex ? "cred-walletkey" : "cred-apikey");
    },
    [],
  );

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color={theme.uiBrand}>EXCHANGE SETUP</Text>
        <Text dimColor>Loading config...</Text>
      </Box>
    );
  }

  const steps: Record<string, PickerStep<ExchangePickerData>> = {
    action: {
      hint: configuredExchanges.length > 0
        ? `${configuredExchanges.length} exchange${configuredExchanges.length > 1 ? "s" : ""} configured`
        : undefined,
      render: (ctx) => (
        <Select
          options={ACTIONS}
          onChange={(value) => {
            ctx.set("action", value);
            if (value === "switch") ctx.go("switch-pick");
            else if (value === "add-live") ctx.go("add-live-verified");
            else if (value === "add-sandbox") ctx.go("add-sandbox-pick");
            else if (value === "remove") ctx.go("remove-pick");
            else if (value === "status") {
              const lines = configuredExchanges.map((exchange) => {
                const active = exchange.id === activeId ? " [ACTIVE]" : "";
                const sandbox = exchange.sandbox ? " [SANDBOX]" : "";
                return `  ${exchange.id} (${exchange.type})${sandbox}${active}`;
              });
              onComplete(
                configuredExchanges.length === 0
                  ? "No exchanges configured. Use 'Add' to connect one."
                  : `Configured exchanges:\n${lines.join("\n")}`,
              );
            }
          }}
        />
      ),
    },
    "switch-pick": {
      title: "Select exchange to activate:",
      render: () => {
        if (switchOptions.length === 0) {
          return <Text color={theme.riskWarning}>No exchanges configured yet. Use 'Add' to connect one.</Text>;
        }
        return <Select options={switchOptions} onChange={handleSwitch} />;
      },
    },
    "add-live-verified": {
      title: "VERIFIED — Gordon-tested exchanges (live / real money):",
      hint: "Enter to pick a verified venue, or ↓ then 'search community' for the full CCXT list.",
      render: (ctx) => (
        <Box flexDirection="column">
          <Select
            options={[
              ...verified.map((e) => ({ label: e.name, value: ccxtValue(e.id) })),
              { label: "› Search community exchanges (full CCXT list)…", value: "__community__" },
            ]}
            onChange={(value) => {
              if (value === "__community__") {
                ctx.go("add-live-community");
                return;
              }
              beginCredentials(value, false, undefined, ctx.go);
            }}
          />
        </Box>
      ),
    },
    "add-live-community": {
      title: `COMMUNITY (search ${community.length})`,
      hint: "Type to filter the full CCXT venue list by id or name.",
      render: (ctx) => (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.uiInfo}>search: </Text>
            <TextInput placeholder="bybit, kucoin, mexc…" onChange={setCommunityQuery} />
          </Box>
          <Box marginTop={1}>
            <Text bold color={theme.riskWarning}>
              ⚠ Community venues are untested with Gordon's order/risk/WS path.
            </Text>
          </Box>
          <Box marginTop={1}>
            {communityMatches.length === 0 ? (
              <Text dimColor>No matches. Refine your search.</Text>
            ) : (
              <Select
                options={communityMatches.map((e) => ({ label: `${e.name}  (${e.id})`, value: ccxtValue(e.id) }))}
                onChange={(value) => beginCredentials(value, false, undefined, ctx.go)}
              />
            )}
          </Box>
        </Box>
      ),
    },
    "add-sandbox-pick": {
      title: "Select testnet / sandbox exchange (paper trading):",
      hint: "These use fake money - safe for demos and testing",
      render: (ctx) => (
        <Select
          options={SANDBOX_EXCHANGES.map((exchange) => ({ label: exchange.label, value: exchange.sandboxId }))}
          onChange={(value) => {
            const entry = SANDBOX_EXCHANGES.find((exchange) => exchange.sandboxId === value);
            if (!entry) return;
            ctx.set("exchangeType", entry.value);
            ctx.set("isSandbox", true);
            ctx.set("sandboxId", entry.sandboxId);
            beginCredentials(entry.value, true, entry.sandboxId, ctx.go);
          }}
        />
      ),
    },
    "cred-apikey": {
      title: `API Key - ${add.exchangeType}${add.isSandbox ? " (testnet)" : ""}`,
      hint: add.isSandbox
        ? nativeVenueId(add.exchangeType) === "binance"
          ? "Get from testnet.binance.vision > API Management"
          : nativeVenueId(add.exchangeType) === "coinbase"
            ? "Get from cdp.coinbase.com > API Keys (sandbox env)"
            : "Get from your exchange's sandbox/demo account"
        : "Paste your exchange API key:",
      render: (ctx) => (
        <PasswordInput
          placeholder="API key..."
          onSubmit={(value) => {
            setAdd((prev) => ({ ...prev, apiKey: value }));
            ctx.set("apiKey", value);
            ctx.go("cred-apisecret");
          }}
        />
      ),
    },
    "cred-apisecret": {
      title: `API Secret - ${add.exchangeType}${add.isSandbox ? " (testnet)" : ""}`,
      hint: nativeVenueId(add.exchangeType) === "coinbase"
        ? "For CDP keys: paste the full EC private key (-----BEGIN EC PRIVATE KEY-----...)"
        : "Paste your exchange API secret:",
      render: (ctx) => (
        <PasswordInput
          placeholder="API secret..."
          onSubmit={(value) => {
            const next = { ...add, apiSecret: value };
            setAdd(next);
            ctx.set("apiSecret", value);
            // Capability-driven: prompt for a passphrase only when the venue
            // actually requires one (CCXT `password` credential field).
            if (capsFor(next.exchangeType).requiredCredentials.includes("password")) {
              ctx.go("cred-passphrase");
            } else {
              void finishAdd(next);
            }
          }}
        />
      ),
    },
    "cred-passphrase": {
      title: `Passphrase - ${add.exchangeType}`,
      hint: "This venue requires a passphrase in addition to key + secret.",
      render: (ctx) => (
        <PasswordInput
          placeholder="Passphrase..."
          onSubmit={(value) => {
            const next = { ...add, passphrase: value };
            setAdd(next);
            ctx.set("passphrase", value);
            void finishAdd(next);
          }}
        />
      ),
    },
    "cred-walletkey": {
      title: `Wallet Private Key - ${add.exchangeType}${add.isSandbox ? " (testnet)" : ""}`,
      hint: add.isSandbox
        ? "Use a dedicated TEST wallet. Get testnet funds from the faucet after setup."
        : "IMPORTANT: use a DEDICATED trading wallet, never your main wallet.",
      render: (ctx) => (
        <PasswordInput
          placeholder="0x... or base58..."
          onSubmit={(value) => {
            const next = { ...add, walletKey: value };
            setAdd(next);
            ctx.set("walletKey", value);
            void finishAdd(next);
          }}
        />
      ),
    },
    "remove-pick": {
      title: "Select exchange to remove:",
      render: () => {
        if (removeOptions.length === 0) {
          return <Text color={theme.riskWarning}>No exchanges configured.</Text>;
        }
        return (
          <>
            <Text bold color={theme.riskDanger}>Removal updates local exchange configuration.</Text>
            <Box marginTop={1}>
              <Select options={removeOptions} onChange={handleRemove} />
            </Box>
          </>
        );
      },
    },
  };

  return (
    <MultiStepPicker<ExchangePickerData>
      title="EXCHANGE SETUP"
      titleNote={activeId ? `(active: ${activeId})` : undefined}
      steps={steps}
      initialStep="action"
      onComplete={() => undefined}
      onCancel={onCancel}
    />
  );
}
