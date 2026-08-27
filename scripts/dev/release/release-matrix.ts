import { readFileSync } from "node:fs";

export interface ReleaseBinaryTarget {
  name: string;
  bunTarget: string;
  binaryName: string;
}

export function deriveReleaseBinaryTargets(workflowPath: string): ReleaseBinaryTarget[] {
  const workflow = readFileSync(workflowPath, "utf8");
  return [
    ...workflow.matchAll(
      /- target:\s+([^\s]+)[\s\S]*?bun_target:\s+([^\s]+)[\s\S]*?binary_name:\s+([^\s]+)/g,
    ),
  ].map((match) => ({ name: match[1]!, bunTarget: match[2]!, binaryName: match[3]! }));
}

export function deriveReleaseTestShards(workflowPath: string): string[][] {
  const workflow = readFileSync(workflowPath, "utf8");
  return [...workflow.matchAll(/^\s+paths:\s+(.+)$/gm)].map(
    (match) => match[1]?.trim().split(/\s+/).filter(Boolean) ?? [],
  );
}

export function assertGordonVersionOutput(output: string, expectedVersion: string): void {
  const expected = `gordon v${expectedVersion}`;
  if (output.trim() !== expected) {
    throw new Error(
      `Host release binary reported ${JSON.stringify(output.trim())}; expected ${expected}`,
    );
  }
}
