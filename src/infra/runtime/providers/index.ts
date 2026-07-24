/**
 * Provider Module
 * Model routing for Gordon on top of Mastra's native model router.
 */

export {
  providerRegistry,
  getModel,
  getFastModel,
  getBalancedModel,
  getMastraModel,
  getFastMastraModel,
  getModelRoute,
  getActiveRoute,
  resetProviderRegistry,
  getDirectClientRoute,
  syncActiveProviderEnvironment,
  ProviderRegistry,
  DIRECT_MODELS,
  type ModelMetadata,
  type ModelRoute,
  type ModelString,
  type ProviderName,
  type ProviderConfig,
  type DirectProviderName,
  type GatewayName,
  type MastraModelConfig,
  type MastraOpenAICompatibleModelConfig,
} from "./registry.ts";
