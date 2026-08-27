import { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Select, TextInput, PasswordInput } from "@inkjs/ui";
import type { SetupWizardSection } from "../../../app/setup/setup-flow.ts";

// ============================================================================
// SetupWizard — Multi-step onboarding flow
//
// Dynamic step list: core steps (LLM) are always shown; exchange, broker,
// and their credential steps are conditionally added based on user choices.
// Calls onComplete with the full collected data set when done.
// ============================================================================

/**
 * Preflight state — what's already configured. Used to skip steps the user
 * has already completed on a prior run so a returning user with an existing
 * .env doesn't have to walk through 15 questions again.
 */
export interface SetupPreflight {
  /** Providers with keys already in process.env (e.g. ["openai", "anthropic"]). */
  llmProviders: string[];
  /** Existing exchange types in config.json (e.g. ["binance"]). */
  exchanges: string[];
  /** Existing broker types in config.json (e.g. ["alpaca"]). */
  brokers: string[];
  /** Existing permissionMode if explicitly set. */
  permissionMode?: "auto" | "ask" | "strict" | "paper" | "observe" | "plan";
}

interface Props {
  onComplete: (data: Record<string, string>) => void;
  onSkip: () => void;
  preflight?: SetupPreflight;
}

export interface StepConfig {
  id: string;
  section: SetupWizardSection;
  title: string;
  description: string;
  inputType: "text" | "password" | "select";
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  /** Dynamic options — overrides `options`, recomputed per render. */
  dynamicOptions?: (
    data: Record<string, string>,
    preflight: SetupPreflight,
  ) => Array<{ label: string; value: string }>;
  key: string;
  /** Conditional predicate — step only shows when this returns true. */
  show?: (data: Record<string, string>, preflight: SetupPreflight) => boolean;
}

const EMPTY_PREFLIGHT: SetupPreflight = {
  llmProviders: [],
  exchanges: [],
  brokers: [],
};

// ============================================================================
// Step catalog
// ============================================================================

const LLM_PROVIDER_STEP: StepConfig = {
  id: "llm-provider",
  section: "llm",
  title: "LLM Provider",
  description: "Which AI provider should Gordon use?",
  inputType: "select",
  key: "llmProvider",
  // Only show if no provider is already configured.
  show: (_d, p) => p.llmProviders.length === 0,
  options: [
    { label: "Anthropic — Claude (recommended)", value: "anthropic" },
    { label: "OpenAI — GPT-5", value: "openai" },
    { label: "Google — Gemini", value: "google" },
    { label: "xAI — Grok", value: "xai" },
    { label: "OpenRouter — multi-model gateway", value: "openrouter" },
    { label: "Hugging Face — gateway (text/research)", value: "huggingface" },
  ],
};

const LLM_KEY_STEP: StepConfig = {
  id: "llm-key",
  section: "llm",
  title: "API Key",
  description: "Paste your LLM API key (stored in ~/.gordon/.env):",
  inputType: "password",
  key: "llmKey",
  placeholder: "sk-...",
  // Only ask for a key if the provider step ran (i.e. no prior provider).
  show: (_d, p) => p.llmProviders.length === 0,
};

const EXCHANGE_STEP: StepConfig = {
  id: "exchange",
  section: "exchange",
  title: "Crypto Exchange",
  description:
    "Connect a crypto exchange? Start in paper — you can go live anytime. (skip if stocks-only)",
  inputType: "select",
  key: "exchange",
  // Dynamic options: paper/testnet venues lead (paper-first ramp for new
  // users); live venues sit behind explicit "I understand, go live" copy.
  // Already-configured exchanges get a marker and a "Keep existing" default
  // at the top when any are set.
  dynamicOptions: (_d, p) => {
    const live = [
      { label: "Binance", value: "binance" },
      { label: "Binance US", value: "binance_us" },
      { label: "Coinbase", value: "coinbase" },
      { label: "Kraken", value: "kraken" },
      { label: "Bitfinex", value: "bitfinex" },
      { label: "Gemini", value: "gemini" },
      { label: "OKX", value: "okx" },
      { label: "Hyperliquid (wallet-based)", value: "hyperliquid" },
      { label: "Robinhood Crypto", value: "robinhood" },
    ].map((opt) => ({
      ...opt,
      label: p.exchanges.includes(opt.value) ? `${opt.label} (configured)` : opt.label,
    }));
    const sandbox = [
      { label: "─── Recommended: paper trading, no real money ───", value: "skip" },
      { label: "Binance Testnet  (paper, no real money)", value: "binance-testnet" },
      { label: "Coinbase Sandbox  (paper, no real money)", value: "coinbase-sandbox" },
      { label: "OKX Demo  (paper, no real money)", value: "okx-demo" },
      { label: "Gemini Sandbox  (paper, no real money)", value: "gemini-sandbox" },
      { label: "Hyperliquid Testnet  (paper, no real money)", value: "hyperliquid-testnet" },
    ];
    const liveHeader = [
      { label: "─── Live venues — real money. I understand, go live ───", value: "skip" },
    ];
    const prefix =
      p.exchanges.length > 0
        ? [{ label: "Keep existing — don't touch exchanges", value: "skip" }]
        : [];
    const suffix = p.exchanges.length === 0 ? [{ label: "Skip", value: "skip" }] : [];
    return [...prefix, ...sandbox, ...liveHeader, ...live, ...suffix];
  },
};

/** Asks what to do when the user picks an exchange that's already configured. */
const EXCHANGE_LIVE_CONFIRM_STEP: StepConfig = {
  id: "exchange-live-confirm",
  section: "exchange",
  title: "Live exchange confirmation",
  description:
    "You selected a live venue — real money will move on this exchange.\n" +
    "Paper/testnet venues are recommended for first use.\n\n" +
    "Confirm to continue with live credentials:",
  inputType: "select",
  key: "exchangeLiveConfirmed",
  options: [
    { label: "I understand — this is real money, continue", value: "confirmed" },
    { label: "Go back — I'll pick a paper venue instead", value: "back" },
  ],
  show: (d) => !!d.exchange && d.exchange !== "skip" && !isSandboxExchange(d),
};

const EXCHANGE_CONFLICT_STEP: StepConfig = {
  id: "exchange-conflict",
  section: "exchange",
  title: "Exchange already configured",
  description:
    "You already have this exchange in your config. Update the existing credentials or add a second account?",
  inputType: "select",
  key: "exchangeConflictAction",
  options: [
    { label: "Update existing credentials", value: "update" },
    { label: "Add as second account (new ID)", value: "add" },
    { label: "Keep existing — skip", value: "skip" },
  ],
  show: (d, p) => !!d.exchange && d.exchange !== "skip" && p.exchanges.includes(d.exchange),
};

/** Resolve base exchange type from the selected value (handles sandbox variants). */
function baseExchangeType(d: Record<string, string>): string {
  const v = d.exchange ?? "";
  // Sandbox variants: "binance-testnet" → "binance", "okx-demo" → "okx", etc.
  if (v.startsWith("binance-")) return "binance";
  if (v.startsWith("coinbase-")) return "coinbase";
  if (v.startsWith("okx-")) return "okx";
  if (v.startsWith("gemini-")) return "gemini";
  if (v.startsWith("hyperliquid-")) return "hyperliquid";
  return v;
}

function isSandboxExchange(d: Record<string, string>): boolean {
  const v = d.exchange ?? "";
  return v.includes("-testnet") || v.includes("-sandbox") || v.includes("-demo");
}

/** True when the user chose an exchange AND isn't skipping the credential flow. */
function exchangeCredsNeeded(d: Record<string, string>, _p: SetupPreflight): boolean {
  if (!d.exchange || d.exchange === "skip") return false;
  if (d.exchangeConflictAction === "skip") return false;
  return true;
}

const EXCHANGE_API_KEY_STEP: StepConfig = {
  id: "exchange-api-key",
  section: "exchange",
  title: "Exchange API Key",
  description: "Paste the exchange API key:",
  inputType: "password",
  key: "exchangeApiKey",
  placeholder: "",
  show: (d, p) => {
    if (!exchangeCredsNeeded(d, p)) return false;
    const base = baseExchangeType(d);
    return base !== "hyperliquid";
  },
};

const EXCHANGE_API_SECRET_STEP: StepConfig = {
  id: "exchange-api-secret",
  section: "exchange",
  title: "Exchange API Secret",
  description:
    "Paste the exchange API secret (for Coinbase CDP keys: paste the full EC private key):",
  inputType: "password",
  key: "exchangeApiSecret",
  placeholder: "",
  show: (d, p) => {
    if (!exchangeCredsNeeded(d, p)) return false;
    const base = baseExchangeType(d);
    return base !== "hyperliquid";
  },
};

const EXCHANGE_PASSPHRASE_STEP: StepConfig = {
  id: "exchange-passphrase",
  section: "exchange",
  title: "Exchange Passphrase",
  description: "Coinbase / OKX require a passphrase in addition to the API key:",
  inputType: "password",
  key: "exchangePassphrase",
  placeholder: "",
  show: (d, p) => {
    if (!exchangeCredsNeeded(d, p)) return false;
    const base = baseExchangeType(d);
    return base === "coinbase" || base === "okx";
  },
};

const EXCHANGE_WALLET_STEP: StepConfig = {
  id: "exchange-wallet",
  section: "exchange",
  title: "Wallet Private Key",
  description:
    "Wallet-based venues sign orders directly. Use a DEDICATED trading/test wallet — never your main wallet.",
  inputType: "password",
  key: "exchangeWalletKey",
  placeholder: "0x...",
  show: (d, p) => {
    if (!exchangeCredsNeeded(d, p)) return false;
    const base = baseExchangeType(d);
    return base === "hyperliquid";
  },
};

const BROKER_STEP: StepConfig = {
  id: "broker",
  section: "broker",
  title: "Stock Broker",
  description: "Connect a stock broker? (skip if crypto-only)",
  inputType: "select",
  key: "broker",
  dynamicOptions: (_d, p) => {
    const base = [
      { label: "Alpaca", value: "alpaca" },
      { label: "tastytrade", value: "tastytrade" },
      { label: "Interactive Brokers", value: "ibkr" },
    ].map((opt) => ({
      ...opt,
      label: p.brokers.includes(opt.value) ? `${opt.label} (configured)` : opt.label,
    }));
    const prefix =
      p.brokers.length > 0 ? [{ label: "Keep existing — don't touch brokers", value: "skip" }] : [];
    return [
      ...prefix,
      ...base,
      ...(p.brokers.length === 0 ? [{ label: "Skip", value: "skip" }] : []),
    ];
  },
};

const BROKER_CONFLICT_STEP: StepConfig = {
  id: "broker-conflict",
  section: "broker",
  title: "Broker already configured",
  description:
    "You already have this broker in your config. Update the existing credentials or add a second account?",
  inputType: "select",
  key: "brokerConflictAction",
  options: [
    { label: "Update existing credentials", value: "update" },
    { label: "Add as second account (new ID)", value: "add" },
    { label: "Keep existing — skip", value: "skip" },
  ],
  show: (d, p) => !!d.broker && d.broker !== "skip" && p.brokers.includes(d.broker),
};

function brokerCredsNeeded(d: Record<string, string>, _p: SetupPreflight): boolean {
  if (!d.broker || d.broker === "skip") return false;
  if (d.brokerConflictAction === "skip") return false;
  return true;
}

const BROKER_API_KEY_STEP: StepConfig = {
  id: "broker-api-key",
  section: "broker",
  title: "Broker API Key",
  description: "Paste the broker API key:",
  inputType: "password",
  key: "brokerApiKey",
  placeholder: "",
  show: brokerCredsNeeded,
};

const BROKER_API_SECRET_STEP: StepConfig = {
  id: "broker-api-secret",
  section: "broker",
  title: "Broker API Secret",
  description: "Paste the broker API secret:",
  inputType: "password",
  key: "brokerApiSecret",
  placeholder: "",
  show: brokerCredsNeeded,
};

const BROKER_PAPER_STEP: StepConfig = {
  id: "broker-paper",
  section: "broker",
  title: "Paper or Live",
  description: "Start in paper-trading mode? (recommended for first use)",
  inputType: "select",
  key: "brokerPaper",
  options: [
    { label: "Paper (safe — simulated orders)", value: "paper" },
    { label: "Live (real money)", value: "live" },
  ],
  show: brokerCredsNeeded,
};

const RISK_LEVEL_STEP: StepConfig = {
  id: "risk-level",
  section: "preferences",
  title: "Risk Level",
  description: "How much risk per trade?",
  inputType: "select",
  key: "riskLevel",
  options: [
    { label: "Conservative (1% max)", value: "conservative" },
    { label: "Moderate (2% max)", value: "moderate" },
    { label: "Aggressive (5% max)", value: "aggressive" },
  ],
};

const PERMISSION_MODE_STEP: StepConfig = {
  id: "permission-mode",
  section: "preferences",
  title: "Permission Mode",
  description:
    "How should Gordon handle trade execution? Paper mode is the recommended first-run ramp — switch to live later with /mode.",
  inputType: "select",
  key: "permissionMode",
  options: [
    {
      label: "Paper — simulated orders only, no real money (recommended to start)",
      value: "paper",
    },
    { label: "Ask — approve each trade via dialog", value: "ask" },
    {
      label: "Auto — execute trades without asking (real money moves — I understand, go live)",
      value: "auto",
    },
    { label: "Strict — read-only, never trade", value: "strict" },
  ],
  // Skip if the user already has a non-default permissionMode set.
  show: (_d, p) => !p.permissionMode || p.permissionMode === "ask",
};

const RISK_DISCLOSURE_STEP: StepConfig = {
  id: "risk-disclosure",
  section: "preferences",
  title: "Risk Disclosure",
  description:
    "Gordon can place REAL trades with REAL money.\n" +
    "- Gordon is not a broker and not investment advice; it trades your own\n" +
    "  venue accounts under your own keys (see DISCLAIMER.md and TERMS.md)\n" +
    "- Always review orders before approving\n" +
    "- Use /strict for read-only mode when exploring\n" +
    "- Set stop losses — Gordon follows your risk rules\n" +
    "- Start with paper trading or small sizes\n\n" +
    "Select 'I understand' to continue:",
  inputType: "select",
  key: "riskAcknowledged",
  options: [{ label: "I understand the risks", value: "acknowledged" }],
};

const KEYBINDINGS_STEP: StepConfig = {
  id: "keybindings",
  section: "preferences",
  title: "Keyboard Shortcuts",
  description:
    "Gordon supports custom keybindings:\n" +
    "- Ctrl+P: Command palette\n" +
    "- Ctrl+Y: Quick approve trade\n" +
    "- Ctrl+N: Quick deny trade\n" +
    "- Customize in ~/.gordon/keybindings.json\n\n" +
    "Ready to start?",
  inputType: "select",
  key: "keybindingsAcknowledged",
  options: [{ label: "Let's go!", value: "ready" }],
};

// Exported for tests — the paper-first ordering of the exchange and
// permission-mode steps is a safety default that must not regress silently.
export const ALL_STEPS: StepConfig[] = [
  LLM_PROVIDER_STEP,
  LLM_KEY_STEP,
  EXCHANGE_STEP,
  EXCHANGE_LIVE_CONFIRM_STEP,
  EXCHANGE_CONFLICT_STEP,
  EXCHANGE_API_KEY_STEP,
  EXCHANGE_API_SECRET_STEP,
  EXCHANGE_PASSPHRASE_STEP,
  EXCHANGE_WALLET_STEP,
  BROKER_STEP,
  BROKER_CONFLICT_STEP,
  BROKER_API_KEY_STEP,
  BROKER_API_SECRET_STEP,
  BROKER_PAPER_STEP,
  RISK_LEVEL_STEP,
  PERMISSION_MODE_STEP,
  RISK_DISCLOSURE_STEP,
  KEYBINDINGS_STEP,
];

// ============================================================================
// Component
// ============================================================================

export function SetupWizard({ onComplete, onSkip, preflight }: Props) {
  const pre = preflight ?? EMPTY_PREFLIGHT;
  const [stepIndex, setStepIndex] = useState(0);
  const [data, setData] = useState<Record<string, string>>({});

  useInput((_input, key) => {
    if (key.escape) {
      onSkip();
    }
  });

  // Filter to only the steps that apply given the current data + preflight.
  const activeSteps = useMemo(
    () => ALL_STEPS.filter((s) => !s.show || s.show(data, pre)),
    [data, pre],
  );

  const step = activeSteps[stepIndex];
  useEffect(() => {
    if (!step) onComplete(data);
  }, [data, onComplete, step]);

  const handleValue = useCallback(
    (value: string) => {
      if (!step) return;
      if (step.id === "exchange-live-confirm" && value === "back") {
        const { exchangeLiveConfirmed: _dropped, ...rest } = data;
        const resetData = { ...rest, exchange: "skip" };
        setData(resetData);
        const nextActive = ALL_STEPS.filter((s) => !s.show || s.show(resetData, pre));
        const exchangeIdx = nextActive.findIndex((s) => s.id === "exchange");
        setStepIndex(exchangeIdx >= 0 ? exchangeIdx : 0);
        return;
      }

      const newData = { ...data, [step.key]: value };
      setData(newData);

      // Recompute active steps with the NEW data and advance to the next
      // applicable step (handles steps that only appear after a selection).
      const nextActive = ALL_STEPS.filter((s) => !s.show || s.show(newData, pre));
      const currentIdxInNext = nextActive.findIndex((s) => s.id === step.id);
      const nextIdx = currentIdxInNext + 1;

      if (nextIdx < nextActive.length) {
        setStepIndex(nextIdx);
      } else {
        onComplete(newData);
      }
    },
    [data, step, onComplete, pre],
  );

  if (!step) return null;

  const stepOptions = step.dynamicOptions ? step.dynamicOptions(data, pre) : step.options;

  const progress = `${stepIndex + 1}/${activeSteps.length}`;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box>
        <Text bold color="yellow">
          GORDON SETUP
        </Text>
        <Text dimColor> ({progress})</Text>
      </Box>
      <Text> </Text>

      {/* Progress indicators */}
      <Box>
        {activeSteps.map((s, i) => (
          <Text key={s.id} color={i < stepIndex ? "green" : i === stepIndex ? "yellow" : "gray"}>
            {i < stepIndex ? " \u2713 " : i === stepIndex ? " \u25CF " : " \u25CB "}
          </Text>
        ))}
      </Box>
      <Text> </Text>

      {/* Step content */}
      <Text bold>{step.title}</Text>
      <Text dimColor>{step.description}</Text>
      <Text> </Text>

      {step.inputType === "select" && stepOptions ? (
        <Select options={stepOptions} onChange={handleValue} />
      ) : step.inputType === "password" ? (
        <PasswordInput placeholder={step.placeholder ?? ""} onSubmit={handleValue} />
      ) : (
        <TextInput placeholder={step.placeholder ?? ""} onSubmit={handleValue} />
      )}

      <Text> </Text>
      <Text dimColor>Esc to skip setup · Enter to continue</Text>
    </Box>
  );
}
