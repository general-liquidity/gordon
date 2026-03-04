import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_TEMPLATE,
  STRATEGY_TEMPLATE,
  PACKAGE_JSON_TEMPLATE,
  TSCONFIG_TEMPLATE,
  ENV_EXAMPLE_TEMPLATE,
} from "./templates/index.ts";

export type ScaffoldTemplate = "agent" | "strategy";
export type PackageManager = "bun" | "npm";

export interface ScaffoldOptions {
  name: string;
  template: ScaffoldTemplate;
  packageManager: PackageManager;
}

function applyTokens(content: string, options: ScaffoldOptions): string {
  const runCmd = options.packageManager === "bun" ? "bun run" : "npx tsx";
  return content
    .replace(/\{\{PROJECT_NAME\}\}/g, options.name)
    .replace(/\{\{RUN_CMD\}\}/g, runCmd);
}

export async function scaffoldProject(targetDir: string, options: ScaffoldOptions): Promise<string[]> {
  const srcDir = join(targetDir, "src");
  await mkdir(srcDir, { recursive: true });

  const sourceTemplate = options.template === "agent" ? AGENT_TEMPLATE : STRATEGY_TEMPLATE;

  const files: Array<{ path: string; content: string }> = [
    { path: join(srcDir, "index.ts"), content: applyTokens(sourceTemplate, options) },
    { path: join(targetDir, "package.json"), content: applyTokens(PACKAGE_JSON_TEMPLATE, options) },
    { path: join(targetDir, "tsconfig.json"), content: applyTokens(TSCONFIG_TEMPLATE, options) },
    { path: join(targetDir, ".env.example"), content: applyTokens(ENV_EXAMPLE_TEMPLATE, options) },
  ];

  const created: string[] = [];
  for (const file of files) {
    await writeFile(file.path, file.content, "utf-8");
    created.push(file.path);
  }

  return created;
}
