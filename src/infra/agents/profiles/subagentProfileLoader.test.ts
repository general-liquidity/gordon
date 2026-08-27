import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadSubagentProfiles, summarizeLoadedSubagentProfiles } from "./subagentProfileLoader.ts";

function makeFileMap(entries: Record<string, string>): {
  fileContent: Map<string, string>;
  directoryListing: Map<string, string[]>;
} {
  const fileContent = new Map<string, string>();
  const dirs = new Map<string, string[]>();
  for (const [path, content] of Object.entries(entries)) {
    fileContent.set(path, content);
    const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const dir = path.substring(0, lastSlash);
    const file = path.substring(lastSlash + 1);
    const list = dirs.get(dir) ?? [];
    if (!list.includes(file)) list.push(file);
    dirs.set(dir, list);
  }
  return { fileContent, directoryListing: dirs };
}

function validProfileJson(name: string): string {
  return JSON.stringify({
    name,
    description: "test profile",
    instructions: "test instructions",
    tools: ["scan_market"],
  });
}

const PROJECT_DIR = join("/proj", ".claude", "subagents");
const USER_DIR = join("/home", "user", ".claude", "subagents");

describe("FW7 — loadSubagentProfiles", () => {
  test("missing directories return empty result", () => {
    const result = loadSubagentProfiles({
      sources: [
        { path: PROJECT_DIR, origin: "project" },
        { path: USER_DIR, origin: "user" },
      ],
      directoryListing: new Map(),
    });
    expect(result.profiles.size).toBe(0);
    expect(result.totalAccepted).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  test("loads a single project profile", () => {
    const { fileContent, directoryListing } = makeFileMap({
      [join(PROJECT_DIR, "analyst.json")]: validProfileJson("analyst"),
    });
    const result = loadSubagentProfiles({
      sources: [{ path: PROJECT_DIR, origin: "project" }],
      fileContent,
      directoryListing,
    });
    expect(result.profiles.size).toBe(1);
    expect(result.profiles.get("analyst")?.name).toBe("analyst");
    expect(result.totalAccepted).toBe(1);
  });

  test("project profile wins over user profile on name conflict", () => {
    const { fileContent, directoryListing } = makeFileMap({
      [join(PROJECT_DIR, "analyst.json")]: JSON.stringify({
        name: "analyst",
        description: "from project",
        instructions: "project instr",
        tools: ["scan_market"],
      }),
      [join(USER_DIR, "analyst.json")]: JSON.stringify({
        name: "analyst",
        description: "from user",
        instructions: "user instr",
        tools: ["list_skills"],
      }),
    });
    const result = loadSubagentProfiles({
      sources: [
        { path: PROJECT_DIR, origin: "project" },
        { path: USER_DIR, origin: "user" },
      ],
      fileContent,
      directoryListing,
    });
    expect(result.profiles.get("analyst")?.description).toBe("from project");
    expect(result.totalAccepted).toBe(1);
    expect(result.totalRejected).toBe(1);
    expect(result.warnings.some((w) => w.includes("dropped"))).toBe(true);
  });

  test("filename basename mismatch with name is rejected", () => {
    const { fileContent, directoryListing } = makeFileMap({
      [join(PROJECT_DIR, "wrong-filename.json")]: validProfileJson("analyst"),
    });
    const result = loadSubagentProfiles({
      sources: [{ path: PROJECT_DIR, origin: "project" }],
      fileContent,
      directoryListing,
    });
    expect(result.profiles.size).toBe(0);
    expect(result.totalRejected).toBe(1);
    expect(result.warnings.some((w) => w.includes("does not match"))).toBe(true);
  });

  test("malformed JSON is warned, others still load", () => {
    const { fileContent, directoryListing } = makeFileMap({
      [join(PROJECT_DIR, "broken.json")]: "{not valid json",
      [join(PROJECT_DIR, "analyst.json")]: validProfileJson("analyst"),
    });
    const result = loadSubagentProfiles({
      sources: [{ path: PROJECT_DIR, origin: "project" }],
      fileContent,
      directoryListing,
    });
    expect(result.profiles.size).toBe(1);
    expect(result.totalRejected).toBe(1);
    expect(result.warnings.some((w) => w.includes("Malformed JSON"))).toBe(true);
  });

  test("schema-invalid profile is rejected with field-level warning", () => {
    const { fileContent, directoryListing } = makeFileMap({
      [join(PROJECT_DIR, "bad-tools.json")]: JSON.stringify({
        name: "bad-tools",
        description: "x",
        instructions: "x",
        tools: "not-an-array",
      }),
    });
    const result = loadSubagentProfiles({
      sources: [{ path: PROJECT_DIR, origin: "project" }],
      fileContent,
      directoryListing,
    });
    expect(result.profiles.size).toBe(0);
    expect(result.warnings.some((w) => w.includes("Invalid profile"))).toBe(true);
  });

  test("non-.json files are ignored in directory listing", () => {
    const dirList = new Map<string, string[]>();
    dirList.set(PROJECT_DIR, ["analyst.json", "readme.md", "config.yaml"]);
    const fileContent = new Map<string, string>();
    fileContent.set(join(PROJECT_DIR, "analyst.json"), validProfileJson("analyst"));

    const result = loadSubagentProfiles({
      sources: [{ path: PROJECT_DIR, origin: "project" }],
      fileContent,
      directoryListing: dirList,
    });
    expect(result.profiles.size).toBe(1);
    expect(result.sources[0]!.fileCount).toBe(1);
  });

  test("perSource breakdown is accurate", () => {
    const { fileContent, directoryListing } = makeFileMap({
      [join(PROJECT_DIR, "a.json")]: validProfileJson("a"),
      [join(PROJECT_DIR, "b.json")]: validProfileJson("b"),
      [join(USER_DIR, "c.json")]: validProfileJson("c"),
    });
    const result = loadSubagentProfiles({
      sources: [
        { path: PROJECT_DIR, origin: "project" },
        { path: USER_DIR, origin: "user" },
      ],
      fileContent,
      directoryListing,
    });
    expect(result.profiles.size).toBe(3);
    const proj = result.sources.find((s) => s.origin === "project")!;
    const user = result.sources.find((s) => s.origin === "user")!;
    expect(proj.accepted).toBe(2);
    expect(user.accepted).toBe(1);
  });

  test("model field warning passes through", () => {
    const { fileContent, directoryListing } = makeFileMap({
      [join(PROJECT_DIR, "analyst.json")]: JSON.stringify({
        name: "analyst",
        description: "x",
        instructions: "x",
        tools: ["scan_market"],
        model: ":bad-model",
      }),
    });
    const result = loadSubagentProfiles({
      sources: [{ path: PROJECT_DIR, origin: "project" }],
      fileContent,
      directoryListing,
    });
    expect(result.profiles.size).toBe(1);
    expect(result.warnings.some((w) => w.includes("model override"))).toBe(true);
  });
});

describe("summarizeLoadedSubagentProfiles", () => {
  test("zero profiles", () => {
    const summary = summarizeLoadedSubagentProfiles({
      profiles: new Map(),
      warnings: [],
      sources: [
        { path: "x", origin: "project", found: false, fileCount: 0, accepted: 0, rejected: 0 },
      ],
      totalAccepted: 0,
      totalRejected: 0,
    });
    expect(summary).toContain("0 profiles");
  });

  test("singular profile", () => {
    const summary = summarizeLoadedSubagentProfiles({
      profiles: new Map(),
      warnings: [],
      sources: [
        { path: "x", origin: "project", found: true, fileCount: 1, accepted: 1, rejected: 0 },
      ],
      totalAccepted: 1,
      totalRejected: 0,
    });
    expect(summary).toContain(": 1 profile.");
  });

  test("rendering warnings + drops", () => {
    const summary = summarizeLoadedSubagentProfiles({
      profiles: new Map(),
      warnings: ["x", "y"],
      sources: [
        { path: "x", origin: "project", found: true, fileCount: 5, accepted: 3, rejected: 2 },
      ],
      totalAccepted: 3,
      totalRejected: 2,
    });
    expect(summary).toContain("3 profiles");
    expect(summary).toContain("2 dropped");
    expect(summary).toContain("2 warnings");
  });
});
