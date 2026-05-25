import { getGordon } from "../../src/infra/agents/definitions/gordon.ts"; 
const agent = getGordon() as any;
const tools = await agent.listTools();
const items = Array.isArray(tools) ? tools : Object.entries(tools).map(([k, v]: any) => ({ id: v?.id ?? k }));
const ids = items.map((t: any) => String(t.id ?? ""));
const diagnosticNames = ["compute_effective_n", "compute_kalman_beta", "compute_bootstrap", "compute_aggression_ratio", "compute_market_profile"];
console.log("Diagnostics in Gordon:", diagnosticNames.filter(d => ids.includes(d)).join(", ") || "NONE");
const mcpCount = ids.filter(id => id.startsWith("mcp")).length;
console.log("MCP-prefixed tools:", mcpCount);
