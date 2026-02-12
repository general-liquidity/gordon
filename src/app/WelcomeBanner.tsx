import React, { useMemo, useState, useCallback } from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";
import { GlitchReveal } from "./components/effects/GlitchReveal.tsx";

// Import version from package.json
import packageJson from "../../package.json";

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
const ASCII_BANNER = `
 ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
 ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
`.trim();

/** Resolve the active model name from env for display */
function getModelDisplay(): string {
  // Explicit model override
  const model = process.env.GORDON_MODEL || process.env.LLM_DEFAULT_MODEL;
  if (model) {
    // Strip provider prefix for cleaner display (e.g. "openai/gpt-5-nano" → "gpt-5-nano")
    return model.includes("/") ? model.split("/").slice(1).join("/") : model;
  }

  // Infer from provider
  const provider = process.env.GORDON_PROVIDER || process.env.LLM_DEFAULT_PROVIDER;
  if (provider === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";

  // Auto-detect from available keys
  if (process.env.DEDALUS_API_KEY) return "dedalus";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";

  return "no model";
}

export const WelcomeBanner: React.FC = () => {
  const [revealed, setRevealed] = useState(false);

  // Select random quote on mount
  const randomQuote = useMemo(() => {
    const index = Math.floor(Math.random() * GEKKO_QUOTES.length);
    return GEKKO_QUOTES[index];
  }, []);

  const handleRevealComplete = useCallback(() => {
    setRevealed(true);
  }, []);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ASCII Art Banner — glitch decrypt on first load, gradient after */}
      <Box flexDirection="column">
        {revealed ? (
          ASCII_BANNER.split("\n").map((line, i) => (
            <Text key={i} color={COLORS.GREEN} bold>
              {line}
            </Text>
          ))
        ) : (
          <GlitchReveal
            duration={1200}
            frameRate={50}
            charset="block"
            gradient={["#22c55e", "#22c55e"]}
            scrambleColor="#15803d"
            bold
            onComplete={handleRevealComplete}
          >
            {ASCII_BANNER}
          </GlitchReveal>
        )}
      </Box>

      {/* Tagline + version + model */}
      <Box marginTop={1} gap={1}>
        <Text color={COLORS.WHITE} bold>
          The Frontier Trading Agent
        </Text>
        <Text color={COLORS.DIM}>v{packageJson.version}</Text>
        <Text color={COLORS.DIM}>·</Text>
        <Text color={COLORS.ACCENT_DIM}>{getModelDisplay()}</Text>
      </Box>

      {/* Gekko Quote */}
      <Box marginTop={1} paddingX={1}>
        <Text color={COLORS.TAN_DIM} italic>
          "{randomQuote}"
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.DIM}>Press any key to start...</Text>
      </Box>
    </Box>
  );
};

export default WelcomeBanner;
