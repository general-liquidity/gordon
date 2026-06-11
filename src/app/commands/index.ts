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
} from './mcp.ts';

// Routing Management Commands
export {
  handleRoutingCommand,
  routingList,
  routingInstall,
  routingUninstall,
  routingRoute,
  type RoutingCommandResult,
} from './routing.ts';

// Config Commands
export {
  handleConfigCommand,
  configView,
  configSet,
  configReset,
  type ConfigCommandResult,
} from './config.ts';

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
} from './exchange.ts';

// Broker Management Commands
export {
  handleBrokerCommand,
  brokerList,
  brokerAdd,
  brokerSwitch,
  brokerRemove,
  brokerStatus,
  type BrokerCommandResult,
} from './broker.ts';

// Stocks Commands
export {
  handleStocksCommand,
} from './stocks.ts';

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
} from './strategy.ts';

// Workflow Commands
export {
  handleWorkflowCommand,
  getAvailableWorkflows,
  formatWorkflowResult,
  type WorkflowContext,
  type WorkflowResult,
  type WorkflowStep,
} from './workflow.ts';

// Export Commands
export {
  handleExportCommand,
  type ExportCommandResult,
} from './export.ts';

// Keyring Commands
export {
  handleKeyringCommand,
  keyringStatus,
  keyringEnable,
  keyringDisable,
  keyringStore,
  keyringClear,
  type KeyringCommandResult,
} from './keyring.ts';

// OAuth Commands
export {
  handleOAuthCommand,
  oauthList,
  oauthVenues,
  oauthConnect,
  oauthPasteToken,
  oauthRemove,
  type OAuthCommandResult,
} from './oauth.ts';

// Telemetry Commands
export {
  handleTelemetryCommand,
  type TelemetryCommandResult,
} from './telemetry.ts';

// Kill-switch commands
export {
  handleKillSwitchCommand,
  type KillSwitchCommandResult,
} from './killswitch.ts';

// Context / cost diagnostics commands
export {
  handleContextCommand,
  type ContextCommandResult,
} from './context.ts';

// Cache audit diagnostic command
export {
  handleCacheAuditCommand,
  type CacheAuditCommandResult,
} from './cacheAudit.ts';
