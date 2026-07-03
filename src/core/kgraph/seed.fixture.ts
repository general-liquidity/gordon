// Test fixture: a hand-seeded financial knowledge graph of structural
// supply-chain / competition / macro relationships. NOT a runtime default -
// the runtime path is data-derived (buildGraphFromCorrelations). Kept out of
// the shipping module so no hardcoded entity list ships as a runtime seed.
import {
  FinancialGraph,
  type EntityId,
  type EntityType,
  type Relationship,
  type RelationshipKind,
} from "./graph.ts";

/**
 * Pre-built seed graph of well-known structural financial relationships:
 * supply chains, competition, macro→market transmission, sector membership,
 * regulatory exposure, crypto correlation. These are structural domain facts
 * (X supplies Y, oil affects airlines), not a tradeable symbol universe — the
 * data-derived path (`buildGraphFromCorrelations`) covers dynamic seeding.
 *
 * Faithful port of `seed_graph()`.
 */
export function seedGraph(): FinancialGraph {
  const g = new FinancialGraph();

  const rel = (
    kind: RelationshipKind,
    weight: number,
    description: string,
    correlation?: number,
  ): Relationship => ({
    kind,
    weight,
    correlation,
    description,
    source: "seed",
  });

  // Supply chain
  g.addRelationship(
    "TSMC",
    "NVIDIA",
    rel("supplies", 0.95, "TSMC manufactures NVIDIA GPUs on its advanced nodes (3nm, 5nm)"),
  );
  g.addRelationship(
    "TSMC",
    "APPLE",
    rel("supplies", 0.95, "TSMC manufactures Apple A-series and M-series chips exclusively"),
  );
  g.addRelationship(
    "TSMC",
    "AMD",
    rel("supplies", 0.9, "TSMC manufactures AMD Zen CPUs and RDNA GPUs"),
  );
  g.addRelationship(
    "SAMSUNG",
    "QUALCOMM",
    rel("supplies", 0.7, "Samsung Foundry manufactures some Snapdragon chips"),
  );

  // Competition
  g.addRelationship(
    "NVIDIA",
    "AMD",
    rel("competes", 0.85, "Direct GPU competition across data center and gaming"),
  );
  g.addRelationship(
    "NVIDIA",
    "INTEL",
    rel("competes", 0.6, "Competing in AI accelerator and data center markets"),
  );
  g.addRelationship(
    "APPLE",
    "GOOGLE",
    rel("competes", 0.8, "Mobile OS and consumer device competition"),
  );
  g.addRelationship(
    "APPLE",
    "MICROSOFT",
    rel("competes", 0.65, "Enterprise and productivity software competition"),
  );

  // Macro -> market impacts
  g.addRelationship(
    "FED_FUNDS_RATE",
    "NASDAQ",
    rel(
      "affects",
      0.9,
      "Rising rates increase discount rate on growth stocks, compressing multiples",
      -0.75,
    ),
  );
  g.addRelationship(
    "FED_FUNDS_RATE",
    "TREASURY_10Y",
    rel(
      "affects",
      0.95,
      "Fed rate directly drives short end; long end influenced by inflation expectations",
      0.85,
    ),
  );
  g.addRelationship(
    "TREASURY_10Y",
    "SP500",
    rel(
      "affects",
      0.8,
      "10Y yield is the risk-free rate; higher yields compress equity valuations",
      -0.65,
    ),
  );
  g.addRelationship(
    "OIL_WTI",
    "AIRLINES",
    rel(
      "affects",
      0.88,
      "Jet fuel is ~25% of airline operating costs; oil price directly hits margins",
      -0.8,
    ),
  );
  g.addRelationship(
    "OIL_WTI",
    "ENERGY_SECTOR",
    rel(
      "affects",
      0.92,
      "Oil price is the primary revenue driver for upstream energy companies",
      0.88,
    ),
  );
  g.addRelationship(
    "DXY",
    "GOLD",
    rel("affects", 0.85, "Dollar strength makes gold more expensive for non-USD buyers", -0.72),
  );
  g.addRelationship(
    "DXY",
    "EMERGING_MARKETS",
    rel(
      "affects",
      0.8,
      "Strong dollar pressures EM currencies, tightens USD-denominated debt conditions",
      -0.7,
    ),
  );

  // Sector membership
  for (const ticker of ["NVIDIA", "AMD", "INTEL", "TSMC", "APPLE", "MICROSOFT", "GOOGLE", "META"]) {
    g.addRelationship(
      ticker,
      "TECHNOLOGY_SECTOR",
      rel("part_of", 1.0, "Technology sector constituent"),
    );
  }
  for (const ticker of ["JPMORGAN", "GOLDMAN_SACHS", "MORGAN_STANLEY", "WELLS_FARGO"]) {
    g.addRelationship(
      ticker,
      "FINANCIALS_SECTOR",
      rel("part_of", 1.0, "Financials sector constituent"),
    );
  }

  // Regulatory
  g.addRelationship(
    "META",
    "FTC",
    rel(
      "regulated_by",
      0.9,
      "FTC has brought antitrust cases against Meta; Instagram/WhatsApp acquisitions under scrutiny",
    ),
  );
  g.addRelationship(
    "GOOGLE",
    "EU_COMPETITION",
    rel(
      "regulated_by",
      0.9,
      "EU has fined Google multiple times for search and Android antitrust violations",
    ),
  );
  g.addRelationship(
    "NVIDIA",
    "BIS_EXPORT",
    rel("regulated_by", 0.85, "BIS export controls restrict sale of H100/H200 chips to China"),
  );

  // Crypto / digital assets
  g.addRelationship(
    "BTC",
    "NASDAQ",
    rel(
      "correlates",
      0.65,
      "Bitcoin has shown positive correlation with risk-on tech assets since 2020",
      0.55,
    ),
  );
  g.addRelationship(
    "BTC",
    "GOLD",
    rel(
      "correlates",
      0.4,
      "Both positioned as inflation hedges; correlation is inconsistent",
      0.3,
    ),
  );

  // Set entity types / display names where we can infer them.
  const setType = (id: EntityId, t: EntityType, name: string): void => {
    const e = g.getEntity(id);
    if (e) {
      e.entityType = t;
      e.name = name;
    }
  };

  setType("FED_FUNDS_RATE", "macro_indicator", "Fed Funds Rate");
  setType("TREASURY_10Y", "macro_indicator", "10Y Treasury Yield");
  setType("DXY", "index", "US Dollar Index");
  setType("SP500", "index", "S&P 500");
  setType("NASDAQ", "index", "NASDAQ Composite");
  setType("OIL_WTI", "commodity", "WTI Crude Oil");
  setType("GOLD", "commodity", "Gold");
  setType("BTC", "currency", "Bitcoin");
  setType("TECHNOLOGY_SECTOR", "sector", "Technology Sector");
  setType("FINANCIALS_SECTOR", "sector", "Financials Sector");
  setType("ENERGY_SECTOR", "sector", "Energy Sector");
  setType("AIRLINES", "sector", "Airlines Sector");
  setType("EMERGING_MARKETS", "sector", "Emerging Markets");
  setType("FTC", "regulation", "Federal Trade Commission");
  setType("EU_COMPETITION", "regulation", "EU Competition Authority");
  setType("BIS_EXPORT", "regulation", "BIS Export Controls");

  return g;
}
