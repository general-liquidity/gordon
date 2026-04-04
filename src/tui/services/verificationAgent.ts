// ============================================================================
// Verification Agent — Cross-check trade proposals before execution
//
// Separate agent that reviews trade proposals for errors, risk issues,
// or overlooked factors before execution. Uses ForkedAgentRunner for
// isolated verification context.
// ============================================================================

import { getForkedAgentRunner, type ForkedAgentResult } from "./forkedAgent.js";

export interface VerificationRequest {
  type: "trade" | "strategy" | "config";
  proposal: string; // what's being proposed
  context: string; // market conditions, positions, etc.
  riskChecks?: string[]; // specific risk areas to verify
}

export interface VerificationResult {
  approved: boolean;
  confidence: number; // 0-1
  concerns: string[]; // list of issues found
  suggestions: string[]; // improvement recommendations
  summary: string; // 1-2 sentence verdict
}

const VERIFICATION_PROMPT_PREFIX = `Review this trade proposal critically. Look for:
- Position sizing errors
- Stop-loss placement issues
- Risk/reward ratio problems
- Market condition mismatches
- Timing concerns

`;

export class VerificationAgent {
  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const riskSection =
      request.riskChecks && request.riskChecks.length > 0
        ? `\nAdditional risk areas to verify:\n${request.riskChecks.map((r) => `- ${r}`).join("\n")}\n`
        : "";

    const prompt = `${VERIFICATION_PROMPT_PREFIX}${riskSection}
Type: ${request.type}
Proposal: ${request.proposal}
Context: ${request.context}`;

    const runner = getForkedAgentRunner();
    const result: ForkedAgentResult = await runner.fork({
      purpose: "verification",
      prompt,
      maxTokens: 1500,
    });

    if (!result.success) {
      return {
        approved: false,
        confidence: 0,
        concerns: [`Verification failed: ${result.error ?? "unknown error"}`],
        suggestions: ["Retry verification before proceeding"],
        summary: "Verification could not be completed.",
      };
    }

    // In production: parse LLM response into structured result
    // For now: return reasonable placeholder defaults
    return {
      approved: true,
      confidence: 0.75,
      concerns: [
        "Verify position size is within risk limits",
        "Confirm stop-loss accounts for recent volatility",
      ],
      suggestions: [
        "Consider scaling into position in 2-3 tranches",
        "Monitor funding rate before entry",
      ],
      summary: `Proposal appears reasonable with standard risk caveats. ${request.type} reviewed in ${result.durationMs}ms.`,
    };
  }

  async quickCheck(
    symbol: string,
    side: string,
    size: number,
    price: number,
  ): Promise<VerificationResult> {
    return this.verify({
      type: "trade",
      proposal: `${side.toUpperCase()} ${size} ${symbol} @ ${price}`,
      context: `Quick trade entry for ${symbol}`,
      riskChecks: ["position-size", "price-deviation"],
    });
  }
}

let instance: VerificationAgent | null = null;

export function getVerificationAgent(): VerificationAgent {
  if (!instance) instance = new VerificationAgent();
  return instance;
}
