import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS } from "./theme.ts";

type OnboardingStep = "welcome" | "how-it-works" | "safety" | "get-started";

const STEPS: OnboardingStep[] = ["welcome", "how-it-works", "safety", "get-started"];

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
        const color = isActive ? COLORS.TAN : isPast ? COLORS.GREEN : COLORS.DIM;
        const symbol = isPast ? "●" : isActive ? "◉" : "○";

        return (
          <Box key={step}>
            <Text color={color}>{symbol}</Text>
            {index < STEPS.length - 1 && <Text color={COLORS.DIM}> — </Text>}
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
        <Text color={COLORS.TAN} bold>
          "Greed is good... but so is risk management."
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Hey there. I'm <Text bold color={COLORS.TAN}>Gordon</Text>, your AI trading assistant.
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
  const flowSteps = [
    { icon: "💬", label: "Chat", desc: "Tell me what you're thinking" },
    { icon: "🔍", label: "Scan", desc: "I search for opportunities" },
    { icon: "📊", label: "Analyze", desc: "I crunch the numbers" },
    { icon: "📋", label: "Plan", desc: "I create a detailed trade plan" },
    { icon: "✓", label: "Approve", desc: "You review and approve" },
    { icon: "⚡", label: "Execute", desc: "I place the orders" },
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          How It Works
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Just talk to me naturally. Say things like:
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        <Text color={COLORS.TAN_DIM} italic>"Find me a good BTC setup"</Text>
        <Text color={COLORS.TAN_DIM} italic>"What's the market looking like?"</Text>
        <Text color={COLORS.TAN_DIM} italic>"I want to buy ETH with 10% of my portfolio"</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          I handle all the technical stuff:
        </Text>
      </Box>

      <Box flexDirection="column">
        {flowSteps.map((step, index) => (
          <Box key={step.label}>
            <Text color={COLORS.DIM}>{step.icon} </Text>
            <Box width={10}>
              <Text color={COLORS.WHITE} bold>{step.label}</Text>
            </Box>
            <Text color={COLORS.DIM}>→ {step.desc}</Text>
            {index < flowSteps.length - 1 && (
              <Text color={COLORS.DIM}></Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function SafetyStep(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Safety First
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          I have two modes:
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Text color={COLORS.GREEN} bold>[SAFE]</Text>
          <Text color={COLORS.DIM}> — Read-only. I can scan, analyze, and plan,</Text>
        </Box>
        <Box paddingLeft={7} marginBottom={1}>
          <Text color={COLORS.DIM}>but I won't touch your funds. Perfect for learning.</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color={COLORS.RED} bold>[ARMED]</Text>
          <Text color={COLORS.DIM}> — I can place orders on your behalf,</Text>
        </Box>
        <Box paddingLeft={7}>
          <Text color={COLORS.DIM}>but only after you explicitly approve each trade.</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        <Box>
          <Text color={COLORS.HIGHLIGHT}>⚠</Text>
          <Text color={COLORS.WHITE} bold> I never trade without your explicit approval.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>
            ARMED mode auto-disarms after 24 hours for extra safety.
          </Text>
        </Box>
        <Box>
          <Text color={COLORS.DIM}>
            You start in SAFE mode by default. Always.
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

interface GetStartedStepProps {
  selectedOption: number;
}

function GetStartedStep({ selectedOption }: GetStartedStepProps): React.ReactElement {
  const options = [
    {
      label: "Set up API keys now",
      description: "Connect to Binance and start trading",
    },
    {
      label: "Explore in demo mode",
      description: "Read-only, no real trades — perfect for kicking the tires",
    },
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Ready to Get Started?
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.WHITE}>
          How would you like to begin?
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => {
          const isSelected = index === selectedOption;

          return (
            <Box key={option.label} marginBottom={1} flexDirection="column">
              <Box>
                <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.DIM}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text
                  color={isSelected ? COLORS.HIGHLIGHT : COLORS.WHITE}
                  bold={isSelected}
                >
                  {" "}{option.label}
                </Text>
              </Box>
              <Box paddingLeft={3}>
                <Text color={COLORS.DIM}>{option.description}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export function Onboarding({ onComplete }: OnboardingProps): React.ReactElement {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [selectedOption, setSelectedOption] = useState(0);

  const currentIndex = STEPS.indexOf(currentStep);
  const isLastStep = currentStep === "get-started";

  useInput((input, key) => {
    // Navigation with j/k or arrow keys
    if (isLastStep) {
      if (key.upArrow || input === "k") {
        setSelectedOption((prev) => (prev > 0 ? prev - 1 : 1));
      } else if (key.downArrow || input === "j") {
        setSelectedOption((prev) => (prev < 1 ? prev + 1 : 0));
      }
    }

    // Navigate between steps
    if (key.leftArrow && currentIndex > 0) {
      setCurrentStep(STEPS[currentIndex - 1] ?? "welcome");
    } else if (key.rightArrow && currentIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentIndex + 1] ?? "get-started");
    }

    // Enter to continue or select
    if (key.return) {
      if (isLastStep) {
        onComplete({
          setupApiKeys: selectedOption === 0,
          demoMode: selectedOption === 1,
        });
      } else {
        const nextStep = STEPS[currentIndex + 1];
        if (nextStep) {
          setCurrentStep(nextStep);
        }
      }
    }
  });

  function renderStepContent(): React.ReactElement {
    switch (currentStep) {
      case "welcome":
        return <WelcomeStep />;
      case "how-it-works":
        return <HowItWorksStep />;
      case "safety":
        return <SafetyStep />;
      case "get-started":
        return <GetStartedStep selectedOption={selectedOption} />;
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <StepIndicator currentStep={currentStep} />

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={COLORS.TAN_DIM}
        paddingX={2}
        paddingY={1}
        minHeight={16}
      >
        {renderStepContent()}
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Text color={COLORS.DIM}>
          {currentIndex > 0 ? "← Back" : ""}
        </Text>
        <Text color={COLORS.DIM}>
          Step {currentIndex + 1} of {STEPS.length}
        </Text>
        <Text color={COLORS.DIM}>
          {isLastStep ? "Enter to select →" : "Enter to continue →"}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Navigate: ←/→ arrows | {isLastStep ? "Select: ↑/↓ or j/k | " : ""}Confirm: Enter
        </Text>
      </Box>
    </Box>
  );
}

export default Onboarding;
