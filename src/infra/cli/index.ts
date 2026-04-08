/**
 * CLI Registry — Known trading-relevant CLI tools
 */

export {
  getAllCLIs,
  getCLI,
  getUncoveredCLIs,
  isCLIInstalled,
  formatCLIRegistryForPrompt,
  CLI_REGISTRY,
} from "./registry.ts";
export type { CLIEntry, CLICommand } from "./registry.ts";
