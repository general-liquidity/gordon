import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";
import { COLORS } from "./theme.ts";

type OnboardingStep = "welcome" | "how-it-works" | "strategies" | "smart-strategies" | "safety" | "get-started";

const STEPS: OnboardingStep[] = ["welcome", "how-it-works", "strategies", "smart-strategies", "safety", "get-started"];

interface OnboardingProps {
  onComplete: (options: { setupApiKeys: boolean; demoMode: boolean }) => void;
}

function StepIndicator({ currentStep }: { currentStep: OnboardingStep }): React.ReactElement {
  const currentIndex = STEPS.indexOf(currentStep);

  return (
    <Box marginBottom={1}>
      {STEPS.map((step, index) => {
        const isActive = index === currentIndex;
        const isPast = index < currentIndex;
        const color = isActive ? COLORS.ACCENT : isPast ? COLORS.GREEN : COLORS.DIM;
        const symbol = isPast ? "o" : isActive ? "@" : "o";

        return (
          <Box key={step}>
            <Text color={color}>{symbol}</Text>
            {index < STEPS.length - 1 && <Text color={COLORS.DIM}> - </Text>}
          </Box>
        );
      })}
    </Box>
  );
}

function WelcomeStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          "Greed is good... but so is risk management."
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Hey there. I'm <Text bold color={COLORS.ACCENT}>Gordon</Text>, your AI trading assistant.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.DIM}>
          I help you find and execute trades in crypto markets.
        </Text>
        <Text color={COLORS.DIM}>
          Think of me as a trading buddy who never sleeps, never panics,
        </Text>
        <Text color={COLORS.DIM}>
          and always has a plan.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Let me show you how this works...
        </Text>
      </Box>
    </Box>
  );
}

function HowItWorksStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          How It Works
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Chat naturally or use <Text color={COLORS.HIGHLIGHT}>/commands</Text> for quick actions:
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        <Text color={COLORS.ACCENT_DIM} italic>"Find me a good BTC setup"</Text>
        <Text color={COLORS.ACCENT_DIM} italic>"What's the market looking like?"</Text>
        <Text color={COLORS.ACCENT_DIM}>
          <Text color={COLORS.HIGHLIGHT}>/trending</Text>
          <Text color={COLORS.ACCENT_DIM} italic> - see what's pumping</Text>
        </Text>
        <Text color={COLORS.ACCENT_DIM}>
          <Text color={COLORS.HIGHLIGHT}>/scan</Text>
          <Text color={COLORS.ACCENT_DIM} italic> - find trading opportunities</Text>
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          I have <Text color={COLORS.HIGHLIGHT} bold>350+ tools</Text> and <Text color={COLORS.HIGHLIGHT} bold>6 specialized agents</Text>:
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Scanner</Text></Box>
          <Text color={COLORS.DIM}>Find setups across the market</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Analyst</Text></Box>
          <Text color={COLORS.DIM}>Deep technical analysis</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Planner</Text></Box>
          <Text color={COLORS.DIM}>Create detailed trade plans</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Executor</Text></Box>
          <Text color={COLORS.DIM}>Place orders when armed</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Monitor</Text></Box>
          <Text color={COLORS.DIM}>Track your positions</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Teacher</Text></Box>
          <Text color={COLORS.DIM}>Explain trading concepts</Text>
        </Box>
      </Box>

      <Box marginTop={1} marginBottom={1}>
        <Text color={COLORS.WHITE}>
          <Text color={COLORS.HIGHLIGHT} bold>Supported Chains:</Text>
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Solana</Text></Box>
          <Text color={COLORS.DIM}>DeFi, tokens, staking, lending (60+ tools)</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Polkadot</Text></Box>
          <Text color={COLORS.DIM}>Cross-chain swaps, staking, governance</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>EVM</Text></Box>
          <Text color={COLORS.DIM}>Bridging via Chainlink CCIP, on-chain price feeds</Text>
        </Box>
        <Box>
          <Box width={12}><Text color={COLORS.WHITE} bold>Base</Text></Box>
          <Text color={COLORS.DIM}>Smart wallets via Coinbase CDP</Text>
        </Box>
      </Box>
    </Box>
  );
}

function StrategiesStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          Trading Strategies
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          I come with <Text color={COLORS.HIGHLIGHT} bold>battle-tested strategies</Text> for different market conditions:
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.DIM} bold>Beginner (Tier 1):</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>Support Bounce</Text> - Buy near support levels</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>Bollinger Bounce</Text> - Mean reversion at bands</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>SMA Crossover</Text> - Classic Golden Cross</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>Volume Surge</Text> - High volume breakouts</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>VWAP Bounce</Text> - Intraday fair value</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.DIM} bold>Intermediate (Tier 2):</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>EMA+RSI Crossover</Text> - Momentum filtered</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>Engulfing Pattern</Text> - Candlestick reversal</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>ADX Trend</Text> - Strong trend trading</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>Consolidation Pop</Text> - Range breakouts</Text>
          <Text color={COLORS.DIM}>• <Text color={COLORS.WHITE}>Relative Strength</Text> - BTC outperformers</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.DIM} bold>Playbooks (v0.7):</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text color={COLORS.DIM}>
            Gordon also supports <Text color={COLORS.WHITE}>Playbooks</Text> — formal, machine-readable trading strategies:
          </Text>
          <Box paddingLeft={2} flexDirection="column" marginTop={1}>
            <Box>
              <Box width={22}><Text color={COLORS.WHITE}>momentum-breakout</Text></Box>
              <Text color={COLORS.DIM}>Breakout with volume confirmation</Text>
            </Box>
            <Box>
              <Box width={22}><Text color={COLORS.WHITE}>mean-reversion</Text></Box>
              <Text color={COLORS.DIM}>RSI bounce at support levels</Text>
            </Box>
            <Box>
              <Box width={22}><Text color={COLORS.WHITE}>trend-following</Text></Box>
              <Text color={COLORS.DIM}>EMA crossover trend following</Text>
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Playbooks can be backtested, deployed as live strategies, and evolved over time.
            </Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Type <Text color={COLORS.HIGHLIGHT}>/strategies</Text> anytime to see all strategies,
        </Text>
      </Box>
      <Box>
        <Text color={COLORS.DIM}>
          or <Text color={COLORS.HIGHLIGHT}>/strategy support_bounce</Text> for details.
        </Text>
      </Box>
    </Box>
  );
}

function SmartStrategiesStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          Smart Strategy Management
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon doesn't just run strategies — he <Text color={COLORS.HIGHLIGHT} bold>manages</Text> them intelligently:
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        <Box marginBottom={1} flexDirection="column">
          <Text color={COLORS.WHITE} bold>Market Regime Detection</Text>
          <Box paddingLeft={2}>
            <Text color={COLORS.DIM}>
              Classifies conditions (trending, ranging, volatile, quiet) and automatically matches the right playbook.
            </Text>
          </Box>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text color={COLORS.WHITE} bold>Strategy Runtime</Text>
          <Box paddingLeft={2}>
            <Text color={COLORS.DIM}>
              Run multiple strategies simultaneously with portfolio-level risk management and capital allocation.
            </Text>
          </Box>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text color={COLORS.WHITE} bold>Strategy Evolution</Text>
          <Box paddingLeft={2}>
            <Text color={COLORS.DIM}>
              Fork, mutate, and A/B test playbook variants — keeping what works, deprecating what doesn't.
            </Text>
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text color={COLORS.WHITE} bold>Audit Trail</Text>
          <Box paddingLeft={2}>
            <Text color={COLORS.DIM}>
              Every decision is traced from trigger to outcome — ask "why did you buy X?" and get a complete answer.
            </Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Type <Text color={COLORS.HIGHLIGHT}>/strategies-live</Text> to view running strategies,
          or <Text color={COLORS.HIGHLIGHT}>/regime</Text> to check market conditions.
        </Text>
      </Box>
    </Box>
  );
}

function SafetyStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          Safety First
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          I have two modes to keep your funds safe:
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color={COLORS.GREEN} bold>[o] SAFE</Text>
            <Text color={COLORS.DIM}> - Read-only mode (default)</Text>
          </Box>
          <Box paddingLeft={4}>
            <Text color={COLORS.DIM}>I can scan, analyze, and plan but won't touch your funds.</Text>
          </Box>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color={COLORS.RED} bold>[!] ARMED</Text>
            <Text color={COLORS.DIM}> - Live trading enabled</Text>
          </Box>
          <Box paddingLeft={4}>
            <Text color={COLORS.DIM}>I can place orders, but only after you approve each trade.</Text>
          </Box>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        <Box>
          <Text color={COLORS.HIGHLIGHT}>!</Text>
          <Text color={COLORS.WHITE} bold> I never trade without your explicit approval.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>
            Type <Text color={COLORS.HIGHLIGHT}>/arm</Text> to enable trading, <Text color={COLORS.HIGHLIGHT}>/disarm</Text> to return to safe mode.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>
            ARMED mode auto-disarms after 24 hours for extra safety.
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

interface GetStartedStepProps {
  onSelect: (option: "setup" | "demo") => void;
}

function GetStartedStep({ onSelect }: GetStartedStepProps): React.ReactElement {
  const options = [
    {
      label: "Set up API keys now - Connect your exchange and start trading",
      value: "setup" as const,
    },
    {
      label: "Explore in demo mode - Read-only, perfect for kicking the tires",
      value: "demo" as const,
    },
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          Ready to Get Started?
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          How would you like to begin?
        </Text>
      </Box>

      <Box marginTop={1}>
        <Select
          options={options}
          onChange={(value) => onSelect(value as "setup" | "demo")}
        />
      </Box>

      <Box marginTop={2} flexDirection="column">
        <Text color={COLORS.DIM}>
          First time? Try <Text color={COLORS.HIGHLIGHT}>/trending</Text> to see what's moving,
        </Text>
        <Text color={COLORS.DIM}>
          or just ask: "What should I trade today?"
        </Text>
      </Box>
    </Box>
  );
}

export function Onboarding({ onComplete }: OnboardingProps): React.ReactElement {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");

  const currentIndex = STEPS.indexOf(currentStep);
  const isLastStep = currentStep === "get-started";

  const handleFinalSelect = (option: "setup" | "demo") => {
    onComplete({
      setupApiKeys: option === "setup",
      demoMode: option === "demo",
    });
  };

  useInput((input, key) => {
    // Don't handle input on last step - Select component handles it
    if (isLastStep) return;

    // Navigate between steps
    if (key.leftArrow && currentIndex > 0) {
      setCurrentStep(STEPS[currentIndex - 1] ?? "welcome");
    } else if (key.rightArrow && currentIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentIndex + 1] ?? "get-started");
    }

    // Enter to continue
    if (key.return) {
      const nextStep = STEPS[currentIndex + 1];
      if (nextStep) {
        setCurrentStep(nextStep);
      }
    }
  });

  function renderStepContent(): React.ReactElement {
    switch (currentStep) {
      case "welcome":
        return <WelcomeStep />;
      case "how-it-works":
        return <HowItWorksStep />;
      case "strategies":
        return <StrategiesStep />;
      case "smart-strategies":
        return <SmartStrategiesStep />;
      case "safety":
        return <SafetyStep />;
      case "get-started":
        return <GetStartedStep onSelect={handleFinalSelect} />;
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <StepIndicator currentStep={currentStep} />

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={COLORS.ACCENT_DIM}
        paddingX={2}
        paddingY={1}
        minHeight={16}
      >
        {renderStepContent()}
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Text color={COLORS.DIM}>
          {currentIndex > 0 ? "Back" : ""}
        </Text>
        <Text color={COLORS.DIM}>
          Step {currentIndex + 1} of {STEPS.length}
        </Text>
        <Text color={COLORS.DIM}>
          {isLastStep ? "Enter to select" : "Enter to continue"}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Navigate: left/right arrows | {isLastStep ? "Select: up/down or j/k | " : ""}Confirm: Enter
        </Text>
      </Box>
    </Box>
  );
}

export default Onboarding;
