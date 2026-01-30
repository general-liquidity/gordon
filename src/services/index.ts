/**
 * Services Index
 */

// Container
export {
  ServiceContainer,
  getContainer,
  setContainer,
  initializeContainer,
  type ContainerConfig,
  type Services,
} from "./container.ts";

// Trading service
export {
  TradingService,
  getTradingService,
} from "./trading.service.ts";

// Portfolio service
export {
  PortfolioService,
  getPortfolioService,
  type Holding,
  type PortfolioSummary,
} from "./portfolio.service.ts";

// Reconciliation service
export {
  reconcileWithBinance,
  type ReconciliationResult,
} from "./reconciliation.service.ts";
