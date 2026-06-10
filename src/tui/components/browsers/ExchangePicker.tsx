import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Select, TextInput } from "@inkjs/ui";
import { loadConfig, saveConfig } from "../../../infra/storage/config/config.ts";
import { exchangeSwitch } from "../../../app/commands/exchange.ts";
import { ExchangeFactory } from "../../../infra/exchange/factory.ts";
import { refreshRuntimeCredentials } from "../../../infra/runtime/credentialRefresh.ts";
import { ccxtIdToNativeVenue, normalizeExchangeId, type ExchangeId } from "../../../infra/exchange/types.ts";
import type { ExchangeType } from "../../../types/config.ts";
import type { MultiExchangeConfig } from "../../../types/index.ts";

/**
 * ExchangePicker — Interactive exchange selector + setup wizard
 *
 * Switch flow: shows configured exchange IDs from config (including sandbox ones).
 * Add live flow: pick from supported exchange types.
 * Add sandbox flow: pick from testnet-capable exchanges with sandbox=true credentials.
 *
 * Executes actions directly — no model call needed.
 */

interface Props {
  onComplete: (message: string) => void;
  onCancel: () => void;
}

// ── Exchange type definitions ────────────────────────────────────────────────

const LIVE_EXCHANGES = [
  { label: "Binance", value: "ccxt:binance" },
  { label: "Binance US", value: "ccxt:binanceus" },
  { label: "Coinbase", value: "ccxt:coinbase" },
  { label: "Kraken", value: "ccxt:kraken" },
  { label: "Bitfinex", value: "ccxt:bitfinex" },
  { label: "Gemini", value: "ccxt:gemini" },
  { label: "OKX", value: "ccxt:okx" },
  { label: "Hyperliquid (wallet-based)", value: "ccxt:hyperliquid" },
  { label: "Uniswap (wallet-based)", value: "ccxt:uniswap" },
  { label: "Robinhood Crypto", value: "ccxt:robinhood" },
];

const SANDBOX_EXCHANGES = [
  { label: "Binance Testnet  (testnet.binance.vision)", value: "ccxt:binance", sandboxId: "binance-testnet" },
  { label: "Coinbase Sandbox  (cdp.coinbase.com sandbox)", value: "ccxt:coinbase", sandboxId: "coinbase-sandbox" },
  { label: "OKX Demo  (simulated trading, x-simulated-trading: 1)", value: "ccxt:okx", sandboxId: "okx-demo" },
  { label: "Gemini Sandbox  (exchange.sandbox.gemini.com)", value: "ccxt:gemini", sandboxId: "gemini-sandbox" },
  { label: "Hyperliquid Testnet  (testnet.hyperliquid.xyz)", value: "ccxt:hyperliquid", sandboxId: "hyperliquid-testnet" },
  { label: "Kraken Demo  (demo.kraken.com)", value: "ccxt:kraken", sandboxId: "kraken-demo" },
];

const WALLET_BASED = new Set(["ccxt:hyperliquid", "ccxt:uniswap"]);
const NEEDS_PASSPHRASE = new Set(["ccxt:coinbase", "ccxt:okx"]);

function nativeVenueId(exchangeType: string): string {
  return ccxtIdToNativeVenue(normalizeExchangeId(exchangeType as ExchangeId)) ?? exchangeType;
}

type Step =
  | "loading"
  | "action"
  | "switch-pick"
  | "add-kind"
  | "add-live-pick"
  | "add-sandbox-pick"
  | "cred-apikey"
  | "cred-apisecret"
  | "cred-passphrase"
  | "cred-walletkey"
  | "remove-pick"
  | "done";

interface AddState {
  exchangeType: string;
  sandboxId?: string;
  isSandbox: boolean;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  walletKey: string;
}

export function ExchangePicker({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [configuredExchanges, setConfiguredExchanges] = useState<MultiExchangeConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [add, setAdd] = useState<AddState>({
    exchangeType: "", sandboxId: undefined, isSandbox: false,
    apiKey: "", apiSecret: "", passphrase: "", walletKey: "",
  });
  const [statusMsg, setStatusMsg] = useState("");

  // Load config on mount
  useEffect(() => {
    loadConfig().then((cfg) => {
      setConfiguredExchanges(cfg.exchanges ?? []);
      setActiveId(cfg.activeExchangeId ?? cfg.exchanges?.[0]?.id ?? null);
      setStep("action");
    }).catch(() => setStep("action"));
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "action" || step === "loading") onCancel();
      else setStep("action");
    }
  });

  // ── Action selection ───────────────────────────────────────────────────────

  const ACTIONS = [
    { label: "Switch active exchange", value: "switch" },
    { label: "Add live exchange", value: "add-live" },
    { label: "Add testnet / sandbox (paper trading)", value: "add-sandbox" },
    { label: "Remove exchange", value: "remove" },
    { label: "Check status", value: "status" },
  ];

  const handleAction = useCallback((value: string) => {
    if (value === "switch") setStep("switch-pick");
    else if (value === "add-live") setStep("add-live-pick");
    else if (value === "add-sandbox") setStep("add-sandbox-pick");
    else if (value === "remove") setStep("remove-pick");
    else if (value === "status") {
      const lines = configuredExchanges.map((e) => {
        const active = e.id === activeId ? " [ACTIVE]" : "";
        const sandbox = e.sandbox ? " [SANDBOX]" : "";
        return `  ${e.id} (${e.type})${sandbox}${active}`;
      });
      onComplete(
        configuredExchanges.length === 0
          ? "No exchanges configured. Use 'Add' to connect one."
          : `Configured exchanges:\n${lines.join("\n")}`,
      );
    }
  }, [configuredExchanges, activeId, onComplete]);

  // ── Switch ─────────────────────────────────────────────────────────────────

  const switchOptions = configuredExchanges.map((e) => ({
    label: `${e.id}  (${e.type})${e.sandbox ? " [SANDBOX]" : ""}${e.id === activeId ? " ← active" : ""}`,
    value: e.id,
  }));

  const handleSwitch = useCallback(async (id: string) => {
    const result = await exchangeSwitch(id);
    onComplete(result.success ? result.message! : `Error: ${result.message}`);
  }, [onComplete]);

  // ── Add live ───────────────────────────────────────────────────────────────

  const handleAddLivePick = useCallback((type: string) => {
    setAdd((prev) => ({ ...prev, exchangeType: type, isSandbox: false, sandboxId: undefined }));
    if (WALLET_BASED.has(type)) setStep("cred-walletkey");
    else setStep("cred-apikey");
  }, []);

  // ── Add sandbox ────────────────────────────────────────────────────────────

  const handleAddSandboxPick = useCallback((value: string) => {
    const entry = SANDBOX_EXCHANGES.find((e) => e.sandboxId === value);
    if (!entry) return;
    setAdd((prev) => ({ ...prev, exchangeType: entry.value, isSandbox: true, sandboxId: entry.sandboxId }));
    if (WALLET_BASED.has(entry.value)) setStep("cred-walletkey");
    else setStep("cred-apikey");
  }, []);

  // ── Credential steps ───────────────────────────────────────────────────────

  const handleApiKey = useCallback((value: string) => {
    setAdd((prev) => ({ ...prev, apiKey: value }));
    setStep("cred-apisecret");
  }, []);

  const handleApiSecret = useCallback((value: string) => {
    const next = { ...add, apiSecret: value };
    setAdd(next);
    if (NEEDS_PASSPHRASE.has(next.exchangeType)) setStep("cred-passphrase");
    else finishAdd(next);
  }, [add]);

  const handlePassphrase = useCallback((value: string) => {
    const next = { ...add, passphrase: value };
    setAdd(next);
    finishAdd(next);
  }, [add]);

  const handleWalletKey = useCallback((value: string) => {
    const next = { ...add, walletKey: value };
    setAdd(next);
    finishAdd(next);
  }, [add]);

  const finishAdd = useCallback(async (state: AddState) => {
    try {
      const cfg = await loadConfig();
      const type = normalizeExchangeId(state.exchangeType as ExchangeId) as ExchangeType;
      const isWallet = WALLET_BASED.has(type);

      // Generate unique ID
      const baseId = state.sandboxId ?? type;
      let id = baseId;
      let n = 1;
      while (cfg.exchanges.some((e) => e.id === id)) { id = `${baseId}-${n++}`; }

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

  // ── Remove ─────────────────────────────────────────────────────────────────

  const removeOptions = configuredExchanges.map((e) => ({
    label: `${e.id} (${e.type})${e.sandbox ? " [SANDBOX]" : ""}${e.id === activeId ? " ← active" : ""}`,
    value: e.id,
  }));

  const handleRemove = useCallback(async (id: string) => {
    try {
      const cfg = await loadConfig();
      if (cfg.exchanges.length <= 1) {
        onComplete("Cannot remove the only configured exchange.");
        return;
      }
      cfg.exchanges = cfg.exchanges.filter((e) => e.id !== id);
      if (cfg.activeExchangeId === id) cfg.activeExchangeId = cfg.exchanges[0]?.id;
      await saveConfig(cfg);
      await refreshRuntimeCredentials();
      onComplete(`Removed exchange '${id}'.`);
    } catch (err) {
      onComplete(`Error removing exchange: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onComplete]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const header = (
    <Box marginBottom={1}>
      <Text bold color="cyanBright">EXCHANGE SETUP</Text>
      {activeId && <Text dimColor>  (active: {activeId})</Text>}
    </Box>
  );

  const footer = (
    <Box marginTop={1}>
      <Text dimColor>Esc {step === "action" ? "to cancel" : "to go back"} · Enter to select</Text>
    </Box>
  );

  if (step === "loading") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text dimColor>Loading config…</Text>
      </Box>
    );
  }

  if (step === "action") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        {configuredExchanges.length > 0 && (
          <Text dimColor>
            {configuredExchanges.length} exchange{configuredExchanges.length > 1 ? "s" : ""} configured
          </Text>
        )}
        <Box marginTop={1}>
          <Select options={ACTIONS} onChange={handleAction} />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "switch-pick") {
    if (switchOptions.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          {header}
          <Text color="yellow">No exchanges configured yet. Use 'Add' to connect one.</Text>
          {footer}
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold>Select exchange to activate:</Text>
        <Box marginTop={1}>
          <Select options={switchOptions} onChange={handleSwitch} />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "add-live-pick") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold>Select exchange to add (live / real money):</Text>
        <Box marginTop={1}>
          <Select options={LIVE_EXCHANGES} onChange={handleAddLivePick} />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "add-sandbox-pick") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold>Select testnet / sandbox exchange (paper trading):</Text>
        <Text dimColor>These use fake money — safe for demos and testing</Text>
        <Box marginTop={1}>
          <Select
            options={SANDBOX_EXCHANGES.map((e) => ({ label: e.label, value: e.sandboxId }))}
            onChange={handleAddSandboxPick}
          />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "cred-apikey") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold>API Key — {add.exchangeType}{add.isSandbox ? " (testnet)" : ""}</Text>
        <Text dimColor>
          {add.isSandbox
            ? nativeVenueId(add.exchangeType) === "binance"
              ? "Get from testnet.binance.vision > API Management"
              : nativeVenueId(add.exchangeType) === "coinbase"
              ? "Get from cdp.coinbase.com > API Keys (sandbox env)"
              : "Get from your exchange's sandbox/demo account"
            : "Paste your exchange API key:"}
        </Text>
        <Box marginTop={1}>
          <TextInput placeholder="API key…" onSubmit={handleApiKey} />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "cred-apisecret") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold>API Secret — {add.exchangeType}{add.isSandbox ? " (testnet)" : ""}</Text>
        <Text dimColor>
          {nativeVenueId(add.exchangeType) === "coinbase"
            ? "For CDP keys: paste the full EC private key (-----BEGIN EC PRIVATE KEY-----…)"
            : "Paste your exchange API secret:"}
        </Text>
        <Box marginTop={1}>
          <TextInput placeholder="API secret…" onSubmit={handleApiSecret} />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "cred-passphrase") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold>Passphrase — {add.exchangeType}</Text>
        <Text dimColor>{nativeVenueId(add.exchangeType) === "coinbase" ? "Coinbase" : "OKX"} requires a passphrase in addition to key + secret.</Text>
        <Box marginTop={1}>
          <TextInput placeholder="Passphrase…" onSubmit={handlePassphrase} />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "cred-walletkey") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold>Wallet Private Key — {add.exchangeType}{add.isSandbox ? " (testnet)" : ""}</Text>
        <Text dimColor>
          {add.isSandbox
            ? "Use a dedicated TEST wallet. Get testnet funds from the faucet after setup."
            : "IMPORTANT: use a DEDICATED trading wallet, never your main wallet."}
        </Text>
        <Box marginTop={1}>
          <TextInput placeholder="0x… or base58…" onSubmit={handleWalletKey} />
        </Box>
        {footer}
      </Box>
    );
  }

  if (step === "remove-pick") {
    if (removeOptions.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          {header}
          <Text color="yellow">No exchanges configured.</Text>
          {footer}
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {header}
        <Text bold color="red">Select exchange to remove:</Text>
        <Box marginTop={1}>
          <Select options={removeOptions} onChange={handleRemove} />
        </Box>
        {footer}
      </Box>
    );
  }

  return null;
}
