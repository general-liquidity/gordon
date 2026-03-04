/**
 * Provider Module
 * Multi-provider support for Gordon
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
  getLegacyClientRoute,
  getDedalusModels,
  refreshDedalusModels,
  ProviderRegistry,
  type ModelMetadata,
  type ProviderName,
  type ProviderConfig,
  type MastraModelConfig,
} from "./registry.ts";
