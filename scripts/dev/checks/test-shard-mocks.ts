import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= "true";
const { parseSync } = await import("@babel/core");

interface AstNode {
  type: string;
  [key: string]: unknown;
}

function isAstNode(value: unknown): value is AstNode {
  return Boolean(value && typeof value === "object" && "type" in value);
}

function statements(source: string, fileName: string): AstNode[] {
  const parsed = parseSync(source, {
    filename: fileName,
    parserOpts: { sourceType: "module", plugins: ["typescript"] },
  }) as unknown as { program?: { body?: unknown[] } } | null;
  return (parsed?.program?.body ?? []).filter(isAstNode);
}

function identifierName(value: unknown): string | null {
  if (!isAstNode(value) || value.type !== "Identifier") return null;
  return typeof value.name === "string" ? value.name : null;
}

function stringValue(value: unknown): string | null {
  if (!isAstNode(value) || value.type !== "StringLiteral") return null;
  return typeof value.value === "string" ? value.value : null;
}

function visit(node: AstNode, callback: (candidate: AstNode) => void): void {
  callback(node);
  for (const value of Object.values(node)) {
    if (isAstNode(value)) visit(value, callback);
    else if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) visit(item, callback);
    }
  }
}

export function sourceUsesBunModuleMock(source: string, fileName = "fixture.ts"): boolean {
  const body = statements(source, fileName);
  const mockBindings = new Set<string>();
  const bunTestNamespaces = new Set<string>();

  for (const statement of body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      stringValue(statement.source) !== "bun:test"
    ) {
      continue;
    }
    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      if (!isAstNode(specifier) || specifier.importKind === "type") continue;
      if (specifier.type === "ImportNamespaceSpecifier") {
        const local = identifierName(specifier.local);
        if (local) bunTestNamespaces.add(local);
      }
      if (specifier.type === "ImportSpecifier" && identifierName(specifier.imported) === "mock") {
        const local = identifierName(specifier.local);
        if (local) mockBindings.add(local);
      }
    }
  }

  let found = false;
  for (const statement of body) {
    visit(statement, (node) => {
      if (found || node.type !== "CallExpression" || !isAstNode(node.callee)) return;
      const moduleAccess = node.callee;
      if (
        moduleAccess.type !== "MemberExpression" ||
        moduleAccess.computed === true ||
        identifierName(moduleAccess.property) !== "module" ||
        !isAstNode(moduleAccess.object)
      ) {
        return;
      }
      const receiver = moduleAccess.object;
      const direct = identifierName(receiver);
      if (direct && mockBindings.has(direct)) {
        found = true;
        return;
      }
      if (
        receiver.type === "MemberExpression" &&
        receiver.computed !== true &&
        identifierName(receiver.property) === "mock" &&
        isAstNode(receiver.object)
      ) {
        const namespace = identifierName(receiver.object);
        if (namespace && bunTestNamespaces.has(namespace)) found = true;
      }
    });
    if (found) break;
  }
  return found;
}

function runtimeRelativeImports(source: string, fileName: string): string[] {
  const imports: string[] = [];
  for (const statement of statements(source, fileName)) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue;
      const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];
      if (
        specifiers.length > 0 &&
        specifiers.every((specifier) => isAstNode(specifier) && specifier.importKind === "type")
      ) {
        continue;
      }
      const sourceValue = stringValue(statement.source);
      if (sourceValue) imports.push(sourceValue);
      continue;
    }
    if (
      (statement.type === "ExportNamedDeclaration" || statement.type === "ExportAllDeclaration") &&
      statement.exportKind !== "type"
    ) {
      const sourceValue = stringValue(statement.source);
      if (sourceValue) imports.push(sourceValue);
    }
  }
  return imports.filter((specifier) => specifier.startsWith("."));
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
    if (
      existsSync(candidate) &&
      [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(candidate))
    ) {
      return candidate;
    }
  }
  return null;
}

/** Return the first reachable local module that can install a process-wide Bun mock. */
export function findReachableBunModuleMock(entryPath: string): string | null {
  const visited = new Set<string>();
  const visit = (path: string): string | null => {
    if (visited.has(path)) return null;
    visited.add(path);
    const source = readFileSync(path, "utf8");
    if (sourceUsesBunModuleMock(source, path)) return path;
    for (const specifier of runtimeRelativeImports(source, path)) {
      const dependency = resolveLocalModule(path, specifier);
      if (!dependency) continue;
      const found = visit(dependency);
      if (found) return found;
    }
    return null;
  };
  return visit(resolve(entryPath));
}
