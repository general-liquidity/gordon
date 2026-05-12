// ============================================================================
// Chain-of-Thought — 5-step reasoning prompts for deep analysis
//
// Forces the analyst agent to reason in 5 explicit steps. Gives +10-15%
// accuracy vs single-shot prompting per Jadhav & Mirza (2025).
// ============================================================================

export const COT_PROMPT_TEMPLATE = `Analyze this news step by step:

STEP 1 — EXTRACT FACTS
List every concrete number, metric, and stated fact from the news.
No interpretation yet — just the data.

STEP 2 — EXPECTATIONS
Compare the extracted facts to market consensus/analyst expectations.
Was this a beat, miss, or in-line? By how much?

STEP 3 — SECOND-ORDER EFFECTS
What does this mean for next quarter, next year, the sector, or competitors?
Think 2-3 moves ahead.

STEP 4 — HEADLINE VS DATA
Is the headline tone different from what the actual numbers suggest?
Sometimes headlines are negative but data is positive, or vice versa.

STEP 5 — ALREADY PRICED IN
Given recent price action (check if stock ran up or down into this news),
how much of this is already reflected in the price?

After all 5 steps, provide your final assessment as JSON:
{
  "signal": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": 1-10,
  "reasoning": "2-3 sentences synthesizing your steps",
  "key_factors": ["factor1", "factor2", "factor3"]
}`;

export function buildCoTPrompt(news: string, ticker: string, recentPriceAction?: string): string {
  const context = recentPriceAction ? `\nRecent price action: ${recentPriceAction}\n` : "";
  return `${COT_PROMPT_TEMPLATE}\n\nTicker: ${ticker}${context}\nNews: ${news}`;
}

export interface CoTStep {
  step: number;
  title: string;
  content: string;
}

export function parseCoTResponse(response: string): { steps: CoTStep[]; signal: any } {
  const stepPattern = /STEP (\d+)[\s\-—]*([A-Z][A-Z\s]+)\n([\s\S]*?)(?=STEP \d+|After all|$)/g;
  const steps: CoTStep[] = [];
  let match;
  while ((match = stepPattern.exec(response)) !== null) {
    steps.push({ step: parseInt(match[1]!), title: match[2]!.trim(), content: match[3]!.trim() });
  }
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  const signal = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  return { steps, signal };
}

let cotEnabled = false;
export function isCoTEnabled(): boolean { return cotEnabled; }
export function setCoTEnabled(enabled: boolean): void { cotEnabled = enabled; }
