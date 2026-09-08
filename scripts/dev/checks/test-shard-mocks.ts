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
  // `jsx` only for the extensions that can carry it. Adding it everywhere would
  // make `<T>value` in a .ts file parse as an unclosed element, and leaving it
  // off entirely threw on the first .tsx reached: resolveLocalModule accepts
  // .tsx and src/ holds hundreds of them, so the gate would have failed with a
  // Babel syntax error instead of a shard verdict.
  const jsx = extname(fileName) === ".tsx" || extname(fileName) === ".jsx";
  const parsed = parseSync(source, {
    filename: fileName,
    parserOpts: {
      sourceType: "module",
      plugins: jsx ? ["typescript", "jsx"] : ["typescript"],
    },
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

const BUN_TEST = "bun:test";

/**
 * Export names in `path` that are Bun's own `mock`, following re-export chains.
 *
 * A helper doing `export { mock } from "bun:test"` hands its importers the real
 * binding, so those importers can install a process-wide mock. Binding `mock`
 * only from a literal `"bun:test"` import left every one of them undetected and
 * free to sit in a real-store shard, which is the ordering hazard the shard
 * split exists to prevent.
 */
function bunTestMockExports(path: string | null, seen = new Set<string>()): Set<string> {
  const names = new Set<string>();
  if (!path || seen.has(path)) return names;
  seen.add(path);
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return names;
  }
  for (const statement of statements(source, path)) {
    if (statement.type !== "ExportNamedDeclaration" && statement.type !== "ExportAllDeclaration") {
      continue;
    }
    if (statement.exportKind === "type") continue;
    const from = stringValue(statement.source);
    if (!from) continue;
    const fromBunTest = from === BUN_TEST;
    const nested =
      !fromBunTest && from.startsWith(".")
        ? bunTestMockExports(resolveLocalModule(path, from), seen)
        : new Set<string>();
    if (statement.type === "ExportAllDeclaration") {
      if (fromBunTest) names.add("mock");
      else for (const name of nested) names.add(name);
      continue;
    }
    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      if (!isAstNode(specifier) || specifier.exportKind === "type") continue;
      const local = identifierName(specifier.local);
      const exported = identifierName(specifier.exported);
      if (!local || !exported) continue;
      if (fromBunTest ? local === "mock" : nested.has(local)) names.add(exported);
    }
  }
  return names;
}

export function sourceUsesBunModuleMock(source: string, fileName = "fixture.ts"): boolean {
  const body = statements(source, fileName);
  const mockBindings = new Set<string>();
  const bunTestNamespaces = new Set<string>();

  for (const statement of body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const from = stringValue(statement.source);
    if (!from) continue;
    const fromBunTest = from === BUN_TEST;
    const reexported = fromBunTest
      ? new Set<string>()
      : from.startsWith(".")
        ? bunTestMockExports(resolveLocalModule(fileName, from))
        : new Set<string>();
    if (!fromBunTest && reexported.size === 0) continue;
    for (const specifier of Array.isArray(statement.specifiers) ? statement.specifiers : []) {
      if (!isAstNode(specifier) || specifier.importKind === "type") continue;
      if (specifier.type === "ImportNamespaceSpecifier" && fromBunTest) {
        const local = identifierName(specifier.local);
        if (local) bunTestNamespaces.add(local);
      }
      if (specifier.type === "ImportSpecifier") {
        const imported = identifierName(specifier.imported);
        const local = identifierName(specifier.local);
        if (!imported || !local) continue;
        if (fromBunTest ? imported === "mock" : reexported.has(imported)) mockBindings.add(local);
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
    // `await import("./helper")` is an expression, not a declaration, so walking
    // the statement list alone left a mocking helper reached that way invisible
    // and the file free to sit in a real-store shard.
    visit(statement, (node) => {
      // Two shapes, because Babel has emitted both: `ImportExpression` with a
      // `source`, and a `CallExpression` whose callee is `Import`. Matching only
      // the second silently found nothing here.
      if (node.type === "ImportExpression") {
        const specifier = stringValue(node.source);
        if (specifier) imports.push(specifier);
        return;
      }
      if (node.type !== "CallExpression" || !isAstNode(node.callee)) return;
      if (node.callee.type !== "Import") return;
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      const specifier = stringValue(args[0]);
      if (specifier) imports.push(specifier);
    });
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
