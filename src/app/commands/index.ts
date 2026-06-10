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

// Routing Management Commands
export {
  handleRoutingCommand,
  routingList,
  routingInstall,
  routingUninstall,
  routingRoute,
  type RoutingCommandResult,
} from './routing';

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

// Broker Management Commands
export {
  handleBrokerCommand,
  brokerList,
  brokerAdd,
  brokerSwitch,
  brokerRemove,
  brokerStatus,
  type BrokerCommandResult,
} from './broker';

// Stocks Commands
export {
  handleStocksCommand,
} from './stocks';

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

// OAuth Commands
export {
  handleOAuthCommand,
  oauthList,
  oauthVenues,
  oauthConnect,
  oauthPasteToken,
  oauthRemove,
  type OAuthCommandResult,
} from './oauth';

// Telemetry Commands
export {
  handleTelemetryCommand,
  type TelemetryCommandResult,
} from './telemetry';

// Kill-switch commands
export {
  handleKillSwitchCommand,
  type KillSwitchCommandResult,
} from './killswitch.ts';

// Context / cost diagnostics commands
export {
  handleContextCommand,
  type ContextCommandResult,
} from './context';

// Cache audit diagnostic command
export {
  handleCacheAuditCommand,
  type CacheAuditCommandResult,
} from './cacheAudit';
