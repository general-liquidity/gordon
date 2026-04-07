import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput } from "@inkjs/ui";

/**
 * ExchangePicker — Interactive exchange selector + setup wizard
 *
 * Step 1: Pick action (add, switch, remove, status)
 * Step 2: Pick exchange from list
 * Step 3: Enter credentials (if adding)
 */

interface Props {
  activeExchange: string | null;
  configuredExchanges: string[];
  onComplete: (action: string, exchange: string, credentials?: Record<string, string>) => void;
  onCancel: () => void;
}

const EXCHANGES = [
  { label: "Binance", value: "binance" },
  { label: "Binance US", value: "binance_us" },
  { label: "Coinbase", value: "coinbase" },
  { label: "Kraken", value: "kraken" },
  { label: "Bitfinex", value: "bitfinex" },
  { label: "Hyperliquid", value: "hyperliquid" },
  { label: "OKX", value: "okx" },
  { label: "Gemini", value: "gemini" },
  { label: "Robinhood", value: "robinhood" },
  { label: "Uniswap", value: "uniswap" },
];

const ACTIONS = [
  { label: "Add new exchange", value: "add" },
  { label: "Switch active exchange", value: "switch" },
  { label: "Remove exchange", value: "remove" },
  { label: "Check status", value: "status" },
];

type Step = "action" | "exchange" | "apiKey" | "apiSecret";

export function ExchangePicker({ activeExchange, configuredExchanges, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("action");
  const [action, setAction] = useState("");
  const [exchange, setExchange] = useState("");
  const [apiKey, setApiKey] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "action") onCancel();
      else setStep("action");
    }
  });

  const handleAction = useCallback((value: string) => {
    setAction(value);
    if (value === "status") {
      onComplete("status", activeExchange ?? "none");
    } else {
      setStep("exchange");
    }
  }, [activeExchange, onComplete]);

  const handleExchange = useCallback((value: string) => {
    setExchange(value);
    if (action === "add") {
      setStep("apiKey");
    } else {
      onComplete(action, value);
    }
  }, [action, onComplete]);

  const handleApiKey = useCallback((value: string) => {
    setApiKey(value);
    setStep("apiSecret");
  }, []);

  const handleApiSecret = useCallback((value: string) => {
    onComplete(action, exchange, { apiKey, apiSecret: value });
  }, [action, exchange, apiKey, onComplete]);

  const title = step === "action" ? "What would you like to do?"
    : step === "exchange" ? `Select exchange to ${action}`
    : step === "apiKey" ? `Enter ${exchange} API key`
    : `Enter ${exchange} API secret`;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">EXCHANGE SETUP</Text>
        {activeExchange && <Text dimColor>  (active: {activeExchange})</Text>}
      </Box>

      <Text bold>{title}</Text>
      {configuredExchanges.length > 0 && step === "action" && (
        <Text dimColor>Configured: {configuredExchanges.join(", ")}</Text>
      )}
      <Box marginTop={1}>
        {step === "action" && <Select options={ACTIONS} onChange={handleAction} />}
        {step === "exchange" && <Select options={EXCHANGES} onChange={handleExchange} />}
        {step === "apiKey" && <TextInput placeholder="API key..." onSubmit={handleApiKey} />}
        {step === "apiSecret" && <TextInput placeholder="API secret..." onSubmit={handleApiSecret} />}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc {step !== "action" ? "to go back" : "to cancel"} {"\u00B7"} Enter to {step === "apiKey" || step === "apiSecret" ? "submit" : "select"}</Text>
      </Box>
    </Box>
  );
}
