import React, { useMemo, useState, useCallback } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./theme.ts";
import { GlitchReveal } from "./components/effects/GlitchReveal.tsx";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";

// Gordon Gekko quotes — Wall Street (1987) & Wall Street: Money Never Sleeps (2010)
const GEKKO_QUOTES = [
  "The most valuable commodity I know of is information.",
  "Greed, for lack of a better word, is good.",
  "Money never sleeps.",
  "I don't throw darts at a board. I bet on sure things.",
  "What's worth doing is worth doing for money.",
  "If you need a friend, get a dog.",
  "The point is, ladies and gentleman, that greed captures the essence of the evolutionary spirit.",
  "It's not a question of enough, pal. It's a zero-sum game.",
  "I look at a hundred deals a day. I pick one.",
  "Ever wonder why fund managers can't beat the S&P 500? Because they're sheep.",
  "You're walking around blind without a cane, pal. A fool and his money are lucky enough to get together in the first place.",
  "It's all about bucks, kid. The rest is conversation.",
  "Read Sun Tzu, The Art of War. Every battle is won before it is ever fought.",
  "When I get a hold of the son of a bitch who leaked this, I'm gonna tear his eyeballs out and I'm gonna suck his skull.",
  "This is the kid, calls me 59 days in a row, wants to be a player. Ought to be a picture of you in the dictionary under 'persistence', kid.",
  "You had what it took to get into my office. The real question is whether you got what it takes to stay.",
  "Mixed emotions, buddy. Like Larry Wildman going off a cliff in my new Maserati.",
  "Lunch is for wimps.",
  "Wake up, will ya, pal? If you're not inside, you're outside.",
  "Someone reminded me I once said 'Greed is good.' Now it seems it's legal.",
  "It's not about the money. It's about the game.",
  "Idealism kills every deal.",
  "Stop going for the easy buck and start producing something with your life.",
  "Bulls make money. Bears make money. Pigs, they get slaughtered.",
  "You want a friend? Get a dog. It's trench warfare out there.",
] as const;

// ASCII art banner (ANSI Shadow style - clean and bold)
const RAW_ASCII_BANNER = `
 ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
 ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
`;

function normalizeBanner(raw: string): string {
  return raw.replace(/^\n/, "").trimEnd();
}

const ASCII_BANNER = normalizeBanner(RAW_ASCII_BANNER);
const WINDOWS_ASCII_BANNER = normalizeBanner(RAW_ASCII_BANNER);

interface WelcomeBannerProps {
  mode?: "full" | "quiet";
  context?: "welcome" | "chat";
}

export const WelcomeBanner: React.FC<WelcomeBannerProps> = ({
  mode = "full",
  context = "welcome",
}) => {
  const quiet = mode === "quiet";
  const showStartupHint = context === "welcome";
  const [revealed, setRevealed] = useState(false);
  const { stdout } = useStdout();
  const isWindowsTerminal = process.platform === "win32" || Boolean(process.env.WT_SESSION);
  const bannerText = isWindowsTerminal ? WINDOWS_ASCII_BANNER : ASCII_BANNER;
  const separatorWidth = Math.max(28, Math.min((stdout?.columns ?? 80) - 4, 120));
  const separatorLine = "─".repeat(separatorWidth);

  // Select random quote on mount
  const randomQuote = useMemo(() => {
    const index = Math.floor(Math.random() * GEKKO_QUOTES.length);
    return GEKKO_QUOTES[index];
  }, []);

  const handleRevealComplete = useCallback(() => {
    setRevealed(true);
  }, []);

  return (
    <Box flexDirection="column" paddingX={quiet ? 2 : 1} paddingY={1}>
      <DeskPanel
        eyebrow="General Liquidity"
        title={quiet ? "Gordon Desk" : "Gordon Desk"}
        subtitle={context === "welcome"
          ? "The Frontier Trading Agent"
          : quiet
            ? "Plan-first trading workstation"
            : "Plan. Size. Execute."}
        tone="brand"
      >
        {!quiet && (
          <Box flexDirection="column">
            {revealed ? (
              <Text color={COLORS.MONEY} bold>
                {bannerText}
              </Text>
            ) : (
              <GlitchReveal
                duration={1200}
                frameRate={50}
                charset="block"
                gradient={[COLORS.MONEY, COLORS.MONEY]}
                scrambleColor={COLORS.MONEY_DIM}
                bold
                onComplete={handleRevealComplete}
              >
                {bannerText}
              </GlitchReveal>
            )}
          </Box>
        )}

        <Box marginTop={quiet ? 0 : 1} flexDirection="column">
          <Text color={COLORS.DIM}>
            {quiet
              ? "Private desk state loaded."
              : "Markets are noisy. Gordon turns the tape into tickets, plans, and controlled action."}
          </Text>
        </Box>

        {!quiet && (
          <Box marginTop={1}>
            <Text color={COLORS.BRASS_DIM} italic>
              "{randomQuote}"
            </Text>
          </Box>
        )}

        {context === "chat" && (
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>{separatorLine}</Text>
          </Box>
        )}

        {showStartupHint && (
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Press Enter to open the desk.
            </Text>
          </Box>
        )}
      </DeskPanel>
    </Box>
  );
};

export default WelcomeBanner;
