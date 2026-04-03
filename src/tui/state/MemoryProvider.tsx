/**
 * MemoryProvider — Persistent memory context backed by ~/.gordon/memory/
 *
 * Loads markdown files with YAML frontmatter from the memory directory on mount.
 * Four memory types: user (preferences), feedback (trade learnings),
 * project (active strategies), reference (market knowledge).
 *
 * Phase 18 of the TUI rebuild plan.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  /** Filename without extension */
  name: string;
  /** Human-readable description from frontmatter */
  description: string;
  /** Memory classification */
  type: MemoryType;
  /** Raw markdown body (after frontmatter) */
  content: string;
  /** ISO timestamp of last modification */
  lastModified: string;
  /** Full file path on disk */
  filePath: string;
}

export interface MemoryContextValue {
  /** All loaded memory entries */
  memories: MemoryEntry[];
  /** Whether initial load is in progress */
  loading: boolean;
  /** Last error encountered, if any */
  error: string | null;
  /** Reload all memory files from disk */
  loadMemories: () => Promise<void>;
  /** Save (create or overwrite) a memory file */
  saveMemory: (type: MemoryType, name: string, content: string, description?: string) => Promise<void>;
  /** List memories, optionally filtered by type */
  listMemories: (type?: MemoryType) => MemoryEntry[];
  /** Get a single memory by name */
  getMemory: (name: string) => MemoryEntry | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const MEMORY_DIR = path.join(os.homedir(), ".gordon", "memory");

const VALID_TYPES: ReadonlySet<string> = new Set<MemoryType>([
  "user",
  "feedback",
  "project",
  "reference",
]);

// ============================================================================
// Frontmatter helpers
// ============================================================================

interface Frontmatter {
  name: string;
  description: string;
  type: MemoryType;
}

/**
 * Parse simple YAML frontmatter delimited by `---`.
 * Returns parsed fields and the body after frontmatter.
 */
function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const defaultMeta: Frontmatter = { name: "", description: "", type: "reference" };

  if (!raw.startsWith("---")) {
    return { meta: defaultMeta, body: raw };
  }

  const endIdx = raw.indexOf("---", 3);
  if (endIdx === -1) {
    return { meta: defaultMeta, body: raw };
  }

  const yamlBlock = raw.slice(3, endIdx).trim();
  const body = raw.slice(endIdx + 3).trim();

  const meta: Frontmatter = { ...defaultMeta };
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") meta.name = value;
    else if (key === "description") meta.description = value;
    else if (key === "type" && VALID_TYPES.has(value)) meta.type = value as MemoryType;
  }

  return { meta, body };
}

/**
 * Serialize frontmatter + body into a markdown string.
 */
function serializeFrontmatter(
  name: string,
  description: string,
  type: MemoryType,
  body: string,
): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `type: ${type}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/**
 * Sanitise a name into a safe filename slug.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// ============================================================================
// Context
// ============================================================================

const MemoryContext = createContext<MemoryContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface Props {
  children: ReactNode;
}

export function MemoryProvider({ children }: Props) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Ensure directory exists ──
  const ensureDir = useCallback(async () => {
    try {
      await fs.mkdir(MEMORY_DIR, { recursive: true });
    } catch {
      // ignore — mkdir recursive won't throw if it already exists
    }
  }, []);

  // ── Load all memory files ──
  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await ensureDir();

      let files: string[];
      try {
        files = await fs.readdir(MEMORY_DIR);
      } catch {
        files = [];
      }

      const mdFiles = files.filter((f) => f.endsWith(".md"));
      const entries: MemoryEntry[] = [];

      for (const file of mdFiles) {
        const filePath = path.join(MEMORY_DIR, file);
        try {
          const raw = await fs.readFile(filePath, "utf-8");
          const stat = await fs.stat(filePath);
          const { meta, body } = parseFrontmatter(raw);

          entries.push({
            name: meta.name || file.replace(/\.md$/, ""),
            description: meta.description,
            type: meta.type,
            content: body,
            lastModified: stat.mtime.toISOString(),
            filePath,
          });
        } catch {
          // Skip unreadable files
        }
      }

      // Sort by last modified descending
      entries.sort(
        (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
      );
      setMemories(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ensureDir]);

  // ── Save a memory file ──
  const saveMemory = useCallback(
    async (type: MemoryType, name: string, content: string, description?: string) => {
      try {
        await ensureDir();
        const slug = slugify(name);
        const filePath = path.join(MEMORY_DIR, `${slug}.md`);
        const markdown = serializeFrontmatter(
          name,
          description ?? "",
          type,
          content,
        );
        await fs.writeFile(filePath, markdown, "utf-8");

        // Reload to pick up changes
        await loadMemories();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [ensureDir, loadMemories],
  );

  // ── List memories (optionally by type) ──
  const listMemories = useCallback(
    (type?: MemoryType): MemoryEntry[] => {
      if (!type) return memories;
      return memories.filter((m) => m.type === type);
    },
    [memories],
  );

  // ── Get a single memory by name ──
  const getMemory = useCallback(
    (name: string): MemoryEntry | undefined => {
      const lower = name.toLowerCase();
      return memories.find(
        (m) =>
          m.name.toLowerCase() === lower ||
          slugify(m.name) === slugify(name),
      );
    },
    [memories],
  );

  // ── Load on mount ──
  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  // ── Context value ──
  const value = useMemo<MemoryContextValue>(
    () => ({
      memories,
      loading,
      error,
      loadMemories,
      saveMemory,
      listMemories,
      getMemory,
    }),
    [memories, loading, error, loadMemories, saveMemory, listMemories, getMemory],
  );

  return (
    <MemoryContext.Provider value={value}>
      {children}
    </MemoryContext.Provider>
  );
}

// ============================================================================
// useMemory — Access memory context
// ============================================================================

export function useMemory(): MemoryContextValue {
  const ctx = useContext(MemoryContext);
  if (!ctx) {
    throw new Error("useMemory must be used within <MemoryProvider>");
  }
  return ctx;
}
