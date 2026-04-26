/**
 * Schema sanity for the marketplace catalog. Catches malformed listings
 * (typos in `category`, missing required fields, duplicate ids) before
 * they reach `/mcp` and silently break discovery.
 */

import { describe, it, expect } from "bun:test";
import catalog from "./catalog.json" with { type: "json" };

interface CatalogPlugin {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: string;
  install?: string;
  endpoint?: string;
  credentials?: Array<{ env: string; required: boolean; description?: string }>;
  docsUrl?: string;
  pricing: string;
  pricingNote?: string;
  toolCount?: number;
}

interface CatalogShape {
  version: string;
  lastUpdated: string;
  categories: string[];
  plugins: CatalogPlugin[];
}

const cat = catalog as CatalogShape;

describe("marketplace catalog", () => {
  it("declares a versioned schema", () => {
    expect(typeof cat.version).toBe("string");
    expect(cat.categories.length).toBeGreaterThan(0);
  });

  it("has every plugin's category in the declared categories list", () => {
    const known = new Set(cat.categories);
    const offenders = cat.plugins.filter((p) => !known.has(p.category));
    expect(offenders.map((o) => `${o.id}:${o.category}`)).toEqual([]);
  });

  it("has unique plugin IDs", () => {
    const ids = cat.plugins.map((p) => p.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("requires id / name / description / transport / pricing on every plugin", () => {
    const missing: string[] = [];
    for (const p of cat.plugins) {
      if (!p.id) missing.push("missing id");
      if (!p.name) missing.push(`${p.id}: missing name`);
      if (!p.description) missing.push(`${p.id}: missing description`);
      if (!p.transport) missing.push(`${p.id}: missing transport`);
      if (!p.pricing) missing.push(`${p.id}: missing pricing`);
    }
    expect(missing).toEqual([]);
  });

  it("lists binance-skills-hub under research (the docs fetcher belongs here)", () => {
    const skills = cat.plugins.find((p) => p.id === "binance-skills-hub");
    expect(skills).toBeDefined();
    expect(skills?.category).toBe("research");
  });

  it("does NOT list binance-cli — that's a raw CLI, lives in src/infra/cli/registry.ts", () => {
    const cli = cat.plugins.find((p) => p.id === "binance-cli");
    expect(cli).toBeUndefined();
  });
});
