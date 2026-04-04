// ============================================================================
// Output Styles — Custom response formatting modes
// ============================================================================

export interface OutputStyle { id: string; name: string; description: string; promptAddendum: string; }

const STYLES: OutputStyle[] = [
  { id: "default", name: "Default", description: "Standard response format", promptAddendum: "" },
  { id: "brief", name: "Brief", description: "Just fills, P&L, and key numbers. No prose.", promptAddendum: "Be extremely concise. Only output numbers, prices, and key metrics. No explanations." },
  { id: "detailed", name: "Detailed", description: "Full reasoning, indicator values, confidence scores", promptAddendum: "Provide detailed analysis with all indicator values, reasoning chain, and confidence scores." },
  { id: "risk-focused", name: "Risk-Focused", description: "Emphasizes risk metrics in every response", promptAddendum: "Always lead with risk assessment. Show position sizing, stop distances, max loss, drawdown, and correlation exposure." },
];

let activeId = "default";

export class OutputStyleManager {
  listStyles(): OutputStyle[] { return STYLES; }
  getActive(): OutputStyle { return STYLES.find((s) => s.id === activeId) ?? STYLES[0]!; }
  setActive(styleId: string): void { if (STYLES.some((s) => s.id === styleId)) activeId = styleId; }
}
