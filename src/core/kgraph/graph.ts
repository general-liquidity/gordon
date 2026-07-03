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

