/**
 * FinancialGraph — a directed knowledge graph over financial entities.
 *
 * Ported from gordon-rs `gordon-kgraph` (graph.rs, MIT provenance from the
 * rust-finance `knowledge_graph` crate). Nodes are issuers / sectors /
 * macro indicators / instruments; edges are typed, signed relationships
 * (supplies / affects / correlates / part-of / …).
 *
 * The Rust original wraps a petgraph DiGraph. TS has no petgraph, so this
 * keeps its own adjacency: a node map plus outgoing/incoming edge lists
 * keyed by entity id. Same directional semantics, same query surface.
 *
 * Pure and self-contained — no network access, no LLM client.
 */

export type EntityId = string;

export type EntityType =
  | "company"
  | "person"
  | "sector"
  | "country"
  | "currency"
  | "commodity"
  | "index"
  | "macro_indicator"
  | "regulation"
  | "event";

/** Canonical relationship kinds. Unknown kinds pass through as free strings. */
export type RelationshipKind =
  | "supplies"
  | "competes"
  | "owns"
  | "regulated_by"
  | "affects"
  | "led_by"
  | "part_of"
  | "depends_on"
  | "correlates"
  | "acquires"
  | "supplied_by"
  | string;

export interface EntityNode {
  id: EntityId;
  name: string;
  entityType: EntityType;
  ticker?: string;
  sector?: string;
  country?: string;
  /** Free-form metadata (e.g. { market_cap: "2.5T" }). */
  metadata: Record<string, string>;
  /** Sentiment score injected from news / sim, in [-1, 1]. */
  sentiment: number;
  lastUpdatedMs: number;
}

export interface Relationship {
  kind: RelationshipKind;
  /** Strength of the relationship in [0, 1]. */
  weight: number;
  /** For AFFECTS/CORRELATES: the correlation coefficient. */
  correlation?: number;
  description: string;
  /** "seed" | "doc_ingest" | "manual" | "sim" | "correlation" | … */
  source: string;
}

interface Edge {
  from: EntityId;
  to: EntityId;
  rel: Relationship;
}

/** Human-readable label for a relationship kind (TUI / report rendering). */
export function relationshipLabel(kind: RelationshipKind): string {
  switch (kind) {
    case "supplies":
      return "supplies";
    case "competes":
      return "competes with";
    case "owns":
      return "owns";
    case "regulated_by":
      return "regulated by";
    case "affects":
      return "affects";
    case "led_by":
      return "led by";
    case "part_of":
      return "part of";
    case "depends_on":
      return "depends on";
    case "correlates":
      return "correlates with";
    case "acquires":
      return "acquires";
    case "supplied_by":
      return "supplied by";
    default:
      return kind;
  }
}

/**
 * Is this relationship bearish or bullish for the target when the source is
 * shocked upward? Drives ImpactEngine contagion direction.
 *
 * Faithful port of `RelationshipKind::propagation_sign`.
 */
export function propagationSign(kind: RelationshipKind): number {
  switch (kind) {
    case "supplies":
    case "supplied_by":
      return -0.6; // supply disruption = negative
    case "affects":
      return -1.0;
    case "depends_on":
      return -0.8;
    case "correlates":
      return 0.7;
    case "competes":
      return 0.3; // competitor pain = your gain
    default:
      return 0.0;
  }
}

export class FinancialGraph {
  private nodes: Map<EntityId, EntityNode> = new Map();
  private outgoing: Map<EntityId, Edge[]> = new Map();
  private incoming: Map<EntityId, Edge[]> = new Map();

  /** Add or update an entity by id. */
  upsertEntity(entity: EntityNode): void {
    this.nodes.set(entity.id, entity);
    if (!this.outgoing.has(entity.id)) this.outgoing.set(entity.id, []);
    if (!this.incoming.has(entity.id)) this.incoming.set(entity.id, []);
  }

  /**
   * Add a directed relationship between two entities by id. Creates minimal
   * entities if they don't exist yet. Skips duplicate edges of the same kind.
   */
  addRelationship(fromId: EntityId, toId: EntityId, rel: Relationship): void {
    this.ensureEntity(fromId);
    this.ensureEntity(toId);

    const out = this.outgoing.get(fromId)!;
    const alreadyExists = out.some(
      (e) => e.to === toId && e.rel.kind === rel.kind,
    );
    if (alreadyExists) return;

    const edge: Edge = { from: fromId, to: toId, rel };
    out.push(edge);
    this.incoming.get(toId)!.push(edge);
  }

  getEntity(id: EntityId): EntityNode | undefined {
    return this.nodes.get(id);
  }

  entitiesOfType(t: EntityType): EntityNode[] {
    return [...this.nodes.values()].filter((n) => n.entityType === t);
  }

  /** Entities this one directly affects (outgoing edges). */
  affectedBy(id: EntityId): Array<[EntityNode, Relationship]> {
    const out = this.outgoing.get(id);
    if (!out) return [];
    return out.map(
      (e) => [this.nodes.get(e.to)!, e.rel] as [EntityNode, Relationship],
    );
  }

  /** Entities that directly affect this one (incoming edges). */
  driversOf(id: EntityId): Array<[EntityNode, Relationship]> {
    const inc = this.incoming.get(id);
    if (!inc) return [];
    return inc.map(
      (e) => [this.nodes.get(e.from)!, e.rel] as [EntityNode, Relationship],
    );
  }

  /** BFS: entities reachable within `maxHops` from `id` (excludes the start). */
  reachable(id: EntityId, maxHops: number): EntityNode[] {
    if (!this.nodes.has(id)) return [];
    const visited = new Set<EntityId>([id]);
    let frontier: EntityId[] = [id];
    const result: EntityNode[] = [];

    for (let hop = 0; hop < maxHops; hop++) {
      const next: EntityId[] = [];
      for (const cur of frontier) {
        for (const e of this.outgoing.get(cur) ?? []) {
          if (visited.has(e.to)) continue;
          visited.add(e.to);
          result.push(this.nodes.get(e.to)!);
          next.push(e.to);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return result;
  }

  entityCount(): number {
    return this.nodes.size;
  }

  relationshipCount(): number {
    let n = 0;
    for (const edges of this.outgoing.values()) n += edges.length;
    return n;
  }

  /** Serialise to a plain object for persistence / TUI export. */
  toJSON(): {
    nodes: EntityNode[];
    edges: Array<{ from: EntityId; to: EntityId; relationship: Relationship }>;
  } {
    const edges: Array<{
      from: EntityId;
      to: EntityId;
      relationship: Relationship;
    }> = [];
    for (const list of this.outgoing.values()) {
      for (const e of list) {
        edges.push({ from: e.from, to: e.to, relationship: e.rel });
      }
    }
    return { nodes: [...this.nodes.values()], edges };
  }

  static fromJSON(data: {
    nodes: EntityNode[];
    edges: Array<{ from: EntityId; to: EntityId; relationship: Relationship }>;
  }): FinancialGraph {
    const g = new FinancialGraph();
    for (const node of data.nodes) g.upsertEntity(node);
    for (const edge of data.edges) {
      g.addRelationship(edge.from, edge.to, edge.relationship);
    }
    return g;
  }

  private ensureEntity(id: EntityId): void {
    if (this.nodes.has(id)) return;
    this.upsertEntity({
      id,
      name: id,
      entityType: "company",
      metadata: {},
      sentiment: 0,
      lastUpdatedMs: Date.now(),
    });
  }
}

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
