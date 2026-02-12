/**
 * Commands Module
 * Exports all CLI command handlers
 */

// MCP Plugin Management Commands
export {
  handleMCPCommand,
  mcpList,
  mcpSearch,
  mcpInstall,
  mcpUninstall,
  mcpConfigure,
  mcpEnable,
  mcpDisable,
  mcpUpdate,
  mcpInfo,
  type MCPCommandResult,
} from './mcp';

// Config Commands
export {
  handleConfigCommand,
  configView,
  configSet,
  configReset,
  type ConfigCommandResult,
} from './config';

// Exchange Management Commands
export {
  handleExchangeCommand,
  exchangeList,
  exchangeAdd,
  exchangeSwitch,
  exchangeRemove,
  exchangeStatus,
  exchangeCompare,
  type ExchangeCommandResult,
} from './exchange';

// Strategy Management Commands
export {
  handleStrategyCommand,
  handleGenCommand,
  strategyList,
  strategyInfo,
  strategyGenerate,
  strategyBacktest,
  strategyCompare,
  type StrategyCommandResult,
} from './strategy';

// Workflow Commands
export {
  handleWorkflowCommand,
  getAvailableWorkflows,
  formatWorkflowResult,
  type WorkflowContext,
  type WorkflowResult,
  type WorkflowStep,
} from './workflow';

// Export Commands
export {
  handleExportCommand,
  type ExportCommandResult,
} from './export';

// Keyring Commands
export {
  handleKeyringCommand,
  keyringStatus,
  keyringEnable,
  keyringDisable,
  keyringStore,
  keyringClear,
  type KeyringCommandResult,
} from './keyring';
