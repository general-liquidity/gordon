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

export function deriveJobBunVersionFromSource(workflow: string, jobName: string): string {
  const lines = workflow.split(/\r?\n/);
  const header = `  ${jobName}:`;
  const start = lines.indexOf(header);
  if (start === -1) throw new Error(`Workflow has no '${jobName}' job`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index]!)) {
      end = index;
      break;
    }
  }

  const versions = lines.slice(start + 1, end).flatMap((line) => {
    const match = /^\s+bun-version:\s*(\S+)\s*$/.exec(line);
    return match?.[1] ? [match[1]] : [];
  });
  if (versions.length !== 1) {
    throw new Error(
      `Workflow job '${jobName}' must pin exactly one Bun version; found ${versions.length}`,
    );
  }
  return versions[0]!;
}

export function deriveJobBunVersion(workflowPath: string, jobName: string): string {
  return deriveJobBunVersionFromSource(readFileSync(workflowPath, "utf8"), jobName);
}

export function assertGordonVersionOutput(output: string, expectedVersion: string): void {
  const expected = `gordon v${expectedVersion}`;
  if (output.trim() !== expected) {
    throw new Error(
      `Host release binary reported ${JSON.stringify(output.trim())}; expected ${expected}`,
    );
  }
}
