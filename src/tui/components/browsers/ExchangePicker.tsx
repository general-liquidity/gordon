import React, { useCallback, useEffect, useState } from "react";
import { Box, Text } from "../../ink-custom";
import { Select, TextInput } from "@inkjs/ui";
import { loadConfig, saveConfig } from "../../../infra/storage/config/config.ts";
import { exchangeSwitch } from "../../../app/commands/exchange.ts";
import { refreshRuntimeCredentials } from "../../../infra/runtime/credentialRefresh.ts";
import { ccxtIdToNativeVenue, normalizeExchangeId, type ExchangeId } from "../../../infra/exchange/types.ts";
import type { ExchangeType } from "../../../types/config.ts";
import type { MultiExchangeConfig } from "../../../types/index.ts";
import { MultiStepPicker, type PickerStep } from "../../design-system/MultiStepPicker.tsx";
import { useTheme } from "../../themes/ThemeProvider.tsx";

/**
 * ExchangePicker — Interactive exchange selector + setup wizard.
 *
 * Switch flow: shows configured exchange IDs from config (including sandbox ones).
 * Add live flow: pick from supported exchange types.
 * Add sandbox flow: pick from testnet-capable exchanges with sandbox=true credentials.
 */

interface Props {
  onComplete: (message: string) => void;
  onCancel: () => void;
}

const LIVE_EXCHANGES = [
  { label: "Binance", value: "ccxt:binance" },
  { label: "Binance US", value: "ccxt:binanceus" },
  { label: "Coinbase", value: "ccxt:coinbase" },
  { label: "Kraken", value: "ccxt:kraken" },
  { label: "Bitfinex", value: "ccxt:bitfinex" },
  { label: "Gemini", value: "ccxt:gemini" },
  { label: "OKX", value: "ccxt:okx" },
  { label: "Hyperliquid (wallet-based)", value: "ccxt:hyperliquid" },
  { label: "Robinhood Crypto", value: "ccxt:robinhood" },
];

// Entries must stay in sync with EXCHANGE_SANDBOX_SUPPORT (sandboxSupport.ts) —
// the factory's assertSandboxSupported throws on venues declared unsupported.
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

const WALLET_BASED = new Set(["ccxt:hyperliquid"]);
const NEEDS_PASSPHRASE = new Set(["ccxt:coinbase", "ccxt:okx"]);

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
  const [add, setAdd] = useState<AddState>({
    exchangeType: "",
    sandboxId: undefined,
    isSandbox: false,
    apiKey: "",
    apiSecret: "",
    passphrase: "",
    walletKey: "",
  });

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
      const isWallet = WALLET_BASED.has(type);

      const baseId = state.sandboxId ?? type;
      let id = baseId;
      let n = 1;
      while (cfg.exchanges.some((exchange) => exchange.id === id)) {
        id = `${baseId}-${n++}`;
      }

      const entry: MultiExchangeConfig = {
        id,
        type,
        apiKey: isWallet ? "" : state.apiKey,
        apiSecret: isWallet ? "" : state.apiSecret,
        sandbox: state.isSandbox,
        isDefault: cfg.exchanges.length === 0,
        ...(state.passphrase ? { passphrase: state.passphrase } : {}),
        ...(state.walletKey ? { walletPrivateKey: state.walletKey } : {}),
      };

      cfg.exchanges.push(entry);
      if (!cfg.activeExchangeId) cfg.activeExchangeId = id;
      await saveConfig(cfg);
      await refreshRuntimeCredentials();

      const label = state.isSandbox ? `${type} (sandbox)` : type;
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
            else if (value === "add-live") ctx.go("add-live-pick");
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
    "add-live-pick": {
      title: "Select exchange to add (live / real money):",
      render: (ctx) => (
        <Select
          options={LIVE_EXCHANGES}
          onChange={(value) => {
            setAdd((prev) => ({ ...prev, exchangeType: value, isSandbox: false, sandboxId: undefined }));
            ctx.set("exchangeType", value);
            ctx.set("isSandbox", false);
            ctx.go(WALLET_BASED.has(value) ? "cred-walletkey" : "cred-apikey");
          }}
        />
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
            setAdd((prev) => ({ ...prev, exchangeType: entry.value, isSandbox: true, sandboxId: entry.sandboxId }));
            ctx.set("exchangeType", entry.value);
            ctx.set("isSandbox", true);
            ctx.set("sandboxId", entry.sandboxId);
            ctx.go(WALLET_BASED.has(entry.value) ? "cred-walletkey" : "cred-apikey");
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
        <TextInput
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
        <TextInput
          placeholder="API secret..."
          onSubmit={(value) => {
            const next = { ...add, apiSecret: value };
            setAdd(next);
            ctx.set("apiSecret", value);
            if (NEEDS_PASSPHRASE.has(next.exchangeType)) ctx.go("cred-passphrase");
            else void finishAdd(next);
          }}
        />
      ),
    },
    "cred-passphrase": {
      title: `Passphrase - ${add.exchangeType}`,
      hint: `${nativeVenueId(add.exchangeType) === "coinbase" ? "Coinbase" : "OKX"} requires a passphrase in addition to key + secret.`,
      render: (ctx) => (
        <TextInput
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
        <TextInput
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
