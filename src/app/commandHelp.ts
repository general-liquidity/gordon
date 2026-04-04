/**
 * Command Help Formatting
 * Help display, pagination, and analysis command formatting
 */

import type { WorkflowGroup } from "./commandUx.ts";
import { WORKFLOW_CONFIG, resolveWorkflowTopic } from "./commandUx.ts";
import {
  SLASH_COMMANDS,
  type CommandLevel,
  type HelpMode,
  type HelpCategory,
  getCommandsByLevel,
  parseHelpArg,
} from "./slashCommands.ts";

/**
 * Workflow display configuration for help formatting
 */
const CATEGORY_CONFIG = WORKFLOW_CONFIG;

/**
 * Format command list for display with level-based filtering
 * @param mode - Help display mode (essential, advanced, all/expert) - defaults to "essential"
 * @param category - Optional category filter
 */
export function formatCommandHelp(
  mode: HelpMode = "essential",
  category?: HelpCategory
): string {
  let maxLevel: CommandLevel = 1;
  if (mode === "advanced") maxLevel = 2;
  if (mode === "all" || mode === "expert") maxLevel = 3;

  let commands = getCommandsByLevel(maxLevel);
  if (category) {
    commands = commands.filter((cmd) => cmd.workflow === category);
  }

  const lines: string[] = [];

  if (mode === "essential") {
    lines.push("**Core Workflows**\n");
    lines.push("_Use `/help advanced` for more depth, or `/help all` to include operator commands._\n");
  } else if (mode === "advanced") {
    lines.push("**Core + Advanced Workflows**\n");
    lines.push("_Use `/help all` to include operator-grade commands and maintenance surfaces._\n");
  } else {
    lines.push("**All Workflows**\n");
  }

  if (category) {
    lines.push(`_Workflow: ${WORKFLOW_CONFIG[category].label}_\n`);
  }

  const categories = Object.keys(WORKFLOW_CONFIG) as HelpCategory[];

  for (const cat of categories) {
    const config = CATEGORY_CONFIG[cat];
    if (!config) continue;
    const catCommands = commands.filter((c) => c.workflow === cat);
    if (catCommands.length === 0) continue;

    lines.push(`\n**${config.icon} ${config.label}**`);
    lines.push(`_${config.description}_`);

    for (const cmd of catCommands) {
      lines.push(`  /${cmd.name} - ${cmd.description}`);
    }
  }

  lines.push("\n_Type a command or just chat naturally with Gordon._");
  lines.push("\n**Help Options:**");
  lines.push("  `/help` - Show the core workflow surface");
  lines.push("  `/help advanced` - Include advanced commands");
  lines.push("  `/help all` - Include operator commands and maintenance surfaces");
  lines.push("  `/help discover` - Find market discovery tools");
  lines.push("  `/help analyze` - Find analysis tools");
  lines.push("  `/help trade` - Find planning and execution commands");
  lines.push("  `/help run` - Find strategy and runtime commands");
  lines.push("  `/help accounts` - Find portfolio, broker, and wallet commands");
  lines.push("  `/help system` - Find setup, doctor, model, and system commands");
  lines.push("  `/help page 1` - Browse all commands in pages");

  return lines.join("\n");
}

/**
 * Format analysis commands with performance comparison
 * Useful for helping users choose the right analysis depth
 */
export function formatAnalysisCommandsHelp(): string {
  const analysisCommands = ["analyze", "ensemble", "deep", "fast-deep", "parallel", "mtf", "compare-coins", "scan"];
  const cmds = SLASH_COMMANDS.filter((c) => analysisCommands.includes(c.name));

  const lines: string[] = [
    "**Analysis Commands - Choose by Time & Depth:**\n",
    "| Command | Time | Use Case |",
    "|---------|------|----------|",
  ];

  for (const cmd of cmds) {
    const time = cmd.executionTime || "varies";
    const useCase = cmd.whenToUse || cmd.description;
    lines.push(`| /${cmd.name} | ${time} | ${useCase} |`);
  }

  lines.push("\n**Quick Guide:**");
  lines.push("- Quick check: `/analyze` (~3-5s)");
  lines.push("- Before trading: `/ensemble` (~8-12s)");
  lines.push("- Large position: `/deep` or `/fast-deep` (~15-20s or ~8-12s)");
  lines.push("- Multiple coins: `/compare-coins` (~5-10s per 3)");

  return lines.join("\n");
}

// ============================================================================
// ACCESSIBILITY: Paginated Help Functions
// Shows 15 commands per page instead of overwhelming users with 50+ at once
// ============================================================================

const PAGINATED_HELP_CATEGORIES: Record<WorkflowGroup, string> = {
  discover: WORKFLOW_CONFIG.discover.label,
  analyze: WORKFLOW_CONFIG.analyze.label,
  trade: WORKFLOW_CONFIG.trade.label,
  run: WORKFLOW_CONFIG.run.label,
  accounts: WORKFLOW_CONFIG.accounts.label,
  monitor: WORKFLOW_CONFIG.monitor.label,
  build: WORKFLOW_CONFIG.build.label,
  system: WORKFLOW_CONFIG.system.label,
};

/**
 * Format paginated command help for accessibility
 * @param args - "page N" for pagination, category name, or empty for summary
 */
export function formatPaginatedCommandHelp(args?: string): string {
  const PAGE_SIZE = 15;
  const parsedArgs = args?.toLowerCase().trim() || "";

  if (!parsedArgs) {
    return formatHelpSummaryView();
  }

  if (parsedArgs === "advanced" || parsedArgs === "all" || parsedArgs === "expert") {
    const { mode } = parseHelpArg(parsedArgs);
    return formatCommandHelp(mode);
  }

  const pageMatch = parsedArgs.match(/^page\s*(\d+)$/);
  if (pageMatch && pageMatch[1]) {
    return formatHelpPageView(parseInt(pageMatch[1], 10), PAGE_SIZE);
  }

  const workflow = resolveWorkflowTopic(parsedArgs);
  if (workflow) {
    return formatHelpCategoryView(workflow);
  }

  return formatHelpSummaryView();
}

function formatHelpSummaryView(): string {
  const total = SLASH_COMMANDS.length;
  const lines: string[] = [
    "**Gordon Help** - Workflow Guide\n",
    `Gordon has **${total} commands** organized around these workflows:\n`,
  ];

  for (const [cat, label] of Object.entries(PAGINATED_HELP_CATEGORIES)) {
    const workflow = cat as WorkflowGroup;
    const cmds = SLASH_COMMANDS.filter((c) => c.workflow === workflow);
    lines.push(`  ${WORKFLOW_CONFIG[workflow].icon} **${label}** (${cmds.length}) - \`/help ${workflow}\``);
  }

  lines.push("\n**Recommended starting points:**");
  const essentialCmds = SLASH_COMMANDS
    .filter((c) => c.level === 1)
    .slice(0, 10);
  for (const cmd of essentialCmds) {
    lines.push(`  /${cmd.name} - ${cmd.description}`);
  }

  lines.push("\n---");
  lines.push("**Browse:** `/help <workflow>` | `/help advanced` | `/help all` | `/help page 1`");
  return lines.join("\n");
}

function formatHelpPageView(page: number, pageSize: number): string {
  const total = SLASH_COMMANDS.length;
  const totalPages = Math.ceil(total / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageCommands = SLASH_COMMANDS.slice(start, end);

  const lines: string[] = [
    `**All Commands** - Page ${currentPage} of ${totalPages} (${start + 1}-${end} of ${total})\n`,
  ];

  let lastCat = "";
  for (const cmd of pageCommands) {
    if (cmd.workflow !== lastCat) {
      if (lastCat !== "") lines.push("");
      const catLabel = PAGINATED_HELP_CATEGORIES[cmd.workflow] || cmd.workflow;
      lines.push(`**${catLabel}**`);
      lastCat = cmd.workflow;
    }
    lines.push(`  /${cmd.name} - ${cmd.description}`);
  }

  lines.push("\n---");
  const nav: string[] = [];
  if (currentPage > 1) nav.push(`\`/help page ${currentPage - 1}\``);
  if (currentPage < totalPages) nav.push(`\`/help page ${currentPage + 1}\``);
  nav.push("`/help`");
  lines.push("Navigate: " + nav.join(" | "));
  return lines.join("\n");
}

function formatHelpCategoryView(category: WorkflowGroup): string {
  const cmds = SLASH_COMMANDS.filter((c) => c.workflow === category);
  const label = PAGINATED_HELP_CATEGORIES[category] || category;

  const lines: string[] = [`**${label} Commands** (${cmds.length})\n`];
  for (const cmd of cmds) {
    lines.push(`  /${cmd.name} - ${cmd.description}`);
  }

  lines.push("\n---");
  const otherCats = Object.entries(PAGINATED_HELP_CATEGORIES)
    .filter(([cat]) => cat !== category)
    .map(([cat]) => `\`/help ${cat}\``)
    .join(" | ");
  lines.push("Other: " + otherCats + " | `/help`");
  return lines.join("\n");
}
