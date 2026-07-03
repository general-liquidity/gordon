import { describe, expect, test } from "bun:test";
import { FinancialGraph, seedGraph } from "./graph.ts";
import { ImpactEngine } from "./impact.ts";
import { GraphQueryEngine, toPromptBlock } from "./query.ts";
import {
  mergeOntology,
  validateOntology,
  buildGraphFromCorrelations,
  type Ontology,
} from "./ontology.ts";

describe("FinancialGraph", () => {
  test("seed graph has expected entities and relationships", () => {
    const g = seedGraph();
    expect(g.entityCount()).toBeGreaterThan(20);
    expect(g.relationshipCount()).toBeGreaterThan(20);

    const targets = g.affectedBy("TSMC").map(([e]) => e.id);
    expect(targets).toContain("NVIDIA");
  });

  test("relationships are directional", () => {
    const g = seedGraph();
    // Supplies edge points TSMC -> NVIDIA, not the reverse.
    const drivers = g.driversOf("NVIDIA");
    const supplierIds = drivers.map(([e]) => e.id);
    expect(supplierIds).toContain("TSMC");
    const tsmcEdge = drivers.find(([e]) => e.id === "TSMC");
    expect(tsmcEdge?.[1].kind).toBe("supplies");
  });

  test("duplicate edges of the same kind are ignored", () => {
    const g = new FinancialGraph();
    const rel = {
      kind: "supplies" as const,
      weight: 0.9,
      description: "x",
      source: "test",
    };
    g.addRelationship("A", "B", rel);
    g.addRelationship("A", "B", rel);
    expect(g.relationshipCount()).toBe(1);
  });

  test("serialisation round-trips", () => {
    const g = seedGraph();
    const json = g.toJSON();
    const g2 = FinancialGraph.fromJSON(json);
    expect(g2.entityCount()).toBe(g.entityCount());
    expect(g2.relationshipCount()).toBe(g.relationshipCount());
  });

  test("reachable finds transitive nodes", () => {
    const g = seedGraph();
    const ids = g.reachable("FED_FUNDS_RATE", 2).map((e) => e.id);
    expect(ids.includes("NASDAQ") || ids.includes("TREASURY_10Y")).toBe(true);
  });

  test("reachable on unknown node is empty", () => {
    const g = seedGraph();
    expect(g.reachable("DOES_NOT_EXIST", 3)).toEqual([]);
  });
});

describe("ImpactEngine — contagion", () => {
  test("oil shock hits airlines negatively with expected magnitude", () => {
    const g = seedGraph();
    const engine = new ImpactEngine(g);
    const scores = engine.propagateShock("OIL_WTI", 0.2, 2);
    const airlines = scores.find((s) => s.targetId === "AIRLINES");
    expect(airlines).toBeDefined();
    // Oil up should be bearish for airlines (Affects sign = -1.0).
    expect(airlines!.score).toBeLessThan(0);
    // Magnitude attenuates by hop weight: 0.20 * 0.88 = 0.176.
    expect(Math.abs(airlines!.score) - 0.2 * 0.88).toBeLessThan(1e-9);
  });

  test("impact path records the correct route", () => {
    const g = seedGraph();
    const engine = new ImpactEngine(g);
    const scores = engine.propagateShock("OIL_WTI", 0.2, 2);
    const airlines = scores.find((s) => s.targetId === "AIRLINES")!;
    expect(airlines.path.steps.length).toBe(1);
    expect(airlines.path.steps[0]!.from).toBe("OIL_WTI");
    expect(airlines.path.steps[0]!.to).toBe("AIRLINES");
  });

  test("deeper hop attenuates further", () => {
    const g = seedGraph();
    const engine = new ImpactEngine(g);
    // FED_FUNDS_RATE -> TREASURY_10Y (hop 1) -> SP500 (hop 2).
    const scores = engine.propagateShock("FED_FUNDS_RATE", 0.5, 3);
    const t10 = scores.find((s) => s.targetId === "TREASURY_10Y")!;
    const sp = scores.find((s) => s.targetId === "SP500")!;
    expect(Math.abs(sp.score)).toBeLessThan(Math.abs(t10.score));
    expect(sp.confidence).toBeLessThan(t10.confidence);
  });

  test("results are ranked by absolute impact magnitude", () => {
    const g = seedGraph();
    const engine = new ImpactEngine(g);
    const scores = engine.propagateShock("FED_FUNDS_RATE", 0.5, 3);
    for (let i = 1; i < scores.length; i++) {
      expect(Math.abs(scores[i - 1]!.score)).toBeGreaterThanOrEqual(
        Math.abs(scores[i]!.score),
      );
    }
  });

  test("disconnected source yields no impact", () => {
    const g = new FinancialGraph();
    g.upsertEntity({
      id: "ISOLATED",
      name: "Isolated",
      entityType: "company",
      metadata: {},
      sentiment: 0,
      lastUpdatedMs: 0,
    });
    const engine = new ImpactEngine(g);
    expect(engine.propagateShock("ISOLATED", 0.5, 3)).toEqual([]);
  });

  test("unknown source yields no impact", () => {
    const g = seedGraph();
    const engine = new ImpactEngine(g);
    expect(engine.propagateShock("NOPE", 0.5, 3)).toEqual([]);
  });

  test("impact table renders a string", () => {
    const g = seedGraph();
    const engine = new ImpactEngine(g);
    const table = engine.impactTable("FED_FUNDS_RATE", 0.75, 5);
    expect(
      table.includes("FED_FUNDS_RATE") || table.includes("Fed Funds Rate"),
    ).toBe(true);
  });
});

describe("GraphQueryEngine", () => {
  test("supply chain query finds TSMC for NVIDIA", () => {
    const g = seedGraph();
    const engine = new GraphQueryEngine(g);
    const ctx = engine.execute({ type: "supply_chain", downstreamId: "NVIDIA" });
    expect(ctx.entities.some((e) => e.id === "TSMC")).toBe(true);
    expect(ctx.facts.some((f) => f.includes("TSMC"))).toBe(true);
    expect(ctx.queryDescription).toBe("Supply chain for NVIDIA");
  });

  test("sector exposure flags airlines bearish to oil", () => {
    const g = seedGraph();
    const engine = new GraphQueryEngine(g);
    const ctx = engine.execute({ type: "sector_exposure", riskFactorId: "OIL_WTI" });
    expect(
      ctx.facts.some((f) => f.includes("Airlines") && f.includes("bearish")),
    ).toBe(true);
  });

  test("entity summary of unknown entity reports not found", () => {
    const g = seedGraph();
    const engine = new GraphQueryEngine(g);
    const ctx = engine.execute({ type: "entity_summary", entityId: "GHOST" });
    expect(ctx.facts[0]).toContain("not found");
  });

  test("full context for symbol renders a prompt block", () => {
    const g = seedGraph();
    const engine = new GraphQueryEngine(g);
    const ctx = engine.execute({ type: "full_context_for_symbol", symbol: "NVIDIA" });
    const block = toPromptBlock(ctx);
    expect(block).toContain("KNOWLEDGE GRAPH");
    expect(block).toContain("NVIDIA");
  });
});

describe("ontology loading", () => {
  const sampleOntology = (): Ontology => ({
    sourceDocument: "test_doc.md",
    entities: [
      {
        id: "OPENAI",
        name: "OpenAI",
        entityType: "Company",
        sector: "Technology",
        country: "USA",
        description: "AI research lab",
      },
      {
        id: "MICROSOFT",
        name: "Microsoft Corporation",
        entityType: "Company",
        ticker: "MSFT",
        sector: "Technology",
        country: "USA",
        description: "Cloud and software giant",
      },
    ],
    edges: [
      {
        fromId: "MICROSOFT",
        toId: "OPENAI",
        relationship: "Owns",
        weight: 0.49,
        description: "Microsoft has invested heavily in OpenAI",
      },
    ],
    extractionConfidence: 0.92,
    summary: "Describes Microsoft's investment in OpenAI",
  });

  test("ontology merges into graph", () => {
    const g = new FinancialGraph();
    mergeOntology(sampleOntology(), g);
    expect(g.entityCount()).toBe(2);
    expect(g.relationshipCount()).toBe(1);
    expect(g.getEntity("OPENAI")).toBeDefined();
  });

  test("validate catches a dangling edge", () => {
    const ont = sampleOntology();
    ont.edges.push({
      fromId: "NONEXISTENT",
      toId: "OPENAI",
      relationship: "Affects",
      weight: 0.5,
      description: "dangling",
    });
    expect(validateOntology(ont).length).toBeGreaterThan(0);
  });
});

describe("buildGraphFromCorrelations — data-derived seeding", () => {
  test("emits correlation edges above threshold and sector membership", () => {
    // Structure derived from a matrix, not a hardcoded symbol list.
    const g = buildGraphFromCorrelations({
      symbols: ["AAA", "BBB", "CCC"],
      matrix: [
        [1.0, 0.8, 0.1],
        [0.8, 1.0, 0.2],
        [0.1, 0.2, 1.0],
      ],
      sectors: { AAA: "TECH", BBB: "TECH" },
      minAbsCorrelation: 0.5,
    });

    // AAA <-> BBB correlate (0.8 >= 0.5); AAA-CCC (0.1) and BBB-CCC (0.2) do not.
    const engine = new GraphQueryEngine(g);
    const corr = engine.execute({ type: "correlations", entityId: "AAA", minWeight: 0.5 });
    expect(corr.facts.some((f) => f.includes("BBB"))).toBe(true);
    expect(corr.facts.some((f) => f.includes("CCC"))).toBe(false);

    // Sector membership present for tagged symbols.
    const aaa = engine.execute({ type: "entity_summary", entityId: "AAA" });
    expect(aaa.facts.some((f) => f.includes("TECH"))).toBe(true);

    // A shock to a correlated name should propagate to its correlate.
    const scores = new ImpactEngine(g).propagateShock("AAA", 0.3, 2);
    expect(scores.some((s) => s.targetId === "BBB")).toBe(true);
  });

  test("empty matrix yields a graph with no edges", () => {
    const g = buildGraphFromCorrelations({ symbols: [], matrix: [] });
    expect(g.entityCount()).toBe(0);
    expect(g.relationshipCount()).toBe(0);
  });
});
