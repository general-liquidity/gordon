import React, { createContext, useContext, useCallback, useRef, useState, useMemo, type ReactNode } from "react";

// ============================================================================
// StatsProvider — Session cost, trading P&L, and usage statistics
//
// Tracks token usage (input/output with cost estimate), trading metrics
// (P&L, commissions, trade count), turn count, and session duration.
// ============================================================================

export interface SessionStats {
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  tokenCostUsd: number;
  tradingPnL: number;
  commissions: number;
  tradeCount: number;
  turnCount: number;
  sessionStartTime: number;
}

interface StatsContextValue {
  stats: SessionStats;
  observeTokens: (input: number, output: number) => void;
  observeTrade: (pnl: number, commission: number) => void;
  incrementTurn: () => void;
}

/** Default per-token pricing (configurable) */
const DEFAULT_INPUT_COST_PER_TOKEN = 0.000003;   // $3 per 1M input tokens
const DEFAULT_OUTPUT_COST_PER_TOKEN = 0.000015;   // $15 per 1M output tokens

const StatsContext = createContext<StatsContextValue | null>(null);

interface Props {
  children: ReactNode;
  /** Override input token cost ($/token) */
  inputCostPerToken?: number;
  /** Override output token cost ($/token) */
  outputCostPerToken?: number;
}

export function StatsProvider({
  children,
  inputCostPerToken = DEFAULT_INPUT_COST_PER_TOKEN,
  outputCostPerToken = DEFAULT_OUTPUT_COST_PER_TOKEN,
}: Props) {
  const sessionStartTime = useRef(Date.now()).current;

  const [stats, setStats] = useState<SessionStats>({
    tokenInput: 0,
    tokenOutput: 0,
    tokenTotal: 0,
    tokenCostUsd: 0,
    tradingPnL: 0,
    commissions: 0,
    tradeCount: 0,
    turnCount: 0,
    sessionStartTime,
  });

  const observeTokens = useCallback(
    (input: number, output: number) => {
      setStats((prev) => {
        const newInput = prev.tokenInput + input;
        const newOutput = prev.tokenOutput + output;
        const newTotal = newInput + newOutput;
        const newCost =
          newInput * inputCostPerToken + newOutput * outputCostPerToken;
        return {
          ...prev,
          tokenInput: newInput,
          tokenOutput: newOutput,
          tokenTotal: newTotal,
          tokenCostUsd: newCost,
        };
      });
    },
    [inputCostPerToken, outputCostPerToken],
  );

  const observeTrade = useCallback((pnl: number, commission: number) => {
    setStats((prev) => ({
      ...prev,
      tradingPnL: prev.tradingPnL + pnl,
      commissions: prev.commissions + commission,
      tradeCount: prev.tradeCount + 1,
    }));
  }, []);

  const incrementTurn = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      turnCount: prev.turnCount + 1,
    }));
  }, []);

  const value = useMemo<StatsContextValue>(
    () => ({ stats, observeTokens, observeTrade, incrementTurn }),
    [stats, observeTokens, observeTrade, incrementTurn],
  );

  return (
    <StatsContext.Provider value={value}>
      {children}
    </StatsContext.Provider>
  );
}

// ============================================================================
// useStats — Access session stats from any descendant component
// ============================================================================

export function useStats(): StatsContextValue {
  const ctx = useContext(StatsContext);
  if (!ctx) {
    // Return a no-op fallback so components work outside the provider during tests
    return {
      stats: {
        tokenInput: 0,
        tokenOutput: 0,
        tokenTotal: 0,
        tokenCostUsd: 0,
        tradingPnL: 0,
        commissions: 0,
        tradeCount: 0,
        turnCount: 0,
        sessionStartTime: Date.now(),
      },
      observeTokens: () => {},
      observeTrade: () => {},
      incrementTurn: () => {},
    };
  }
  return ctx;
}
