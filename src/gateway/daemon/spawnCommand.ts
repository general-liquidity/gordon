import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function findSourceLauncher(scriptPath: string): string {
  let cursor = dirname(resolve(scriptPath));
  for (let depth = 0; depth < 4; depth++) {
    const candidate = resolve(cursor, "bin", "gordon.cjs");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error("Cannot locate bin/gordon.cjs for the daemon child process.");
}

export function resolveDaemonSpawnCommand(
  argv: string[] = process.argv,
  execPath: string = process.execPath,
): { command: string; args: string[] } {
  const scriptPath = argv[1];
  if (scriptPath && /\.[cm]?[jt]sx?$/i.test(scriptPath)) {
    return {
      command: "node",
      args: [findSourceLauncher(scriptPath), "daemon", "run"],
    };
  }
  return { command: execPath, args: ["daemon", "run"] };
}
