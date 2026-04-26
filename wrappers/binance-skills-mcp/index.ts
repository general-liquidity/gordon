#!/usr/bin/env bun
/**
 * @gordon/binance-skills-mcp
 *
 * Standalone MCP server that wraps the Binance Skills Hub
 * (github.com/binance/binance-skills-hub, MIT). Exposes two MCP tools:
 *
 *   - list_binance_skills:  fetch + cache the catalog of skill manifests
 *   - load_binance_skill:   fetch + cache a specific skill's body
 *
 * Cached locally to ~/.gordon/binance-skills/ (or
 * $GORDON_BINANCE_SKILLS_CACHE if set) so subsequent calls work offline.
 *
 * Discovery is via Gordon's MCP marketplace
 * (src/infra/ai/mcp/marketplace/catalog.json :: 'binance-skills-hub').
 * Install: `npx -y @gordon/binance-skills-mcp` once published, or run
 * directly via `bun run wrappers/binance-skills-mcp/index.ts` for local
 * development.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const SKILLS_REPO = "binance/binance-skills-hub";
const RAW_BASE = `https://raw.githubusercontent.com/${SKILLS_REPO}/main`;
const TREE_API = `https://api.github.com/repos/${SKILLS_REPO}/git/trees/main?recursive=1`;
const CACHE_DIR =
  process.env.GORDON_BINANCE_SKILLS_CACHE ?? join(homedir(), ".gordon", "binance-skills");
const CATALOG_TTL_MS = 24 * 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 8_000;

interface CatalogEntry {
  name: string;
  scope: string;
  path: string;
  description?: string;
  version?: string;
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseFrontmatter(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body.startsWith("---")) return out;
  const end = body.indexOf("\n---", 3);
  if (end < 0) return out;
  for (const line of body.slice(3, end).split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v && v !== "|" && v !== ">") out[m[1]!] = v;
  }
  return out;
}

async function loadCatalog(refresh = false): Promise<CatalogEntry[]> {
  ensureCacheDir();
  const path = join(CACHE_DIR, "_catalog.json");
  if (!refresh && existsSync(path)) {
    try {
      const cached = JSON.parse(readFileSync(path, "utf8")) as {
        fetchedAt: number;
        entries: CatalogEntry[];
      };
      if (Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.entries;
    } catch {
      /* fall through */
    }
  }
  const tree = JSON.parse(await fetchText(TREE_API)) as {
    tree?: Array<{ path: string; type: string }>;
  };
  const skillFiles =
    tree.tree?.filter((n) => n.type === "blob" && n.path.endsWith("/SKILL.md")).map((n) => n.path) ??
    [];
  const entries: CatalogEntry[] = [];
  for (const p of skillFiles) {
    const parts = p.split("/");
    if (parts.length < 4) continue;
    const scope = parts[1]!;
    const name = parts[parts.length - 2]!;
    let description: string | undefined;
    let version: string | undefined;
    try {
      const body = await fetchText(`${RAW_BASE}/${p}`);
      const fm = parseFrontmatter(body);
      description = fm.description;
      version = fm.version;
      const local = join(CACHE_DIR, scope, `${name}.md`);
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, body, "utf8");
    } catch {
      /* skip body but keep the entry */
    }
    entries.push({ name, scope, path: p, description, version });
  }
  writeFileSync(path, JSON.stringify({ fetchedAt: Date.now(), entries }, null, 2), "utf8");
  return entries;
}

async function loadSkillBody(scope: string, name: string, refresh = false): Promise<string> {
  ensureCacheDir();
  const local = join(CACHE_DIR, scope, `${name}.md`);
  if (!refresh && existsSync(local)) return readFileSync(local, "utf8");
  const body = await fetchText(`${RAW_BASE}/skills/${scope}/${name}/SKILL.md`);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, body, "utf8");
  return body;
}

// ---- MCP server -----------------------------------------------------------

const server = new Server(
  { name: "binance-skills-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_binance_skills",
      description:
        "List skills published in the official Binance Skills Hub. Each entry " +
        "has a name, scope (binance / binance-web3), and short description.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["all", "binance", "binance-web3"],
            description:
              "'binance' = CEX product skills. 'binance-web3' = on-chain skills " +
              "(smart money signals, token info, etc). 'all' (default) = both.",
          },
          refresh: {
            type: "boolean",
            description: "Force a remote fetch instead of using the 24h cache.",
          },
        },
      },
    },
    {
      name: "load_binance_skill",
      description:
        "Fetch the full body of a Binance Skills Hub skill manifest. Returns " +
        "the markdown including API endpoints, request shapes, examples.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Skill slug (e.g. 'trading-signal', 'spot')" },
          scope: { type: "string", enum: ["binance", "binance-web3"] },
          refresh: { type: "boolean" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "list_binance_skills") {
      const a = (args ?? {}) as { scope?: "all" | "binance" | "binance-web3"; refresh?: boolean };
      const all = await loadCatalog(a.refresh ?? false);
      const filtered = !a.scope || a.scope === "all" ? all : all.filter((e) => e.scope === a.scope);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              filtered.map(({ name, scope, description, version }) => ({
                name,
                scope,
                description,
                version,
              })),
              null,
              2,
            ),
          },
        ],
      };
    }
    if (name === "load_binance_skill") {
      const a = (args ?? {}) as {
        name: string;
        scope?: "binance" | "binance-web3";
        refresh?: boolean;
      };
      const order: Array<"binance-web3" | "binance"> = a.scope ? [a.scope] : ["binance-web3", "binance"];
      let lastErr: string | undefined;
      for (const s of order) {
        try {
          const body = await loadSkillBody(s, a.name, a.refresh ?? false);
          return { content: [{ type: "text", text: body }] };
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      throw new Error(lastErr ?? `Skill '${a.name}' not found`);
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (e) {
    return {
      content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
