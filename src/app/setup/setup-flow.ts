export type SetupWizardMode = "quickstart" | "advanced" | "configure";

export type SetupWizardSection = "exchange" | "broker" | "chains" | "mcp" | "llm" | "preferences";

export interface OnboardingSelection {
  mode: "quickstart" | "advanced" | "demo";
}

export const SETUP_WIZARD_SECTIONS: SetupWizardSection[] = [
  "exchange",
  "broker",
  "chains",
  "mcp",
  "llm",
  "preferences",
];

export function parseSetupWizardMode(
  value: string | undefined,
  fallback: SetupWizardMode = "advanced",
): SetupWizardMode {
  if (value === "quickstart" || value === "advanced" || value === "configure") {
    return value;
  }
  return fallback;
}

export function parseSetupWizardSection(value: string | undefined): SetupWizardSection | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return SETUP_WIZARD_SECTIONS.find((section) => section === normalized) ?? null;
}

export function getSetupSectionLabel(section: SetupWizardSection): string {
  switch (section) {
    case "exchange":
      return "Exchange";
    case "broker":
      return "Broker";
    case "chains":
      return "Chains";
    case "mcp":
      return "MCP plugins";
    case "llm":
      return "LLM";
    case "preferences":
      return "Preferences";
  }
}
