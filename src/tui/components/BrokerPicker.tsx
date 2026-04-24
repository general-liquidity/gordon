import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Select, TextInput } from "@inkjs/ui";

/**
 * BrokerPicker — Interactive broker selector + setup wizard
 */

interface Props {
  activeBroker: string | null;
  configuredBrokers: string[];
  onComplete: (action: string, broker: string, credentials?: Record<string, string>) => void;
  onCancel: () => void;
}

const BROKERS = [
  { label: "Alpaca", value: "alpaca" },
  { label: "Charles Schwab", value: "schwab" },
  { label: "Tradier", value: "tradier" },
  { label: "TradeStation", value: "tradestation" },
  { label: "tastytrade", value: "tastytrade" },
  { label: "Interactive Brokers", value: "ibkr" },
  { label: "E*TRADE", value: "etrade" },
  { label: "Webull", value: "webull" },
  { label: "Trading212", value: "trading212" },
];

const ACTIONS = [
  { label: "Add new broker", value: "add" },
  { label: "Switch active broker", value: "switch" },
  { label: "Remove broker", value: "remove" },
  { label: "Check status", value: "status" },
  { label: "Connect via OAuth", value: "oauth" },
];

type Step = "action" | "broker" | "apiKey" | "apiSecret";

export function BrokerPicker({ activeBroker, configuredBrokers, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("action");
  const [action, setAction] = useState("");
  const [broker, setBroker] = useState("");
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
      onComplete("status", activeBroker ?? "none");
    } else {
      setStep("broker");
    }
  }, [activeBroker, onComplete]);

  const handleBroker = useCallback((value: string) => {
    setBroker(value);
    if (action === "add") setStep("apiKey");
    else onComplete(action, value);
  }, [action, onComplete]);

  const handleApiKey = useCallback((value: string) => {
    setApiKey(value);
    setStep("apiSecret");
  }, []);

  const handleApiSecret = useCallback((value: string) => {
    onComplete(action, broker, { apiKey, apiSecret: value });
  }, [action, broker, apiKey, onComplete]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">BROKER SETUP</Text>
        {activeBroker && <Text dimColor>  (active: {activeBroker})</Text>}
      </Box>
      {configuredBrokers.length > 0 && step === "action" && (
        <Text dimColor>Configured: {configuredBrokers.join(", ")}</Text>
      )}
      <Box marginTop={1}>
        {step === "action" && <Select options={ACTIONS} onChange={handleAction} />}
        {step === "broker" && <Select options={BROKERS} onChange={handleBroker} />}
        {step === "apiKey" && (
          <>
            <Text bold>Enter {broker} API key:</Text>
            <TextInput placeholder="API key..." onSubmit={handleApiKey} />
          </>
        )}
        {step === "apiSecret" && (
          <>
            <Text bold>Enter {broker} API secret:</Text>
            <TextInput placeholder="API secret..." onSubmit={handleApiSecret} />
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc {step !== "action" ? "to go back" : "to cancel"} {"\u00B7"} Enter to continue</Text>
      </Box>
    </Box>
  );
}
