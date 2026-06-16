import React from "react";
import { Box, Text } from "../../ink-custom";
import { Select, TextInput } from "@inkjs/ui";
import { MultiStepPicker, type PickerStep } from "../../design-system/MultiStepPicker.tsx";

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
  { label: "MetaTrader 5 (Model to Market)", value: "mt5" },
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

interface BrokerPickerData {
  action: string;
  broker: string;
  apiKey: string;
  apiSecret: string;
}

export function BrokerPicker({ activeBroker, configuredBrokers, onComplete, onCancel }: Props) {
  const steps: Record<string, PickerStep<BrokerPickerData>> = {
    action: {
      hint: configuredBrokers.length > 0 ? `Configured: ${configuredBrokers.join(", ")}` : undefined,
      render: (ctx) => (
        <Select
          options={ACTIONS}
          onChange={(value) => {
            ctx.set("action", value);
            if (value === "status") onComplete("status", activeBroker ?? "none");
            else ctx.go("broker");
          }}
        />
      ),
    },
    broker: {
      render: (ctx) => (
        <Select
          options={BROKERS}
          onChange={(value) => {
            ctx.set("broker", value);
            if (ctx.data.action === "add") ctx.go("apiKey");
            else onComplete(ctx.data.action ?? "", value);
          }}
        />
      ),
    },
    apiKey: {
      render: (ctx) => (
        <>
          <Text bold>Enter {ctx.data.broker} API key:</Text>
          <TextInput
            placeholder="API key..."
            onSubmit={(value) => {
              ctx.set("apiKey", value);
              ctx.go("apiSecret");
            }}
          />
        </>
      ),
    },
    apiSecret: {
      render: (ctx) => (
        <>
          <Text bold>Enter {ctx.data.broker} API secret:</Text>
          <TextInput
            placeholder="API secret..."
            onSubmit={(value) => {
              onComplete(ctx.data.action ?? "", ctx.data.broker ?? "", {
                apiKey: ctx.data.apiKey ?? "",
                apiSecret: value,
              });
            }}
          />
        </>
      ),
    },
  };

  return (
    <MultiStepPicker<BrokerPickerData>
      title="BROKER SETUP"
      titleNote={activeBroker ? `(active: ${activeBroker})` : undefined}
      steps={steps}
      initialStep="action"
      onComplete={(data) => onComplete(data.action, data.broker, data.apiKey ? { apiKey: data.apiKey, apiSecret: data.apiSecret } : undefined)}
      onCancel={onCancel}
    />
  );
}
