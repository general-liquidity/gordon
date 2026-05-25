#!/usr/bin/env bun
/**
 * check_tool_tiers — lint that flags untiered tool spreads in agent definitions.
 *
 * Run:
 *   bun run scripts/dev/check_tool_tiers.ts
 *
 * Wire as pre-commit hook (optional):
 *   echo 'bun run scripts/dev/check_tool_tiers.ts' >> .git/hooks/pre-commit
 *
 * What it catches: new `...instrumentedXTools` spreads in
 *   - src/infra/agents/definitions/gordon.ts
 *   - src/infra/agents/definitions/executor.ts
 *   - src/infra/agents/definitions/researcher.ts
 * that are NOT either:
 *   (a) in the curated "known core" allow-list below
 *   (b) wrapped with `isHotTierOnly()` to gate to cold tier
 *
 * Exit codes:
 *   0  — clean (no unjustified hot-tier additions)
 *   1  — at least one tool group violates the tier convention
 *
 * The allow-list is the snapshot of tool families considered core to
 * hot tier as of 2026-05-26. New additions to it require a code review
 * with explicit justification in the diff message.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const AGENT_FILES = [
  "src/infra/agents/definitions/gordon.ts",
  "src/infra/agents/definitions/executor.ts",
  "src/infra/agents/definitions/researcher.ts",
];

/**
 * Curated allow-list of tool families that ARE legitimately hot-tier.
 * Adding a new entry requires a deliberate decision — don't auto-add
 * just because lint fails. The intent is to force the convention.
 *
 * Sorted alphabetically; keep that way for diff readability.
 */
const KNOWN_HOT_TIER_TOOL_FAMILIES = new Set<string>([
  "instrumentedAccountTools",
  "instrumentedACETools",
  "instrumentedAdherenceTools",
  "instrumentedAdvancedTools",
  "instrumentedAgentFeedbackTools",
  "instrumentedAgentKitDefiTools",
  "instrumentedAgentKitOnchainTools",
  "instrumentedAskUserTools",
  "instrumentedAuditTools",
  "instrumentedAutonomousTools",
  "instrumentedBacktestTools",
  "instrumentedBacktestVerdictTools",
  "instrumentedBaseIndexerTools",
  "instrumentedBaseOnchainTools",
  "instrumentedBaseSignalTools",
  "instrumentedCalibrationTools",
  "instrumentedChartTools",
  "instrumentedCheckRiskTool",
  "instrumentedChainlinkCCIPTools",
  "instrumentedCompositionTools",
  "instrumentedDexSearchTools",
  "instrumentedDiagnosticTools",
  "instrumentedDiscoveryTools",
  "instrumentedEarnTools",
  "instrumentedEvalTools",
  "instrumentedFinnhubMarketsTools",
  "instrumentedFinnhubTools",
  "instrumentedHistoryTools",
  "instrumentedIndicatorTools",
  "instrumentedInstitutionalAiTools",
  "instrumentedLiquidationIntelligenceTools",
  "instrumentedMarketAnalysisTools",
  "instrumentedMarketDataTools",
  "instrumentedMarketTools",
  "instrumentedMemoryTools",
  "instrumentedMetricsTools",
  "instrumentedMicrostructureTools",
  "instrumentedMultiModalChartTools",
  "instrumentedNewsTools",
  "instrumentedOrderbookTools",
  "instrumentedPairAnalysisTools",
  "instrumentedParallelAnalysisTools",
  "instrumentedPeerTools",
  "instrumentedPlaybookTools",
  "instrumentedPolkadotKitAssetTools",
  "instrumentedPolkadotKitDefiTools",
  "instrumentedPolkadotKitStakingTools",
  "instrumentedPositionTools",
  "instrumentedPositionTrackingTools",
  "instrumentedProactiveModeTools",
  "instrumentedProducerHealthTools",
  "instrumentedProtocolTools",
  "instrumentedQuoteVerifyTools",
  "instrumentedRegimeTools",
  "instrumentedRiskManagementTools",
  "instrumentedRuntimeTools",
  "instrumentedSchedulerTools",
  "instrumentedSharedContextTools",
  "instrumentedSkillLoaderTools",
  "instrumentedSmcPatternTools",
  "instrumentedSolanaKitDefiBridgeTools",
  "instrumentedSolanaKitDefiLendingTools",
  "instrumentedSolanaKitDefiPerpsTools",
  "instrumentedSolanaKitDefiPoolsTools",
  "instrumentedSolanaKitTradingTools",
  "instrumentedStockNewsTools",
  "instrumentedStrategyGenerationTools",
  "instrumentedStrategyRecipeTools",
  "instrumentedStrategyTools",
  "instrumentedSynthDataTools",
  "instrumentedSystematicTools",
  "instrumentedSystemTools",
  "instrumentedTradingTools",
  "instrumentedUniswapDataTools",
  "instrumentedWalletTools",
  "instrumentedXSocialTools",
  // -------------------------------------------------------------------
  // FOLLOW-UP: the following 7 families are registered hot-tier on the
  // Researcher but isHotTierOnly()-gated to cold on Gordon. The lint
  // currently accepts them as a snapshot of the pre-Phase-1 state, but
  // the right cleanup is to mirror Gordon's gating pattern in
  // researcher.ts (deep-research workflows are the right activation
  // surface for these). Tracked as a Phase-2-or-later cleanup; do NOT
  // expand this list further.
  // -------------------------------------------------------------------
  "instrumentedCdpWebhookTools",
  "instrumentedCdpSqlTools",
  "instrumentedCdpPolicyTools",
  "instrumentedCdpOnrampTools",
  "instrumentedCdpEvmMultichainTools",
  "instrumentedCdpWebhookReceiverTools",
  "instrumentedFinnhubFundamentalsTools",
]);

const SPREAD_REGEX = /\.\.\.(instrumented[A-Z]\w+)/g;
const COLD_TIER_PATTERN = /isHotTierOnly\s*\(\s*\)\s*\?\s*\{\s*\}\s*:\s*([A-Za-z]\w+)/g;

interface Violation {
  file: string;
  line: number;
  toolFamily: string;
  reason: string;
}

function checkFile(relativePath: string): Violation[] {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) {
    console.error(`Missing file: ${relativePath}`);
    return [];
  }
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  // Collect family names that ARE cold-tier wrapped (those appearing in
  // `isHotTierOnly() ? {} : XTools` are not violations).
  const coldTierWrapped = new Set<string>();
  for (const match of content.matchAll(COLD_TIER_PATTERN)) {
    coldTierWrapped.add(match[1]!);
  }

  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip lines inside obvious comments
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;
    for (const match of line.matchAll(SPREAD_REGEX)) {
      const family = match[1]!;
      // Map "instrumentedXTools" → "XTools" for cold-tier check
      const bareName = family.replace(/^instrumented/, "");
      if (coldTierWrapped.has(bareName) || coldTierWrapped.has(family)) continue;
      if (!KNOWN_HOT_TIER_TOOL_FAMILIES.has(family)) {
        violations.push({
          file: relativePath,
          line: i + 1,
          toolFamily: family,
          reason: "untiered hot-tier addition (not in allow-list, not wrapped with isHotTierOnly())",
        });
      }
    }
  }
  return violations;
}

function main(): number {
  let totalViolations = 0;
  for (const f of AGENT_FILES) {
    const v = checkFile(f);
    if (v.length === 0) {
      console.log(`✓ ${f}`);
      continue;
    }
    for (const violation of v) {
      console.error(
        `✗ ${violation.file}:${violation.line}  ${violation.toolFamily}  — ${violation.reason}`,
      );
      totalViolations++;
    }
  }
  if (totalViolations === 0) {
    console.log("\nAll tool registrations comply with the tier convention.");
    return 0;
  }
  console.error(`\n${totalViolations} tier-convention violation(s).`);
  console.error("Options to fix each violation:");
  console.error("  1. Wrap with `...(isHotTierOnly() ? {} : instrumentedXTools)` to demote to cold tier");
  console.error("  2. Add the family to KNOWN_HOT_TIER_TOOL_FAMILIES with a justifying comment in the diff");
  console.error("  3. Move the tools to a SKILL.md (loaded on demand) and remove the spread");
  console.error("See CLAUDE.md § 'Tool tier convention'.");
  return 1;
}

process.exit(main());
