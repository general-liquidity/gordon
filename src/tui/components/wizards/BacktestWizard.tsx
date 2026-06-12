/**
 * BacktestWizard — Multi-step backtest configuration.
 *
 * 5 steps: strategy, symbol+timeframe, dates+capital, optimization, review.
 */

import React, { useState, type Dispatch, type SetStateAction } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { MultiStepPicker, type PickerStep } from "../../design-system/MultiStepPicker.tsx";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export interface BacktestConfig {
  strategyId: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  optimization: "none" | "grid" | "random";
}

interface Props {
  strategies: string[];
  onRun: (config: BacktestConfig) => void;
  onCancel: () => void;
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
const OPT_MODES: Array<"none" | "grid" | "random"> = ["none", "grid", "random"];

interface StrategyStepProps {
  strategies: string[];
  cursor: number;
  setCursor: Dispatch<SetStateAction<number>>;
  onNext: () => void;
}

function StrategyStep({ strategies, cursor, setCursor, onNext }: StrategyStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((_input, key) => {
    if (key.upArrow) setCursor((current) => Math.max(0, current - 1));
    if (key.downArrow) setCursor((current) => Math.min(Math.max(0, strategies.length - 1), current + 1));
    if (key.return) onNext();
  });

  return (
    <Box flexDirection="column">
      <Text bold>Select Strategy:</Text>
      {strategies.map((strategy, index) => {
        const isFocused = index === cursor;
        return (
          <Box key={strategy} paddingLeft={2}>
            <Text color={isFocused ? theme.uiBrand : undefined}>
              {isFocused ? "\u25B8 " : "  "}{strategy}
            </Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>{"\u2191\u2193"} select {"\u00b7"} Enter next</Text>
    </Box>
  );
}

interface SymbolStepProps {
  symbol: string;
  setSymbol: Dispatch<SetStateAction<string>>;
  timeframeCursor: number;
  setTimeframeCursor: Dispatch<SetStateAction<number>>;
  activeField: number;
  setActiveField: Dispatch<SetStateAction<number>>;
  onNext: () => void;
}

function SymbolStep({
  symbol,
  setSymbol,
  timeframeCursor,
  setTimeframeCursor,
  activeField,
  setActiveField,
  onNext,
}: SymbolStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((input, key) => {
    if (key.tab) {
      setActiveField((field) => (field + 1) % 2);
      return;
    }

    if (activeField === 0) {
      if (key.return) {
        setActiveField(1);
        return;
      }
      if (key.backspace || key.delete) {
        setSymbol((current) => current.slice(0, -1));
        return;
      }
      if (input && !key.upArrow && !key.downArrow) {
        setSymbol((current) => current + input.toUpperCase());
        return;
      }
    }

    if (activeField === 1) {
      if (key.upArrow) setTimeframeCursor((current) => Math.max(0, current - 1));
      if (key.downArrow) setTimeframeCursor((current) => Math.min(TIMEFRAMES.length - 1, current + 1));
      if (key.return) {
        setActiveField(0);
        onNext();
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={activeField === 0 ? theme.uiBrand : undefined}>Symbol: </Text>
        <Text>{symbol || "..."}</Text>
        {activeField === 0 ? <Text color={theme.uiBrand}>{"\u2588"}</Text> : null}
      </Box>
      <Text> </Text>
      <Text bold color={activeField === 1 ? theme.uiBrand : undefined}>Timeframe:</Text>
      {TIMEFRAMES.map((timeframe, index) => {
        const isFocused = activeField === 1 && index === timeframeCursor;
        return (
          <Box key={timeframe} paddingLeft={2}>
            <Text color={isFocused ? theme.uiBrand : undefined}>
              {isFocused ? "\u25B8 " : "  "}{timeframe}
            </Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>Tab switch fields {"\u00b7"} Enter next</Text>
    </Box>
  );
}

interface DatesStepProps {
  startDate: string;
  setStartDate: Dispatch<SetStateAction<string>>;
  endDate: string;
  setEndDate: Dispatch<SetStateAction<string>>;
  capital: string;
  setCapital: Dispatch<SetStateAction<string>>;
  activeField: number;
  setActiveField: Dispatch<SetStateAction<number>>;
  onNext: () => void;
}

function DatesStep({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  capital,
  setCapital,
  activeField,
  setActiveField,
  onNext,
}: DatesStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((input, key) => {
    if (key.tab) {
      setActiveField((field) => (field + 1) % 3);
      return;
    }
    if (key.return) {
      if (activeField < 2) {
        setActiveField((field) => field + 1);
      } else {
        setActiveField(0);
        onNext();
      }
      return;
    }
    if (key.backspace || key.delete) {
      if (activeField === 0) setStartDate((current) => current.slice(0, -1));
      if (activeField === 1) setEndDate((current) => current.slice(0, -1));
      if (activeField === 2) setCapital((current) => current.slice(0, -1));
      return;
    }
    if (input && !key.upArrow && !key.downArrow) {
      if (activeField === 0) setStartDate((current) => current + input);
      if (activeField === 1) setEndDate((current) => current + input);
      if (activeField === 2) setCapital((current) => current + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={activeField === 0 ? theme.uiBrand : undefined}>Start Date: </Text>
        <Text>{startDate}</Text>
        {activeField === 0 ? <Text color={theme.uiBrand}>{"\u2588"}</Text> : null}
      </Box>
      <Box>
        <Text bold color={activeField === 1 ? theme.uiBrand : undefined}>End Date:   </Text>
        <Text>{endDate}</Text>
        {activeField === 1 ? <Text color={theme.uiBrand}>{"\u2588"}</Text> : null}
      </Box>
      <Box>
        <Text bold color={activeField === 2 ? theme.uiBrand : undefined}>Capital:    $</Text>
        <Text>{capital}</Text>
        {activeField === 2 ? <Text color={theme.uiBrand}>{"\u2588"}</Text> : null}
      </Box>
      <Text> </Text>
      <Text dimColor>Tab switch fields {"\u00b7"} Enter next</Text>
    </Box>
  );
}

interface OptimizationStepProps {
  cursor: number;
  setCursor: Dispatch<SetStateAction<number>>;
  onNext: () => void;
}

function OptimizationStep({ cursor, setCursor, onNext }: OptimizationStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((_input, key) => {
    if (key.upArrow) setCursor((current) => Math.max(0, current - 1));
    if (key.downArrow) setCursor((current) => Math.min(OPT_MODES.length - 1, current + 1));
    if (key.return) onNext();
  });

  return (
    <Box flexDirection="column">
      <Text bold>Optimization Mode:</Text>
      {OPT_MODES.map((mode, index) => {
        const isFocused = index === cursor;
        const desc = mode === "none" ? "No optimization" : mode === "grid" ? "Grid search over parameter space" : "Random parameter sampling";
        return (
          <Box key={mode} paddingLeft={2}>
            <Text color={isFocused ? theme.uiBrand : undefined}>
              {isFocused ? "\u25B8 " : "  "}{mode.toUpperCase()}
            </Text>
            <Text dimColor> {"\u2014"} {desc}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>{"\u2191\u2193"} select {"\u00b7"} Enter next</Text>
    </Box>
  );
}

interface ReviewStepProps {
  config: BacktestConfig;
  strategyLabel: string;
  onRun: () => void;
}

function ReviewStep({ config, strategyLabel, onRun }: ReviewStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((_input, key) => {
    if (key.return) onRun();
  });

  return (
    <Box flexDirection="column">
      <Text bold>Review Configuration:</Text>
      <Text> </Text>
      <Box paddingLeft={2} flexDirection="column">
        <Box><Text dimColor>Strategy:     </Text><Text bold>{strategyLabel}</Text></Box>
        <Box><Text dimColor>Symbol:       </Text><Text bold>{config.symbol}</Text></Box>
        <Box><Text dimColor>Timeframe:    </Text><Text bold>{config.timeframe}</Text></Box>
        <Box><Text dimColor>Period:       </Text><Text>{config.startDate} to {config.endDate}</Text></Box>
        <Box><Text dimColor>Capital:      </Text><Text>${config.initialCapital}</Text></Box>
        <Box><Text dimColor>Optimization: </Text><Text>{config.optimization.toUpperCase()}</Text></Box>
      </Box>
      <Text> </Text>
      <Text bold color={theme.riskSafe}>Press Enter to run backtest</Text>
    </Box>
  );
}

export function BacktestWizard({ strategies, onRun, onCancel }: Props) {
  const [strategyCursor, setStrategyCursor] = useState(0);
  const [symbol, setSymbol] = useState("");
  const [timeframeCursor, setTimeframeCursor] = useState(3);
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState("10000");
  const [optimizationCursor, setOptimizationCursor] = useState(0);
  const [activeField, setActiveField] = useState(0);

  const config: BacktestConfig = {
    strategyId: strategies[strategyCursor] ?? "",
    symbol: symbol || "BTCUSD",
    timeframe: TIMEFRAMES[timeframeCursor] ?? "1h",
    startDate,
    endDate,
    initialCapital: Number(capital) || 10000,
    optimization: OPT_MODES[optimizationCursor] ?? "none",
  };

  const steps: Record<string, PickerStep<BacktestConfig>> = {
    strategy: {
      title: "Step 1: Strategy",
      render: (ctx) => (
        <StrategyStep
          strategies={strategies}
          cursor={strategyCursor}
          setCursor={setStrategyCursor}
          onNext={() => ctx.go("symbol")}
        />
      ),
    },
    symbol: {
      title: "Step 2: Symbol and timeframe",
      render: (ctx) => (
        <SymbolStep
          symbol={symbol}
          setSymbol={setSymbol}
          timeframeCursor={timeframeCursor}
          setTimeframeCursor={setTimeframeCursor}
          activeField={activeField}
          setActiveField={setActiveField}
          onNext={() => ctx.go("dates")}
        />
      ),
    },
    dates: {
      title: "Step 3: Dates and capital",
      render: (ctx) => (
        <DatesStep
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          capital={capital}
          setCapital={setCapital}
          activeField={activeField}
          setActiveField={setActiveField}
          onNext={() => ctx.go("optimization")}
        />
      ),
    },
    optimization: {
      title: "Step 4: Optimization",
      render: (ctx) => (
        <OptimizationStep
          cursor={optimizationCursor}
          setCursor={setOptimizationCursor}
          onNext={() => ctx.go("review")}
        />
      ),
    },
    review: {
      title: "Step 5: Review",
      render: () => (
        <ReviewStep
          config={config}
          strategyLabel={strategies[strategyCursor] ?? ""}
          onRun={() => onRun(config)}
        />
      ),
    },
  };

  return (
    <MultiStepPicker<BacktestConfig>
      title="BACKTEST WIZARD"
      steps={steps}
      initialStep="strategy"
      onComplete={onRun}
      onCancel={onCancel}
      showProgress
    />
  );
}
