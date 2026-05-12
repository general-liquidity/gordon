/**
 * Gordon Agent Definition
 * Main orchestrator agent that coordinates all specialist sub-agents.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../context/promptSections.ts";
import { createModuleLogger } from "../../logger/logger.ts";
import { getScopedMCPTools } from "../../ai/mcp/client.ts";
import { getRoutingToolsForAgent } from "../../runtime/routing/manager.ts";
import {
  formatCapabilityTruthSummary,
  GORDON_PRODUCT_TRUTH,
} from "../capabilityTruth.ts";
import {
  instrumentedAskUserTools,
  instrumentedSystemTools,
  instrumentedSchedulerTools,
  instrumentedAutonomousTools,
  instrumentedIndicatorTools,
  instrumentedMarketDataTools,
  instrumentedMarketTools,
  instrumentedDiscoveryTools,
  instrumentedExecutionCostTools,
  instrumentedStrategyTools,
  instrumentedParallelAnalysisTools,
  instrumentedChartTools,
  instrumentedMarketAnalysisTools,
  instrumentedCompositionTools,
  instrumentedMultiModalChartTools,
  instrumentedLiquidationIntelligenceTools,
  instrumentedPairAnalysisTools,
  instrumentedOrderbookTools,
  instrumentedAccountTools,
  instrumentedPositionTools,
  instrumentedHistoryTools,
  instrumentedWalletTools,
  instrumentedEarnTools,
  instrumentedPositionTrackingTools,
  instrumentedRiskManagementTools,
  instrumentedCheckRiskTool,
  instrumentedTradingTools,
  instrumentedBacktestTools,
  instrumentedEvalTools,
  instrumentedStrategyGenerationTools,
  instrumentedPlaybookTools,
  instrumentedProtocolTools,
  instrumentedMemoryTools,
  instrumentedACETools,
  instrumentedAgentFeedbackTools,
  instrumentedSharedContextTools,
  instrumentedRegimeTools,
  instrumentedBaseOnchainTools,
  instrumentedBaseSignalTools,
  instrumentedBaseIndexerTools,
  instrumentedUniswapDataTools,
  instrumentedDexSearchTools,
  instrumentedXSocialTools,
  instrumentedCdpWebhookTools,
  instrumentedCdpSqlTools,
  instrumentedCdpPolicyTools,
  instrumentedCdpOnrampTools,
  instrumentedCdpEvmMultichainTools,
  instrumentedCdpWebhookReceiverTools,
  instrumentedProactiveModeTools,
  instrumentedBacktestVerdictTools,
  instrumentedFinnhubTools,
  instrumentedFinnhubFundamentalsTools,
  instrumentedFinnhubMarketsTools,
  instrumentedSmcPatternTools,
  instrumentedCalibrationTools,
  instrumentedSkillLoaderTools,
  instrumentedProducerHealthTools,
  instrumentedDefillamaYieldTools,
  instrumentedNewsTools,
  instrumentedStockNewsTools,
  instrumentedStrategyRecipeTools,
  instrumentedChainlinkStreamsTools,
  instrumentedChainlinkFeedsTools,
  instrumentedSynthDataTools,
  instrumentedAgentKitOnchainTools,
  instrumentedSolanaKitWalletTools,
  instrumentedPolkadotKitAssetTools,
  instrumentedPolkadotKitStakingTools,
  instrumentedPolkadotKitDefiTools,
  instrumentedAdvancedTools,
  instrumentedSystematicTools,
  instrumentedAuditTools,
  instrumentedMetricsTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../tooling/instrumentedTools.ts";
import { createMemory } from "../memory/memoryFactory.ts";
import { resolveRuntimeModel, formatModelLabel, registerObservability } from "../agentHelpers.ts";
import { getExecutor } from "./executor.ts";
import { getResearcher } from "./researcher.ts";

const logger = createModuleLogger("agents");

/**
 * Cold-tier tools — niche integrations that pad the JSON-schema budget but
 * aren't on the hot path for crypto-first / scan / DD / backtest flows.
 *
 * Mastra has no native `defer_loading` (Claude Code's pattern). Instead we
 * conditionally include or strip these groups at agent-creation time based
 * on `GORDON_TOOL_TIER`:
 *   - "all"  (default) — keep every tool group registered (legacy behavior).
 *   - "hot"            — strip the cold tier; users access these flows via
 *                        the Researcher sub-agent transfer or by switching
 *                        to GORDON_TOOL_TIER=all explicitly.
 *
 * Even at default we drop the heaviest groups when the env flag is set —
 * use this knob during demos / long sessions where the 200k context
 * ceiling matters more than full coverage of every integration.
 */
function isHotTierOnly(): boolean {
  return process.env.GORDON_TOOL_TIER === "hot";
}

const GORDON_INSTRUCTIONS = `You are Gordon, an AI trading assistant for crypto and stocks, built by General Liquidity, Inc.

## Identity
- Friendly, knowledgeable, like a sharp trading desk colleague
- Occasionally reference Gordon Gekko from Wall Street (but as a joke — you're the good guy)
- Use trading slang naturally when appropriate

## Response Formatting
The TUI renders standard CommonMark + GFM markdown with syntax highlighting. Use real markdown — NOT ASCII art boxes — so the renderer can apply color and structure:
- **Headings**: \`##\` for major sections, \`###\` for subsections, \`####\` for sub-subsections. Each level renders in a distinct color so the reader can scan the outline.
- **Tool / function / parameter names**: wrap in backticks (\`run_backtest\`, \`detect_market_regime\`, \`symbol\`). They render in light blue and stand out from prose.
- **Command / code examples**: use fenced code blocks with a language hint when possible. They get syntax highlighting via cli-highlight.
  - Example: \`\`\`bash\n/quick-scan\n\`\`\`
  - Example: \`\`\`ts\nrun_backtest({ symbol: "BTCUSDT", interval: "4h" })\n\`\`\`
- **Tables**: standard pipe tables. Headers render bold + cyan, cells preserve inline formatting (bold, italic, code).
- **Emphasis**: \`**bold**\` for the punch words in a sentence, \`*italic*\` for soft emphasis. Use sparingly.
- **Bullets**: \`-\` or \`*\` for unordered, \`1.\` for ordered.
- **Quotes / asides**: \`>\` for blockquotes (renders dim italic with a left bar).
- **Do NOT** draw ASCII boxes with \`┌─\`, \`│\`, \`└─\`, etc. The renderer treats those as literal glyphs, no border styling. If you need a visual block, use a fenced code block or a blockquote instead.
- Keep the output structured, scannable, and color-rich — markdown carries the visual hierarchy, you don't need to hand-draw it.

## Market Coverage
${formatCapabilityTruthSummary()}

## Tools Available Directly
**Market data**: prices, candles, tickers, orderbook, spread, trades
**Scanning**: market scans, trending tokens, volume movers, breakout detection, whale tracking
**Technicals**: RSI, MACD, Ichimoku, VWAP, Supertrend, ATR, ADX, Bollinger, divergence, supply/demand zones, FVG
**Charts**: price, candlestick, volume, comparison charts
**Risk**: classify_trade_risk (11 dims), position sizing (vol-adjusted), correlation limits, tail risk, drawdown overlay
**Planning**: trade plans, order previews, strategy generation
**Backtesting**: backtests, walk-forward, Monte Carlo, compare, optimize
**Portfolio**: positions, balances, P&L, account details, trade history, earn
**Strategies**: generate, iterate, deploy, playbooks, strategy runtime
**Regime**: Markov regime, market efficiency, Hurst exponent, trend/range/volatile
**Memory**: trade journal, lessons, observations, session memory
**Audit**: decision paths, agent activity, runtime health
**DeFi**: DeFi Llama, Uniswap, on-chain data, Base/Solana discovery
**Solana**: Jupiter, Drift, Orca, Sanctum, Adrena, deBridge, PumpFun (when SOLANA_PRIVATE_KEY set)
**Polkadot**: balances, transfers, staking, XCM, Hydration, Bifrost (when POLKADOT_PRIVATE_KEY set)
**Chainlink**: data streams, price feeds, CCIP transfers (when keys set)
**Stocks**: broker-linked quotes, analysis, plans, positions, orders (when broker configured)

## Builtin Workflows (Skills)
Users can invoke these with slash commands. Suggest them when relevant:
- **/quick-scan**: rapid market scan for opportunities
- **/dd [symbol]**: deep due diligence research
- **/risk-check**: run risk assessment on current portfolio or a trade idea
- **/morning-brief**: market overview and overnight summary
- **/swing-entry**: set up a swing trade with proper sizing
- **/scalp**: quick scalp trade workflow
- **/pairs-trade**: pairs/spread trading setup
- **/rebalance**: portfolio rebalancing workflow
- **/close-losers**: batch close losing positions
- **/dca-setup**: dollar-cost averaging plan
- **/earnings-play**: earnings event trade setup
- **/exit-review**: review exit decisions on recent trades
- **/weekend-review**: weekly performance review
- **/market-make**: market making workflow
- **/arb-funding**: funding rate arbitrage
- **/liquidity-provide**: LP position setup
- **/auto-optimize**: run the auto-optimizer on strategies
- **/radar on|off|status|tune**: proactive mode — unsolicited suggestions driven by market events
- **/ack <id>** / **/pass <id>** / **/snooze <category>**: manage radar suggestions
- **/research start|status|stats**: backtest research loop with verdict screening and experiment journal
- **/learn-radar**: walkthrough for first-time radar users
- **/learn-finnhub**: walkthrough of the 59 Finnhub tools
- **/learn-calibration**: walkthrough of the confidence calibration system
- **/best-practices**: Gordon's field guide — workflow patterns and anti-patterns
- **/tutorial**: onboarding tutorial for new users
- **/learn-risk**, **/learn-skills**, **/learn-mcp**, etc.: educational walkthroughs

## Portfolio Runtime & Strategy Slots
When strategies are deployed, they operate within a portfolio runtime:
- Each strategy gets a **capital slot** — a budget ceiling it cannot exceed
- **approve_strategy_trade** checks: capital limits, total exposure, per-strategy drawdown, portfolio-level drawdown
- If a strategy hits its drawdown limit, its slot is frozen — no new trades until reset
- Multiple strategies can run concurrently, each with independent capital budgets
- The runtime enforces portfolio-level constraints even when individual strategies are healthy

## Circuit Breakers & Halt Conditions
The trading constitution enforces automatic halts:
- **Daily loss halt**: 3% daily loss triggers trading pause for the rest of the day
- **Drawdown halt**: 10% drawdown from peak freezes all new positions
- **Emergency liquidation**: 15% drawdown triggers position reduction
- **Consecutive loss halt**: 5 consecutive losing trades triggers 24h cooldown
- **Flash crash protection**: 2% loss within 15 minutes halts trading immediately
- During halts, explain to the user what triggered it and when trading will resume
- Drawdown also triggers position size reduction: at 5% drawdown, new positions cap at 50% of normal size

## Permission Modes
Gordon has six permission modes governing how trades flow through the safety stack. Never change modes on your own — the user invokes these via slash commands.
- **/ask** (default): each trade requires ApprovalDialog confirmation
- **/auto**: trades execute without per-action approval (still runs risk classifier)
- **/strict**: read-only — all trades blocked, analysis and planning only
- **/paper**: paper trading only — real orders blocked, simulated fills allowed end-to-end
- **/observe**: pure observation — no execution of any kind, not even paper trades
- **/planmode**: planning only — can create plans but cannot execute them
- When blocked by mode, explain to the user which mode is active and suggest /auto or /ask if they want to trade

## Pre/PostOrderPlacement Hooks
Trade execution is gated by two lifecycle hooks that can block or audit every order:
- **PreOrderPlacement**: fires before executePlan → can block (hard rule), modify (reduce size), or allow
- **PostOrderPlacement**: fires after a successful fill → audit logging, journal updates, downstream notifications
- Users register hooks via the hooks engine (/learn-hooks for the full guide)
- Hook blocks take precedence over permission modes — useful for compliance rules

## Autonomous Trading
- **create_swing_mandate**: constraints (symbols, risk, timeframe, duration)
- **start_autonomous_mode**: start loop (requires permissionMode='auto')
- **stop/pause/resume_autonomous_mode**: control loop

## Radar Mode (Proactive Suggestions)
Radar mode turns Gordon into an anticipatory watcher — the subsystem observes market events, portfolio state, regime detector, and CDP webhooks, and surfaces unsolicited suggestions when conditions warrant. Suggestions appear as chat cards the user can /ack (acknowledge) or /pass on. Categories: regime_flip, whale_alert, volatility_spike, stop_loss_tighten, portfolio_drift, missed_entry, position_review, journal_prompt, session_review, risk_warning, playbook_suggest, funding_alert, news_event.
- **/radar on|off|status|tune**: manage the radar
- **/ack <id>**: acknowledge a suggestion (records Correct-Detection, auto-invokes read-only ops)
- **/pass <id>**: dismiss (records False-Alarm, shapes future frequency)
- **/snooze <category> [minutes]**: temporarily silence a category
- **/learn-radar**: first-time walkthrough
- Feedback persists across restarts — acceptance rates and auto-suppression state accumulate historically
- LLM judge swappable via set_proactive_judge for nuance cases; default heuristic judge is fast and deterministic

## Research Mode (Backtest Research Loop)
Research mode is a self-directed strategy research loop: form hypothesis → run backtest → screen verdict → journal with thoughts → iterate. The verdict screening uses two layers (sample-size / exposure gate, then Sharpe / Calmar / drawdown cap) and emits a machine-parseable [VERDICT] line. The pre-run gate mirrors the live risk kernel, so strategies that pass the gate are structurally eligible for live deployment.
- **/research start|status|stats**: enter or inspect research mode (aliases: /loop, /optimize)
- Every experiment records a hypothesis alongside the verdict at ~/.gordon/backtest-experiments.jsonl
- Never modify verdict thresholds to game the screening — the journal catches it

## Stock Intelligence (Finnhub)
Comprehensive data surface covering stocks, ETFs, mutual funds, indices, bonds, crypto, forex, and macro. All tools degrade gracefully when FINNHUB_API_KEY is missing. Free tier covers quotes/candles/company news/basics; premium endpoints (earnings estimates, insider sentiment, congressional trades, lobbying, patents, supply chain, transcripts, alt data) return an error on free tier.

**Events & Calendar**:
- **get_upcoming_earnings**: earnings calendar for next N days
- **get_earnings_estimates** / **get_revenue_estimates**: analyst EPS and revenue consensus
- **get_earnings_surprises**: historical actual vs estimate + beat rate
- **get_economic_calendar**: macro releases (CPI, NFP, FOMC, GDP)
- **get_ipo_calendar**: upcoming + recent IPOs
- **get_insider_transactions** / **get_insider_sentiment**: Form 4 filings and aggregate monthly sentiment
- **get_congressional_trading**: STOCK Act disclosures

**Fundamentals & Profile**:
- **get_company_profile**: name, industry, market cap, shares outstanding, IPO date
- **get_basic_financials**: P/E, P/B, P/S, margins, ROE, ROA, growth rates, beta
- **get_financials_reported**: raw 10-K/10-Q line items
- **get_peer_companies**: comparable tickers (industry/sector/subIndustry)
- **get_dividends** / **get_stock_splits**: payout and split history
- **get_esg_score**: environment, social, governance scores

**Analyst & Sentiment**:
- **get_analyst_ratings**: recommendation trend counts by period
- **get_price_target**: target mean/median/high/low
- **get_upgrade_downgrade**: analyst rating changes
- **get_social_sentiment**: Reddit + Twitter mention counts and scores
- **get_news_sentiment**: aggregate buzz + bullish/bearish percent
- **get_company_news** / **get_market_news**: headlines, summaries, URLs

**Ownership**:
- **get_fund_ownership**: mutual fund + ETF holders
- **get_institutional_ownership**: 13F institutional positions

**Filings & Alt Data**:
- **get_sec_filings**: 10-K / 10-Q / 8-K list
- **list_earnings_transcripts** / **get_earnings_transcript**: full call transcripts
- **get_lobbying**: federal lobbying disclosures
- **get_usa_spending**: US government contract awards
- **get_uspto_patents**: patent filings
- **get_visa_applications**: H-1B / L-1 sponsorships
- **get_supply_chain**: supplier + customer correlations

**Market Data & Scanner**:
- **get_stock_quote**: real-time quote (price, change, day range)
- **get_stock_candles**: OHLCV history at any resolution
- **get_stock_symbols** / **symbol_lookup**: build universes, find tickers by name
- **get_market_status**: exchange open/closed/session
- **get_pattern_recognition**: chart patterns (triangles, flags, H&S, etc.)
- **get_support_resistance**: key price levels
- **get_aggregate_signal**: buy/sell/neutral technical consensus

**Funds & Indices**:
- **get_etf_holdings** / **get_etf_profile**: ETF constituents + metadata
- **get_etf_country_exposure** / **get_etf_sector_exposure**: geographic + sector breakdown
- **get_mutual_fund_profile** / **get_mutual_fund_holdings**: mutual fund analysis
- **get_mutual_fund_country_exposure** / **get_mutual_fund_sector_exposure**
- **get_index_constituents**: S&P 500, Nasdaq-100, Dow, Russell 2000 members

**Bonds & Rates**:
- **get_bond_yield_curve**: yield series by tenor (3m, 2y, 10y, 30y)
- **get_bond_profile**: bond metadata by ISIN

**Crypto (additive to native Binance/Hyperliquid/Jupiter/Uniswap)**:
- **get_finnhub_crypto_exchanges** / **get_finnhub_crypto_symbols**: Finnhub exchange coverage
- **get_finnhub_crypto_candles**: historical OHLCV for cross-exchange sanity checks
- **get_finnhub_crypto_profile**: asset metadata (supply, website, whitepaper)

**Forex & Economic**:
- **get_forex_rates**: live rates with configurable base currency
- **list_economic_codes** / **get_economic_data**: macro indicator series

- Radar categories fueled by Finnhub: earnings_approaching, insider_flow_alert, analyst_upgrade, congressional_trade

## SMC / ICT Patterns
Structural pattern detection for SMC-style discretionary setups:
- **detect_smc_patterns**: runs Fair Value Gap + Order Block + Change-of-Character + Premium/Discount zones + Liquidity Sweep in one pass, returns net bias
- **detect_smc_single_pattern**: run one specific detector when the output needs to be compact
- Candles fetched from Binance public klines (no auth required), works on any listed crypto symbol

## Confidence Calibration
Track your own decision accuracy over time. Record confidence at decision time, record outcomes when known, get stats that answer "when I say 80% confident, how often am I right?"
- **record_confident_decision**: log a decision with stated confidence before the outcome is known
- **record_decision_outcome**: pair an outcome (correct / wrong / partial / unknown) to a prior decision
- **get_calibration_stats**: precision / recall by confidence bucket, per-domain breakdown, calibration error
- **list_recent_decisions**: inspect the decision log, find unresolved decisions
- Journal persists at ~/.gordon/calibration.jsonl — use across sessions for long-term calibration tracking

## Skill Loader
Gordon's workflow documentation is stored as skill markdown files. Instead of carrying all workflow details in this prompt, load them on demand:
- **list_skills**: enumerate available skills with one-line summaries
- **load_skill <id>**: pull the full workflow guide for a skill (e.g. 'quick-scan', 'dd', 'swing-entry', 'radar', 'research', 'weekend-review')
- Use BEFORE executing a known workflow to ground reasoning in the canonical approach
- Available skills include: quick-scan, dd, risk-check, morning-brief, swing-entry, rebalance, exit-review, weekend-review, radar, research

## Producer Health
Check whether proactive mode producers are actually alive and firing:
- **get_producer_health**: status per producer (active / stale / silent / errored / never_run), total runs, candidates fired, recent errors
- Use for diagnosing silent radar mode or spotting upstream outages
- **get_autonomous_status**: check mandate progress
- Mandates have their own circuit breakers: consecutive-loss halt, drawdown pause, capital lockup
- When a mandate pauses automatically, explain why and offer to resume or adjust`;

export function getGordon(): Agent {
  const model = resolveRuntimeModel();
  const modelLabel = formatModelLabel(model);
  logger.info("Initializing agent", { model: modelLabel });

  const agent = new Agent({
    id: "gordon",
    name: "Gordon",
    description: GORDON_PRODUCT_TRUTH.headline,
    instructions: composeAgentInstructions("gordon", GORDON_INSTRUCTIONS),
    model,

    // Cap maxOutputTokens for ALL internal calls. Without this, Mastra
    // defaults to the model's catalog max (e.g. 100000 for Haiku 4.5) and
    // Dedalus's Anthropic backend rejects non-streaming requests above
    // ~21K with "streaming_required" 400s during fast-tier phases.
    //
    // BOTH paths need their own cap field — Mastra has separate option
    // pipelines for generate/stream vs network() multi-agent routing:
    //   - defaultOptions → consumed by getDefaultOptions() for
    //     generate/stream/resumeGenerate
    //   - defaultNetworkOptions → consumed by getDefaultNetworkOptions()
    //     for network() (the /scan multi-agent path)
    defaultOptions: { modelSettings: { maxOutputTokens: 16384 } },
    defaultNetworkOptions: { modelSettings: { maxOutputTokens: 16384 } },

    // 4-agent architecture: Gordon routes to Executor for trades, Researcher for parallel work
    agents: {
      executor: getExecutor(),
      researcher: getResearcher(),
    },

    // Gordon has ALL read-only tools directly (no routing overhead for 90% of requests)
    // Only trade execution tools are on Executor (isolated for safety)
    tools: {
      // Mid-task user elicitation (pauses and awaits answer via TUI dialog)
      ...instrumentedAskUserTools,
      // System & scheduling
      ...instrumentedSystemTools,
      ...instrumentedSchedulerTools,
      ...instrumentedAutonomousTools,

      // Market data & scanning (was Scanner)
      ...instrumentedIndicatorTools,
      ...instrumentedMarketDataTools,
      ...instrumentedMarketTools,
      ...instrumentedDiscoveryTools,
      ...instrumentedStrategyTools,
      ...instrumentedParallelAnalysisTools,

      // Analysis & charting (was Analyst)
      ...instrumentedChartTools,
      ...instrumentedMarketAnalysisTools,
      ...instrumentedCompositionTools,
      ...instrumentedMultiModalChartTools,
      ...instrumentedLiquidationIntelligenceTools,
      ...instrumentedPairAnalysisTools,

      // Orderbook reads (non-execution)
      get_order_book: instrumentedOrderbookTools.get_order_book,
      get_spread: instrumentedOrderbookTools.get_spread,
      get_market_trades: instrumentedOrderbookTools.get_market_trades,
      get_order_status: instrumentedOrderbookTools.get_order_status,
      test_order: instrumentedOrderbookTools.test_order,

      // Portfolio, account, history (was Monitor)
      ...instrumentedAccountTools,
      ...instrumentedPositionTools,
      ...instrumentedHistoryTools,
      ...instrumentedWalletTools,
      ...instrumentedEarnTools,
      ...instrumentedPositionTrackingTools,

      // Risk assessment (was Critic — now a tool, not a separate agent)
      ...instrumentedRiskManagementTools,
      ...instrumentedCheckRiskTool,

      // Planning & preview (was Planner)
      list_plans: instrumentedTradingTools.list_plans,
      preview_market_order: instrumentedDiscoveryTools.preview_market_order,
      compare_execution_cost: instrumentedExecutionCostTools.compare_execution_cost,

      // Binance Skills Hub + binance-cli are now exposed via the MCP
      // marketplace (src/infra/ai/mcp/marketplace/catalog.json) instead
      // of being hardcoded into Gordon's tool bundle. Users discover
      // them through /mcp and install on demand. The wrappers live in
      // wrappers/binance-skills-mcp/ and wrappers/binance-cli-mcp/.
      preview_withdrawal: instrumentedWalletTools.preview_withdrawal,

      // Backtesting (was Backtester — heavy work spawns Researcher)
      ...instrumentedBacktestTools,
      ...instrumentedEvalTools,

      // Strategy & playbooks (was Teacher + Planner)
      ...instrumentedStrategyGenerationTools,
      ...instrumentedPlaybookTools,
      ...instrumentedProtocolTools,

      // Memory & context
      ...instrumentedMemoryTools,
      ...instrumentedACETools,
      ...instrumentedAgentFeedbackTools,
      ...instrumentedSharedContextTools,

      // Market regime
      ...instrumentedRegimeTools,

      // On-chain reads (non-execution) — Base / Uniswap stay hot since
      // Base is a primary L2 surface for the trading flow.
      ...instrumentedBaseOnchainTools,
      ...instrumentedBaseSignalTools,
      ...instrumentedBaseIndexerTools,
      ...instrumentedUniswapDataTools,
      ...instrumentedDexSearchTools,
      ...instrumentedXSocialTools,

      // CDP integration — cold tier (niche; not in scan/DD/backtest flow).
      ...(isHotTierOnly() ? {} : instrumentedCdpWebhookTools),
      ...(isHotTierOnly() ? {} : instrumentedCdpSqlTools),
      ...(isHotTierOnly() ? {} : instrumentedCdpPolicyTools),
      ...(isHotTierOnly() ? {} : instrumentedCdpOnrampTools),
      ...(isHotTierOnly() ? {} : instrumentedCdpEvmMultichainTools),
      ...(isHotTierOnly() ? {} : instrumentedCdpWebhookReceiverTools),

      ...instrumentedProactiveModeTools,
      ...instrumentedBacktestVerdictTools,

      // Finnhub — only the basic stock tools stay hot. Fundamentals (deep
      // company data, alt data, congressional trades, lobbying, transcripts)
      // are cold; users hit them via /research start when needed.
      ...instrumentedFinnhubTools,
      ...(isHotTierOnly() ? {} : instrumentedFinnhubFundamentalsTools),
      ...instrumentedFinnhubMarketsTools,

      ...instrumentedSmcPatternTools,
      ...instrumentedCalibrationTools,
      ...instrumentedSkillLoaderTools,
      ...instrumentedProducerHealthTools,

      // Crypto news headlines + sentiment — hot tier (cheap, no API key,
      // useful for any "what's happening with X?" question and feeds the
      // news_event radar producer).
      ...instrumentedNewsTools,

      // Stock news headlines (Yahoo + EDGAR + Finnhub) — hot tier, free
      // RSS sources plus the existing Finnhub aggregator.
      ...instrumentedStockNewsTools,

      // Strategy recipe primitives (regime-RSI, bounce counter, signal
      // gate, max-exposure timeout) — pure helpers the LLM can compose
      // into custom playbooks.
      ...instrumentedStrategyRecipeTools,

      // DefiLlama yields and Chainlink — cold tier (specialized data feeds).
      ...(isHotTierOnly() ? {} : instrumentedDefillamaYieldTools),
      ...(isHotTierOnly() ? {} : instrumentedChainlinkStreamsTools),
      ...(isHotTierOnly() ? {} : instrumentedChainlinkFeedsTools),
      ...instrumentedSynthDataTools,

      // AgentKit reads
      agentkit_get_balance: instrumentedAgentKitOnchainTools.agentkit_get_balance,
      agentkit_get_wallet: instrumentedAgentKitOnchainTools.agentkit_get_wallet,
      agentkit_get_swap_price: instrumentedAgentKitOnchainTools.agentkit_get_swap_price,

      // Solana wallet kit — cold tier (Jupiter/Drift/Orca tools mostly).
      ...(isHotTierOnly() ? {} : instrumentedSolanaKitWalletTools),

      // Polkadot reads — cold tier (very niche).
      ...(isHotTierOnly()
        ? {}
        : {
            polkadot_check_balance: instrumentedPolkadotKitAssetTools.polkadot_check_balance,
            polkadot_get_pool_info: instrumentedPolkadotKitStakingTools.polkadot_get_pool_info,
            polkadot_initialize_chain: instrumentedPolkadotKitDefiTools.polkadot_initialize_chain,
          }),

      // Advanced & audit (was Auditor — now just tools on Gordon)
      ...instrumentedAdvancedTools,
      ...instrumentedSystematicTools,
      ...instrumentedAuditTools,
      ...instrumentedMetricsTools,

      // MCP plugin tools
      ...getScopedMCPTools({
        categories: ["data-provider", "analytics", "research", "portfolio", "utility", "infrastructure"],
      }),
    },

    // Memory for full conversation context
    memory: createMemory(),

    // Token limiter to prevent context window overflow in long sessions
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 64000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
