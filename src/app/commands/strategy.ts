/**
 * Strategy Commands
 * CLI commands for managing trading strategies
 *
 * Commands:
 * - /strategies or /strategy list    - List available strategies
 * - /strategy info <id>              - Show strategy details
 * - /strategy generate <description> - Generate from natural language (alias: /gen)
 * - /strategy backtest <id> <symbol> - Quick backtest
 * - /strategy compare <id1> <id2>    - Compare two strategies
 */

import { strategyRegistry, type StrategyId } from '../../strategies/index.ts';
import {
  listGeneratedStrategies,
  loadGeneratedStrategy,
  getGeneratedStrategyBacktest,
  type GeneratedStrategySummary,
} from '../../infra/storage/entities/generated-strategies.ts';
import { createModuleLogger } from '../../infra/logger/index.ts';
import { playbookRegistry } from '../../core/playbooks/index.ts';
import type { Playbook } from '../../core/playbooks/index.ts';

const logger = createModuleLogger('strategy-commands');

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a strategy command execution
 */
export interface StrategyCommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Additional data (command-specific) */
  data?: unknown;
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * List all available strategies (built-in and generated)
 * Usage: /strategies or /strategy list
 */
export async function strategyList(): Promise<StrategyCommandResult> {
  try {
    // Get built-in strategies from registry
    const builtInStrategies = strategyRegistry.listStrategies();

    // Get generated strategies from storage
    const generatedStrategies = listGeneratedStrategies({
      orderBy: 'createdAt',
      orderDirection: 'desc',
      limit: 20,
    });

    const tier1 = builtInStrategies.filter((s) => s.tier === 1);
    const tier2 = builtInStrategies.filter((s) => s.tier === 2);

    // Get playbooks from the registry (v0.7)
    let playbooks: { id: string; tier: number; riskLevel: string; description: string }[] = [];
    try {
      const allPlaybooks = playbookRegistry.getAll();
      playbooks = allPlaybooks.map((pb) => ({
        id: pb.id,
        tier: pb.tier,
        riskLevel: pb.riskLevel,
        description: pb.description.length > 80 ? pb.description.slice(0, 77) + '...' : pb.description,
      }));
    } catch {
      // Playbook registry may not be initialized yet
    }

    return {
      success: true,
      message: `${builtInStrategies.length} built-in strategies, ${generatedStrategies.length} generated, ${playbooks.length} playbooks`,
      data: {
        builtIn: {
          tier1: tier1.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            riskLevel: s.riskLevel,
            timeframes: s.timeframes,
            indicators: s.indicators,
          })),
          tier2: tier2.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            riskLevel: s.riskLevel,
            timeframes: s.timeframes,
            indicators: s.indicators,
          })),
        },
        generated: generatedStrategies.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          riskLevel: s.riskLevel,
          timeframes: s.timeframes,
          createdAt: s.createdAt,
          backtestReturn: s.backtestReturn,
          backtestSharpe: s.backtestSharpe,
        })),
        playbooks,
        totalBuiltIn: builtInStrategies.length,
        totalGenerated: generatedStrategies.length,
        totalPlaybooks: playbooks.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list strategies: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get detailed information about a strategy
 * Usage: /strategy info <id>
 */
export async function strategyInfo(strategyId: string): Promise<StrategyCommandResult> {
  try {
    if (!strategyId) {
      return {
        success: false,
        message: 'Usage: /strategy info <id>',
      };
    }

    // First check built-in strategies
    const builtIn = strategyRegistry.get(strategyId as StrategyId);

    if (builtIn) {
      return {
        success: true,
        message: `Strategy: ${builtIn.name}`,
        data: {
          source: 'built-in',
          strategy: {
            id: builtIn.id,
            name: builtIn.name,
            description: builtIn.description,
            tier: builtIn.tier,
            riskLevel: builtIn.riskLevel,
            timeframes: builtIn.timeframes,
            indicators: builtIn.indicators,
          },
        },
      };
    }

    // Check generated strategies
    const generated = await loadGeneratedStrategy(strategyId);

    if (generated) {
      const backtest = await getGeneratedStrategyBacktest(strategyId);

      return {
        success: true,
        message: `Strategy: ${generated.name}`,
        data: {
          source: 'generated',
          strategy: {
            id: generated.id,
            name: generated.name,
            description: generated.description,
            version: generated.version,
            tier: generated.tier,
            riskLevel: generated.riskLevel,
            timeframes: generated.timeframes,
            requiredIndicators: generated.requiredIndicators,
            entryRules: {
              longRules: generated.entryRules.long.length,
              shortRules: generated.entryRules.short?.length || 0,
            },
            exitRules: {
              stopLoss: generated.exitRules.stopLoss,
              takeProfitLevels: generated.exitRules.takeProfit.length,
              trailingStop: generated.exitRules.trailingStop?.enabled || false,
            },
            filters: generated.filters,
            metadata: generated.metadata,
          },
          backtestResult: backtest
            ? {
                symbol: backtest.config.symbol,
                timeframe: backtest.config.timeframe,
                totalReturn: backtest.metrics.totalReturn,
                sharpeRatio: backtest.metrics.sharpeRatio,
                maxDrawdown: backtest.metrics.maxDrawdown,
                winRate: backtest.metrics.winRate,
                totalTrades: backtest.metrics.totalTrades,
              }
            : null,
        },
      };
    }

    // Not found
    const availableBuiltIn = strategyRegistry.getIds();
    const availableGenerated = listGeneratedStrategies({ limit: 10 }).map((s) => s.id);

    return {
      success: false,
      message: `Strategy "${strategyId}" not found`,
      data: {
        availableBuiltIn,
        availableGenerated,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get strategy info: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate a strategy from natural language description
 * Usage: /strategy generate <description> or /gen <description>
 *
 * Note: This returns the prompt for the AI to generate the strategy.
 * The actual generation is handled by the strategy_generate tool.
 */
export async function strategyGenerate(description: string): Promise<StrategyCommandResult> {
  if (!description || description.trim().length < 10) {
    return {
      success: false,
      message: `Please provide a description of at least 10 characters.

Examples:
  /gen buy when RSI is oversold and price bounces off support
  /gen trend following strategy using EMA crossovers
  /gen momentum strategy for volatile markets with tight stops`,
    };
  }

  // Return information that the AI will use to call the strategy_generate tool
  return {
    success: true,
    message: `Ready to generate strategy from description: "${description}"`,
    data: {
      action: 'generate_strategy',
      description: description.trim(),
      suggestedParams: {
        riskLevel: 'medium',
        timeframes: ['4h', '1d'],
        backtestDays: 90,
        symbol: 'BTCUSDT',
      },
      prompt: `Generate a trading strategy based on the following description: "${description}".
Use the strategy_generate tool to create a complete strategy with entry rules, exit rules, and risk management.`,
    },
  };
}

/**
 * Quick backtest a strategy
 * Usage: /strategy backtest <id> <symbol>
 *
 * Note: This returns the prompt for the AI to run the backtest.
 * The actual backtesting is handled by the backtesting tools.
 */
export async function strategyBacktest(
  strategyId: string,
  symbol?: string
): Promise<StrategyCommandResult> {
  if (!strategyId) {
    return {
      success: false,
      message: `Usage: /strategy backtest <id> [symbol]

Example:
  /strategy backtest sma_crossover
  /strategy backtest rsi_oversold_bounce ETHUSDT`,
    };
  }

  // Check if strategy exists
  const builtIn = strategyRegistry.get(strategyId as StrategyId);
  const generated = builtIn ? null : await loadGeneratedStrategy(strategyId);

  if (!builtIn && !generated) {
    return {
      success: false,
      message: `Strategy "${strategyId}" not found`,
    };
  }

  const strategy = builtIn || generated;
  const normalizedSymbol = (symbol || 'BTCUSDT').toUpperCase();

  return {
    success: true,
    message: `Ready to backtest strategy "${strategy!.name}" on ${normalizedSymbol}`,
    data: {
      action: 'backtest_strategy',
      strategyId,
      strategyName: strategy!.name,
      symbol: normalizedSymbol,
      suggestedParams: {
        timeframe: strategy!.timeframes[0] || '4h',
        days: 90,
      },
      prompt: `Run a backtest for the "${strategyId}" strategy on ${normalizedSymbol} using the default timeframe and 90 days of data.`,
    },
  };
}

/**
 * Compare two strategies
 * Usage: /strategy compare <id1> <id2>
 */
export async function strategyCompare(
  strategyId1: string,
  strategyId2: string
): Promise<StrategyCommandResult> {
  if (!strategyId1 || !strategyId2) {
    return {
      success: false,
      message: `Usage: /strategy compare <id1> <id2>

Example:
  /strategy compare sma_crossover ema_rsi_crossover`,
    };
  }

  // Load both strategies
  const strategy1 = strategyRegistry.get(strategyId1 as StrategyId) || (await loadGeneratedStrategy(strategyId1));
  const strategy2 = strategyRegistry.get(strategyId2 as StrategyId) || (await loadGeneratedStrategy(strategyId2));

  if (!strategy1) {
    return {
      success: false,
      message: `Strategy "${strategyId1}" not found`,
    };
  }

  if (!strategy2) {
    return {
      success: false,
      message: `Strategy "${strategyId2}" not found`,
    };
  }

  // Get backtest results if available for generated strategies
  const backtest1 = await getGeneratedStrategyBacktest(strategyId1);
  const backtest2 = await getGeneratedStrategyBacktest(strategyId2);

  return {
    success: true,
    message: `Comparing "${strategy1.name}" vs "${strategy2.name}"`,
    data: {
      strategy1: {
        id: strategy1.id,
        name: strategy1.name,
        description: strategy1.description,
        riskLevel: strategy1.riskLevel,
        timeframes: strategy1.timeframes,
        backtest: backtest1
          ? {
              totalReturn: backtest1.metrics.totalReturn,
              sharpeRatio: backtest1.metrics.sharpeRatio,
              maxDrawdown: backtest1.metrics.maxDrawdown,
              winRate: backtest1.metrics.winRate,
              totalTrades: backtest1.metrics.totalTrades,
            }
          : null,
      },
      strategy2: {
        id: strategy2.id,
        name: strategy2.name,
        description: strategy2.description,
        riskLevel: strategy2.riskLevel,
        timeframes: strategy2.timeframes,
        backtest: backtest2
          ? {
              totalReturn: backtest2.metrics.totalReturn,
              sharpeRatio: backtest2.metrics.sharpeRatio,
              maxDrawdown: backtest2.metrics.maxDrawdown,
              winRate: backtest2.metrics.winRate,
              totalTrades: backtest2.metrics.totalTrades,
            }
          : null,
      },
      comparison: {
        riskComparison:
          strategy1.riskLevel === strategy2.riskLevel
            ? 'Same risk level'
            : `${strategy1.name} is ${strategy1.riskLevel} risk, ${strategy2.name} is ${strategy2.riskLevel} risk`,
        timeframeOverlap: strategy1.timeframes.filter((tf) => strategy2.timeframes.includes(tf)),
        hasBacktestData: !!(backtest1 && backtest2),
      },
      prompt:
        backtest1 && backtest2
          ? undefined
          : `To get a proper comparison, run backtests for both strategies using: /backtest ${strategyId1} <symbol> and /backtest ${strategyId2} <symbol>`,
    },
  };
}

// ============================================================================
// v0.7 Sub-Commands
// ============================================================================

/**
 * List all registered playbooks with details and validation status
 * Usage: /strategies playbooks
 */
export async function strategyPlaybooks(): Promise<StrategyCommandResult> {
  try {
    const allPlaybooks = playbookRegistry.getAll();

    if (allPlaybooks.length === 0) {
      return {
        success: true,
        message: 'No playbooks registered. Load playbooks with the PlaybookLoader first.',
      };
    }

    // Get protocol validation status for each playbook
    let validatePlaybook: ((pb: unknown) => { valid: boolean; errors: string[]; warnings: string[] }) | null = null;
    let playbookToProtocol: ((pb: Playbook) => unknown) | null = null;
    try {
      const validators = await import('../../core/playbooks/index.ts');
      validatePlaybook = validators.validatePlaybook;
      playbookToProtocol = validators.playbookToProtocol;
    } catch {
      // Validator may not be available
    }

    // Get backtest results if available
    let listBacktests: ((query: { playbook_name?: string; limit?: number }) => { playbook_name: string; total_return: number; sharpe_ratio: number }[]) | null = null;
    try {
      const backtestStore = await import('../../core/backtesting/index.ts');
      listBacktests = backtestStore.listPlaybookBacktestResults;
    } catch {
      // Backtest store may not be initialized
    }

    const playbookDetails = allPlaybooks.map((pb) => {
      // Validation status
      let validationStatus = 'unknown';
      let warningCount = 0;
      if (validatePlaybook && playbookToProtocol) {
        try {
          const protocol = playbookToProtocol(pb);
          const result = validatePlaybook(protocol);
          if (result.valid) {
            validationStatus = result.warnings.length > 0 ? 'valid (with warnings)' : 'valid';
            warningCount = result.warnings.length;
          } else {
            validationStatus = `invalid (${result.errors.length} errors)`;
          }
        } catch {
          validationStatus = 'error';
        }
      }

      // Last backtest
      let lastBacktest: { total_return: number; sharpe_ratio: number } | null = null;
      if (listBacktests) {
        try {
          const results = listBacktests({ playbook_name: pb.id, limit: 1 });
          if (results.length > 0) {
            lastBacktest = {
              total_return: results[0]!.total_return,
              sharpe_ratio: results[0]!.sharpe_ratio,
            };
          }
        } catch {
          // Backtest query failed
        }
      }

      return {
        id: pb.id,
        name: pb.name,
        tier: pb.tier,
        riskLevel: pb.riskLevel,
        description: pb.description.length > 80 ? pb.description.slice(0, 77) + '...' : pb.description,
        timeframes: pb.timeframes,
        markets: pb.markets,
        tags: pb.tags,
        validationStatus,
        warningCount,
        lastBacktest,
      };
    });

    return {
      success: true,
      message: `${allPlaybooks.length} playbooks registered`,
      data: {
        playbooks: playbookDetails,
        totalPlaybooks: allPlaybooks.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list playbooks: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Show all active strategy slots from the runtime
 * Usage: /strategies running
 */
export async function strategyRunning(): Promise<StrategyCommandResult> {
  try {
    const { strategyRuntime } = await import('../../core/runtime/index.ts');

    const activeSlots = strategyRuntime.getActiveSlots();
    const portfolio = strategyRuntime.getPortfolioState();

    if (activeSlots.length === 0) {
      return {
        success: true,
        message: 'No active strategy slots.\n\nUse /deploy <playbook-name> to activate a playbook as a live strategy.',
      };
    }

    const slotDetails = activeSlots.map((slot) => {
      const winRate = slot.total_trades > 0
        ? ((slot.winning_trades / slot.total_trades) * 100).toFixed(1)
        : 'N/A';

      return {
        slot_id: slot.slot_id,
        playbook: slot.playbook_name,
        status: slot.status,
        allocated: `$${slot.allocated_capital.toFixed(0)} (${slot.allocated_percent.toFixed(0)}%)`,
        used: `$${slot.used_capital.toFixed(0)}`,
        pnl: slot.total_pnl,
        trades: slot.total_trades,
        winRate,
        drawdown: slot.current_drawdown_percent,
        started: slot.started_at,
      };
    });

    return {
      success: true,
      message: `${activeSlots.length} active strategy slot(s)`,
      data: {
        slots: slotDetails,
        portfolio: {
          totalCapital: portfolio.total_capital,
          allocatedCapital: portfolio.allocated_capital,
          unallocatedCapital: portfolio.unallocated_capital,
          deployedCapital: portfolio.deployed_capital,
          totalPnl: portfolio.total_pnl,
          drawdown: portfolio.portfolio_drawdown_percent,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get running strategies: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Show genome variants and evolution status
 * Usage: /strategies evolving
 */
export async function strategyEvolving(): Promise<StrategyCommandResult> {
  try {
    const { GenomeManager } = await import('../../core/genome/index.ts');
    const manager = GenomeManager.getInstance();

    // Get all playbooks and their genomes
    const allPlaybooks = playbookRegistry.getAll();
    const playbookGenomes: {
      playbook: string;
      genomes: { genome_id: string; generation: number; status: string; fitness_score?: number; mutations: number }[];
      best_fitness?: number;
    }[] = [];

    for (const pb of allPlaybooks) {
      try {
        const genomes = manager.getGenomes(pb.id);
        if (genomes.length > 0) {
          const best = manager.getBestGenome(pb.id);
          playbookGenomes.push({
            playbook: pb.id,
            genomes: genomes.map((g) => ({
              genome_id: g.genome_id,
              generation: g.generation,
              status: g.status,
              fitness_score: g.fitness_score,
              mutations: g.mutations_from_parent.length,
            })),
            best_fitness: best?.fitness_score,
          });
        }
      } catch {
        // Skip playbooks that fail genome lookup
      }
    }

    // Get active experiments
    let experiments: { experiment_id: string; name: string; status: string; symbol: string; winner: string; control_trades: number; variant_trades: number }[] = [];
    try {
      const active = manager.getActiveExperiments();
      experiments = active.map((exp) => ({
        experiment_id: exp.experiment_id,
        name: exp.name,
        status: exp.status,
        symbol: exp.symbol,
        winner: exp.winner,
        control_trades: exp.control_trades,
        variant_trades: exp.variant_trades,
      }));
    } catch {
      // Experiment lookup may fail
    }

    if (playbookGenomes.length === 0 && experiments.length === 0) {
      return {
        success: true,
        message: 'No genome variants or experiments found.\n\nUse the genome tools to fork and evolve playbooks.',
      };
    }

    return {
      success: true,
      message: `${playbookGenomes.length} playbook(s) with genomes, ${experiments.length} active experiment(s)`,
      data: {
        playbookGenomes,
        experiments,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get evolution status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Command Router
// ============================================================================

/**
 * Handle strategy command routing
 * @param args - Full arguments string (e.g., "list", "info sma_crossover", "generate buy on RSI oversold")
 */
export async function handleStrategyCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? 'list';
  const subArgs = parts.slice(1);

  let result: StrategyCommandResult;

  switch (subcommand) {
    case 'list':
    case 'ls':
    case '':
      result = await strategyList();
      break;

    case 'info':
    case 'show':
    case 'details':
      result = await strategyInfo(subArgs[0] || '');
      break;

    case 'playbooks':
    case 'pb':
      result = await strategyPlaybooks();
      break;

    case 'running':
    case 'active':
    case 'slots':
      result = await strategyRunning();
      break;

    case 'evolving':
    case 'evolution':
    case 'genomes':
      result = await strategyEvolving();
      break;

    case 'generate':
    case 'gen':
    case 'create':
      result = await strategyGenerate(subArgs.join(' '));
      break;

    case 'backtest':
    case 'bt':
    case 'test':
      result = await strategyBacktest(subArgs[0] || '', subArgs[1]);
      break;

    case 'compare':
    case 'cmp':
    case 'vs':
      result = await strategyCompare(subArgs[0] || '', subArgs[1] || '');
      break;

    case 'help':
      result = {
        success: true,
        message: `Strategy Management Commands:
  /strategies                       - List all strategies + playbooks
  /strategy list                    - List all strategies + playbooks
  /strategy info <id>               - Show strategy details
  /strategy playbooks               - List playbooks with validation & backtest status
  /strategy running                 - Show active strategy slots
  /strategy evolving                - Show genome variants and experiments
  /strategy generate <description>  - Generate from natural language
  /strategy backtest <id> [symbol]  - Quick backtest a strategy
  /strategy compare <id1> <id2>     - Compare two strategies

Aliases:
  /strat, /strats - Short for /strategy, /strategies
  /gen <desc>     - Quick alias for /strategy generate

Examples:
  /strategies
  /strategy info sma_crossover
  /strategy playbooks
  /strategy running
  /strategy evolving
  /gen buy when RSI is oversold near support
  /strategy backtest ema_rsi_crossover ETHUSDT
  /strategy compare sma_crossover bollinger_bounce`,
      };
      break;

    default:
      // Check if it might be a strategy ID directly
      const possibleId = subcommand;
      const builtIn = strategyRegistry.get(possibleId as StrategyId);
      const generated = builtIn ? null : await loadGeneratedStrategy(possibleId);

      if (builtIn || generated) {
        // Treat as info command
        result = await strategyInfo(possibleId);
      } else {
        result = {
          success: false,
          message: `Unknown subcommand: ${subcommand}. Use "/strategy help" for available commands.`,
        };
      }
  }

  return formatStrategyResult(result);
}

/**
 * Handle the /gen quick alias command
 * @param description - Strategy description
 */
export async function handleGenCommand(description: string): Promise<string> {
  const result = await strategyGenerate(description);
  return formatStrategyResult(result);
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a strategy command result for display
 */
function formatStrategyResult(result: StrategyCommandResult): string {
  const lines: string[] = [];

  if (!result.success) {
    lines.push(`Error: ${result.message}`);
  } else {
    lines.push(result.message);
  }

  if (result.data) {
    const data = result.data as Record<string, unknown>;

    // Strategy list
    if (data.builtIn || data.generated) {
      const builtIn = data.builtIn as {
        tier1: Array<{ id: string; name: string; riskLevel: string }>;
        tier2: Array<{ id: string; name: string; riskLevel: string }>;
      };
      const generated = data.generated as Array<{
        id: string;
        name: string;
        riskLevel: string;
        backtestReturn?: number;
      }>;
      const playbooks = data.playbooks as Array<{
        id: string;
        tier: number;
        riskLevel: string;
        description: string;
      }> | undefined;

      if (builtIn?.tier1?.length) {
        lines.push('');
        lines.push('Beginner Strategies (Tier 1):');
        for (const s of builtIn.tier1) {
          lines.push(`  ${s.id}: ${s.name} [${s.riskLevel}]`);
        }
      }

      if (builtIn?.tier2?.length) {
        lines.push('');
        lines.push('Intermediate Strategies (Tier 2):');
        for (const s of builtIn.tier2) {
          lines.push(`  ${s.id}: ${s.name} [${s.riskLevel}]`);
        }
      }

      if (generated?.length) {
        lines.push('');
        lines.push('Generated Strategies:');
        for (const s of generated) {
          const returnStr =
            s.backtestReturn !== undefined
              ? ` (${s.backtestReturn > 0 ? '+' : ''}${s.backtestReturn.toFixed(1)}%)`
              : '';
          lines.push(`  ${s.id}: ${s.name} [${s.riskLevel}]${returnStr}`);
        }
      }

      if (playbooks && playbooks.length > 0) {
        lines.push('');
        lines.push('Playbooks (v0.7):');
        for (const pb of playbooks) {
          const tierLabel = `Tier ${pb.tier}`;
          const risk = pb.riskLevel.charAt(0).toUpperCase() + pb.riskLevel.slice(1);
          lines.push(`  ${pb.id.padEnd(25)} ${tierLabel}  ${risk.padEnd(8)} ${pb.description}`);
        }
        lines.push('');
        lines.push('Use /deploy <name> to activate a playbook as a live strategy.');
      }
    }

    // Playbooks list (from /strategies playbooks)
    if (data.playbooks && data.totalPlaybooks !== undefined && !data.builtIn) {
      const pbs = data.playbooks as Array<{
        id: string;
        name: string;
        tier: number;
        riskLevel: string;
        description: string;
        timeframes: string[];
        tags: string[];
        validationStatus: string;
        warningCount: number;
        lastBacktest: { total_return: number; sharpe_ratio: number } | null;
      }>;

      for (const pb of pbs) {
        lines.push('');
        lines.push(`  ${pb.id} (${pb.name})`);
        lines.push(`    Tier: ${pb.tier}  |  Risk: ${pb.riskLevel}  |  Timeframes: ${pb.timeframes.join(', ')}`);
        lines.push(`    Tags: ${pb.tags.join(', ') || 'none'}`);
        lines.push(`    Protocol: ${pb.validationStatus}${pb.warningCount > 0 ? ` (${pb.warningCount} warnings)` : ''}`);
        if (pb.lastBacktest) {
          const retSign = pb.lastBacktest.total_return > 0 ? '+' : '';
          lines.push(`    Last Backtest: ${retSign}${pb.lastBacktest.total_return.toFixed(1)}% return, Sharpe: ${pb.lastBacktest.sharpe_ratio.toFixed(2)}`);
        } else {
          lines.push('    Last Backtest: none');
        }
        lines.push(`    ${pb.description}`);
      }
    }

    // Running slots (from /strategies running)
    if (data.slots && data.portfolio) {
      const slots = data.slots as Array<{
        slot_id: string;
        playbook: string;
        status: string;
        allocated: string;
        used: string;
        pnl: number;
        trades: number;
        winRate: string;
        drawdown: number;
        started: string;
      }>;
      const portfolio = data.portfolio as {
        totalCapital: number;
        allocatedCapital: number;
        unallocatedCapital: number;
        deployedCapital: number;
        totalPnl: number;
        drawdown: number;
      };

      lines.push('');
      lines.push('Portfolio:');
      lines.push(`  Total Capital:   $${portfolio.totalCapital.toFixed(2)}`);
      lines.push(`  Allocated:       $${portfolio.allocatedCapital.toFixed(2)}`);
      lines.push(`  Unallocated:     $${portfolio.unallocatedCapital.toFixed(2)}`);
      lines.push(`  Total PnL:       $${portfolio.totalPnl.toFixed(2)}`);
      lines.push(`  Drawdown:        ${portfolio.drawdown.toFixed(1)}%`);

      lines.push('');
      lines.push('Active Slots:');
      lines.push('-'.repeat(80));
      for (const slot of slots) {
        const statusIcon = slot.status === 'active' ? '[ON]' : `[${slot.status.toUpperCase()}]`;
        const pnlStr = `$${slot.pnl.toFixed(2)}`;
        lines.push(
          `  ${statusIcon} ${slot.playbook.padEnd(25)} | ${slot.allocated} | PnL: ${pnlStr} | Trades: ${slot.trades} | Win: ${slot.winRate}% | DD: ${slot.drawdown.toFixed(1)}%`
        );
      }
    }

    // Evolving genomes (from /strategies evolving)
    if (data.playbookGenomes || data.experiments) {
      const playbookGenomes = (data.playbookGenomes || []) as Array<{
        playbook: string;
        genomes: Array<{ genome_id: string; generation: number; status: string; fitness_score?: number; mutations: number }>;
        best_fitness?: number;
      }>;
      const experiments = (data.experiments || []) as Array<{
        experiment_id: string;
        name: string;
        status: string;
        symbol: string;
        winner: string;
        control_trades: number;
        variant_trades: number;
      }>;

      if (playbookGenomes.length > 0) {
        lines.push('');
        lines.push('Genome Variants:');
        lines.push('-'.repeat(80));
        for (const pg of playbookGenomes) {
          const bestStr = pg.best_fitness !== undefined ? ` (best fitness: ${pg.best_fitness.toFixed(1)})` : '';
          lines.push(`  ${pg.playbook}: ${pg.genomes.length} variant(s)${bestStr}`);
          for (const g of pg.genomes) {
            const fitnessStr = g.fitness_score !== undefined ? ` fitness: ${g.fitness_score.toFixed(1)}` : '';
            const mutStr = g.mutations > 0 ? ` [${g.mutations} mutations]` : '';
            lines.push(`    Gen ${g.generation}: ${g.status}${fitnessStr}${mutStr}`);
          }
        }
      }

      if (experiments.length > 0) {
        lines.push('');
        lines.push('Active Experiments:');
        lines.push('-'.repeat(80));
        for (const exp of experiments) {
          lines.push(`  ${exp.name} (${exp.symbol})`);
          lines.push(`    Status: ${exp.status} | Winner: ${exp.winner} | Control: ${exp.control_trades} trades | Variant: ${exp.variant_trades} trades`);
        }
      }
    }

    // Strategy info
    if (data.strategy && data.source) {
      const strategy = data.strategy as {
        id: string;
        name: string;
        description: string;
        tier?: number | string;
        riskLevel: string;
        timeframes: string[];
        indicators?: string[];
        requiredIndicators?: string[];
        entryRules?: { longRules: number; shortRules: number };
        exitRules?: { stopLoss: unknown; takeProfitLevels: number; trailingStop: boolean };
      };

      lines.push('');
      lines.push(`ID: ${strategy.id}`);
      lines.push(`Source: ${data.source}`);
      lines.push(`Description: ${strategy.description}`);
      lines.push(`Risk Level: ${strategy.riskLevel}`);
      lines.push(`Tier: ${strategy.tier || 'N/A'}`);
      lines.push(`Timeframes: ${strategy.timeframes.join(', ')}`);

      if (strategy.indicators) {
        lines.push(`Indicators: ${strategy.indicators.join(', ')}`);
      }
      if (strategy.requiredIndicators) {
        lines.push(`Required Indicators: ${strategy.requiredIndicators.join(', ')}`);
      }

      if (strategy.entryRules) {
        lines.push(`Entry Rules: ${strategy.entryRules.longRules} long, ${strategy.entryRules.shortRules} short`);
      }

      if (strategy.exitRules) {
        lines.push(`Take Profit Levels: ${strategy.exitRules.takeProfitLevels}`);
        lines.push(`Trailing Stop: ${strategy.exitRules.trailingStop ? 'Enabled' : 'Disabled'}`);
      }

      const backtestResult = data.backtestResult as {
        symbol: string;
        timeframe: string;
        totalReturn: number;
        sharpeRatio: number;
        maxDrawdown: number;
        winRate: number;
        totalTrades: number;
      } | null;

      if (backtestResult) {
        lines.push('');
        lines.push('Last Backtest Results:');
        lines.push(`  Symbol: ${backtestResult.symbol} (${backtestResult.timeframe})`);
        lines.push(`  Return: ${backtestResult.totalReturn > 0 ? '+' : ''}${backtestResult.totalReturn.toFixed(2)}%`);
        lines.push(`  Sharpe: ${backtestResult.sharpeRatio.toFixed(2)}`);
        lines.push(`  Max Drawdown: ${backtestResult.maxDrawdown.toFixed(2)}%`);
        lines.push(`  Win Rate: ${backtestResult.winRate.toFixed(1)}%`);
        lines.push(`  Total Trades: ${backtestResult.totalTrades}`);
      }
    }

    // Comparison
    if (data.strategy1 && data.strategy2) {
      const s1 = data.strategy1 as {
        name: string;
        riskLevel: string;
        timeframes: string[];
        backtest: { totalReturn: number; sharpeRatio: number; winRate: number } | null;
      };
      const s2 = data.strategy2 as {
        name: string;
        riskLevel: string;
        timeframes: string[];
        backtest: { totalReturn: number; sharpeRatio: number; winRate: number } | null;
      };

      lines.push('');
      lines.push(`${s1.name.padEnd(30)} vs ${s2.name}`);
      lines.push('-'.repeat(60));
      lines.push(`Risk: ${s1.riskLevel.padEnd(24)} | ${s2.riskLevel}`);
      lines.push(`Timeframes: ${s1.timeframes.join(', ').padEnd(17)} | ${s2.timeframes.join(', ')}`);

      if (s1.backtest && s2.backtest) {
        lines.push('');
        lines.push('Backtest Comparison:');
        lines.push(`Return: ${(s1.backtest.totalReturn > 0 ? '+' : '') + s1.backtest.totalReturn.toFixed(1) + '%'}${' '.repeat(16)} | ${(s2.backtest.totalReturn > 0 ? '+' : '') + s2.backtest.totalReturn.toFixed(1)}%`);
        lines.push(`Sharpe: ${s1.backtest.sharpeRatio.toFixed(2).padEnd(22)} | ${s2.backtest.sharpeRatio.toFixed(2)}`);
        lines.push(`Win Rate: ${(s1.backtest.winRate.toFixed(1) + '%').padEnd(20)} | ${s2.backtest.winRate.toFixed(1)}%`);
      }
    }

    // Generate prompt
    if (data.action === 'generate_strategy') {
      lines.push('');
      lines.push('The AI will now generate a strategy based on your description.');
    }

    // Backtest prompt
    if (data.action === 'backtest_strategy') {
      lines.push('');
      lines.push('The AI will now run a backtest for this strategy.');
    }

    // Additional prompt
    if (data.prompt && typeof data.prompt === 'string' && !data.action) {
      lines.push('');
      lines.push(`Note: ${data.prompt}`);
    }
  }

  return lines.join('\n');
}
