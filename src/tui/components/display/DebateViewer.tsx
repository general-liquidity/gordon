import { Box, Text } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

export type DebateRole =
  | "bull"
  | "bear"
  | "manager"
  | "aggressive"
  | "conservative"
  | "neutral"
  | "portfolio_manager";

export interface DebateRound {
  roundNumber: number;
  role: DebateRole;
  argument: string;
  keyPoints: string[];
  confidence: number;
}

export interface DebateViewerData {
  symbol: string;
  investmentRounds: DebateRound[];
  managerSynthesis?: { conclusion: string; investmentPlan: string };
  riskRounds: DebateRound[];
  finalDecision?: {
    action: "BUY" | "SELL" | "HOLD" | "NO_ACTION";
    confidence: number;
    reasoning: string;
  };
}

const ROLE_COLORS: Record<DebateRole, string> = {
  bull: "green",
  bear: "red",
  manager: "cyan",
  aggressive: "magenta",
  conservative: "blue",
  neutral: "yellow",
  portfolio_manager: "cyanBright",
};

const ROLE_ICONS: Record<DebateRole, string> = {
  bull: "↑",
  bear: "↓",
  manager: "⚖",
  aggressive: "⚡",
  conservative: "🛡",
  neutral: "⚖",
  portfolio_manager: "◆",
};

export function DebateViewer({ data }: { data: DebateViewerData }) {
  const actionColor =
    data.finalDecision?.action === "BUY"
      ? "green"
      : data.finalDecision?.action === "SELL"
        ? "red"
        : "gray";

  return (
    <Pane title={`DEBATE — ${data.symbol}`}>
      <Box flexDirection="column">
        <Text dimColor bold>
          INVESTMENT DEBATE
        </Text>
        {data.investmentRounds.map((r, i) => (
          <Box key={i} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={ROLE_COLORS[r.role]} bold>
                {ROLE_ICONS[r.role]} {r.role.toUpperCase()} (round {r.roundNumber})
              </Text>
              <Text dimColor> confidence: {r.confidence}/10</Text>
            </Box>
            <Box paddingLeft={2}>
              <Text>{r.argument}</Text>
            </Box>
            {r.keyPoints.length > 0 && (
              <Box paddingLeft={2} flexDirection="column">
                {r.keyPoints.slice(0, 3).map((p, j) => (
                  <Text key={j} dimColor>
                    {" "}
                    • {p}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        ))}

        {data.managerSynthesis && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan" bold>
              ⚖ RESEARCH MANAGER
            </Text>
            <Box paddingLeft={2}>
              <Text>{data.managerSynthesis.conclusion}</Text>
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor>Plan: {data.managerSynthesis.investmentPlan}</Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor bold>
            RISK DEBATE
          </Text>
        </Box>
        {data.riskRounds.map((r, i) => (
          <Box key={i} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={ROLE_COLORS[r.role]} bold>
                {ROLE_ICONS[r.role]} {r.role.toUpperCase()}
              </Text>
              <Text dimColor> confidence: {r.confidence}/10</Text>
            </Box>
            <Box paddingLeft={2}>
              <Text>{r.argument}</Text>
            </Box>
          </Box>
        ))}

        {data.finalDecision && (
          <Box
            flexDirection="column"
            marginTop={1}
            borderStyle="single"
            borderColor={actionColor}
            paddingX={1}
          >
            <Box>
              <Text color="cyanBright" bold>
                ◆ FINAL DECISION:{" "}
              </Text>
              <Text color={actionColor} bold>
                {data.finalDecision.action}
              </Text>
              <Text dimColor> ({data.finalDecision.confidence}/10)</Text>
            </Box>
            <Text>{data.finalDecision.reasoning}</Text>
          </Box>
        )}
      </Box>
    </Pane>
  );
}
