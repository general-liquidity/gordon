// ============================================================================
// Advisor Model — Secondary AI reviews trade proposals
// ============================================================================

let enabled = false;

export class AdvisorService {
  isEnabled(): boolean { return enabled; }
  setEnabled(value: boolean): void { enabled = value; }

  async review(proposal: string, context: string): Promise<string> {
    // Placeholder — would call secondary LLM in production
    return `Advisor review: Consider risk/reward ratio and position sizing for this proposal. Verify stop loss placement against recent support levels.`;
  }
}

let instance: AdvisorService | null = null;
export function getAdvisorService(): AdvisorService {
  if (!instance) instance = new AdvisorService();
  return instance;
}
