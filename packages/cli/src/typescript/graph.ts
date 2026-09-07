/**
 * A package's declaration graph: the entry file, plus every package-local
 * declaration file it imports from or re-exports through, resolved into one
 * bridge. This module also owns the declaration-file conventions — which paths
 * a specifier may name, and what counts as inside the package root.
 */
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { semanticTypeIdentity, type ClassInfo, type ValueType } from "@velarscript/compiler";
import {
  createTypeScriptDeclarationGraphSourceBudget,
  MAX_TYPESCRIPT_DECLARATION_FILES,
  readTypeScriptDeclarationGraphSource,
  type TypeScriptDeclarationReadOperations,
} from "../typescript-declaration-source.ts";
import {
  emptyDeclarationBridge,
  MAX_TYPESCRIPT_DECLARATION_DEPTH,
  unique,
  unknownType,
  type TypeScriptDeclarationBridge,
} from "./bridge.ts";
import { parseTypeScriptDeclarations, renameDeclarationExport, renameDeclarationType } from "./declarations.ts";
import { packageNameOf } from "./package-exports.ts";
import { excludeAmbientBlocks, splitTopLevel, stripDeclarationComments } from "./scanning.ts";

interface DeclarationReexport {
  readonly source: string;
  readonly names: readonly { readonly imported: string; readonly exported: string; readonly typeOnly: boolean }[] | null;
}

interface DeclarationImport {
  readonly source: string;
  readonly names: readonly { readonly imported: string; readonly local: string }[];
  readonly unsupported: boolean;
}

/** The state one walk of a package's declaration graph carries between files. */
interface DeclarationGraphScope {
  readonly rootPath: string;
  readonly packageSource: string;
  readonly ownModules: ReadonlySet<string>;
  readonly cache: Map<string, TypeScriptDeclarationBridge>;
  readonly visiting: Set<string>;
  readonly sourceBudget: ReturnType<typeof createTypeScriptDeclarationGraphSourceBudget>;
  readonly operations: TypeScriptDeclarationReadOperations;
}

/**
 * One declaration file's exports while its re-exports are being folded in.
 * `explicit` and `explicitTypes` are the names the file already claimed, which
 * a later re-export of the same name must not silently take over.
 */
interface DeclarationExportSet {
  readonly exports: Map<string, ValueType>;
  readonly typeExports: Map<string, ValueType>;
  readonly classes: Map<string, ClassInfo>;
  readonly classRegistry: Map<string, ClassInfo>;
  readonly warnings: string[];
  readonly explicit: Set<string>;
  readonly explicitTypes: Set<string>;
}

export async function loadTypeScriptDeclarationGraph(root: string, entry: string, packageSource: string, importedSpecifier: string = packageSource, operations: TypeScriptDeclarationReadOperations = {}): Promise<TypeScriptDeclarationBridge> {
  const [rootPath, entryPath] = await Promise.all([realpath(root), realpath(entry)]);
  if (!insideRoot(rootPath, entryPath)) throw new Error("TypeScript declaration entry escapes its package root");
  // The specifiers a `declare module "…"` block may legitimately declare: the
  // package this graph belongs to, in the legacy ambient spelling. A subpath
  // import declares its own specifier, so `pkg/sub.d.ts` writing
  // `declare module "pkg/sub" { … }` is that subpath's own contract and must
  // not be excised as somebody else's ambient block.
  const ownModules = new Set([importedSpecifier, packageSource, packageNameOf(packageSource)]);
  const cache = new Map<string, TypeScriptDeclarationBridge>();
  const visiting = new Set<string>();
  const sourceBudget = createTypeScriptDeclarationGraphSourceBudget();
  const scope: DeclarationGraphScope = { rootPath, packageSource, ownModules, cache, visiting, sourceBudget, operations };
  const bridge = await loadDeclarationFile(scope, entryPath, 0);
  return { ...bridge, dependencies: [...sourceBudget.paths].sort() };
}

/**
 * One declaration file, cached, with the depth and cycle guards the recursion
 * needs and its own re-exports resolved into it.
 */
async function loadDeclarationFile(scope: DeclarationGraphScope, path: string, depth: number): Promise<TypeScriptDeclarationBridge> {
  const { cache, operations, ownModules, packageSource, rootPath, sourceBudget, visiting } = scope;
  const cached = cache.get(path);
  if (cached) return cached;
  if (depth > MAX_TYPESCRIPT_DECLARATION_DEPTH) {
    return emptyDeclarationBridge(path, `TypeScript declaration re-export depth exceeds ${MAX_TYPESCRIPT_DECLARATION_DEPTH}`);
  }
  if (visiting.has(path)) return emptyDeclarationBridge(path, "Cyclic TypeScript declaration re-export was kept as unknown");
  const loadedSource = await readTypeScriptDeclarationGraphSource(path, sourceBudget, operations);
  if (loadedSource.kind === "file-limit") return emptyDeclarationBridge(path, `TypeScript declaration graph exceeds ${MAX_TYPESCRIPT_DECLARATION_FILES} files`);
  if (loadedSource.kind === "byte-limit") return emptyDeclarationBridge(path, "TypeScript declaration graph exceeds the 2 MiB aggregate limit");
  visiting.add(path);
  try {
    const source = loadedSource.text;
    const origin = `${packageSource}/${relative(rootPath, path).replaceAll("\\", "/")}`;
    const { importWarnings, importedRegistry, importedTypes } = await resolveDeclarationImports(scope, path, depth, source);
    const local = parseTypeScriptDeclarations(source, path, origin, true, importedTypes, importedRegistry, ownModules);
    const exports = new Map(local.exports);
    const typeExports = new Map(local.typeExports);
    const classes = new Map(local.classes);
    const classRegistry = new Map([...importedRegistry, ...local.classRegistry]);
    const warnings = [...importWarnings, ...local.warnings];
    const explicit = new Set(exports.keys());
    const explicitTypes = new Set(typeExports.keys());
    const reexports = declarationReexports(source, ownModules);
    const names: DeclarationExportSet = { exports, typeExports, classes, classRegistry, warnings, explicit, explicitTypes };
    await resolveNamedReexports(scope, path, depth, reexports, names);
    await resolveStarReexports(scope, path, depth, reexports, names);
    const bridge = { path, dependencies: [path], exports, typeExports, classes, classRegistry, warnings: unique(warnings) } satisfies TypeScriptDeclarationBridge;
    cache.set(path, bridge);
    return bridge;
  } finally {
    visiting.delete(path);
  }
}

/** The types this file imports from its package-local siblings. */
async function resolveDeclarationImports(
  scope: DeclarationGraphScope,
  path: string,
  depth: number,
  source: string,
): Promise<{
  readonly importedTypes: Map<string, ValueType>;
  readonly importedRegistry: Map<string, ClassInfo>;
  readonly importWarnings: string[];
}> {
  const { ownModules, rootPath } = scope;
  const importedTypes = new Map<string, ValueType>();
  const importedRegistry = new Map<string, ClassInfo>();
  const importWarnings: string[] = [];
  for (const declarationImport of declarationImports(source, ownModules)) {
    if (declarationImport.unsupported) {
      importWarnings.push(`Namespace declaration import from '${declarationImport.source}' is outside the VelarScript declaration bridge and was kept as unknown`);
      continue;
    }
    const importedPath = await resolveDeclarationReexport(rootPath, path, declarationImport.source);
    if (!importedPath) {
      importWarnings.push(`Declaration import '${declarationImport.source}' is not a package-local declaration file and was kept as unknown`);
      for (const item of declarationImport.names) importedTypes.set(item.local, unknownType);
      continue;
    }
    const imported = await loadDeclarationFile(scope, importedPath, depth + 1);
    importWarnings.push(...imported.warnings.map((warning) => `${relative(rootPath, importedPath).replaceAll("\\", "/")}: ${warning}`));
    for (const [identity, info] of imported.classRegistry) importedRegistry.set(identity, info);
    for (const item of declarationImport.names) {
      const type = imported.typeExports.get(item.imported);
      if (type) importedTypes.set(item.local, renameDeclarationType(type, item.local));
      else {
        importedTypes.set(item.local, unknownType);
        importWarnings.push(`Declaration type import '${item.imported}' from '${declarationImport.source}' was not found and was kept as unknown`);
      }
    }
  }
  return { importedTypes, importedRegistry, importWarnings };
}

/** `export { … } from "…"`: each name resolved against the file it names. */
async function resolveNamedReexports(
  scope: DeclarationGraphScope,
  path: string,
  depth: number,
  reexports: readonly DeclarationReexport[],
  names: DeclarationExportSet,
): Promise<void> {
  const { rootPath } = scope;
  const { classes, classRegistry, explicit, explicitTypes, exports, typeExports, warnings } = names;
  for (const reexport of reexports.filter((item) => item.names !== null)) {
    const childPath = await resolveDeclarationReexport(rootPath, path, reexport.source);
    if (!childPath) {
      warnings.push(`Declaration re-export '${reexport.source}' is not a package-local .d.ts file and was kept as unknown`);
      for (const item of reexport.names ?? []) {
        if (!item.typeOnly) {
          exports.set(item.exported, unknownType);
          classes.delete(item.exported);
          explicit.add(item.exported);
        }
        typeExports.set(item.exported, unknownType);
        explicitTypes.add(item.exported);
      }
      continue;
    }
    const child = await loadDeclarationFile(scope, childPath, depth + 1);
    for (const [identity, info] of child.classRegistry) classRegistry.set(identity, info);
    warnings.push(...child.warnings.map((warning) => `${relative(rootPath, childPath).replaceAll("\\", "/")}: ${warning}`));
    for (const item of reexport.names ?? []) {
      const typeExport = child.typeExports.get(item.imported);
      if (!item.typeOnly && explicit.has(item.exported)) {
        warnings.push(`Duplicate explicit declaration export '${item.exported}' was kept as unknown`);
        exports.set(item.exported, unknownType);
        classes.delete(item.exported);
      } else if (!item.typeOnly) {
        const type = child.exports.get(item.imported);
        if (type) {
          exports.set(item.exported, renameDeclarationExport(type, item.exported));
          const info = child.classes.get(item.imported);
          if (info) classes.set(item.exported, info);
        } else if (!typeExport) {
          warnings.push(`Declaration re-export '${item.imported}' from '${reexport.source}' was not found and was kept as unknown`);
          exports.set(item.exported, unknownType);
        }
        explicit.add(item.exported);
      }
      if (explicitTypes.has(item.exported)) {
        warnings.push(`Duplicate explicit declaration type export '${item.exported}' was kept as unknown`);
        typeExports.set(item.exported, unknownType);
      } else if (typeExport) {
        typeExports.set(item.exported, renameDeclarationType(typeExport, item.exported));
      } else {
        typeExports.set(item.exported, unknownType);
      }
      explicitTypes.add(item.exported);
    }
  }
}

/**
 * `export * from "…"`: every name the child exports that this file has not
 * claimed, and the ambiguity two stars disagreeing about one name creates.
 */
async function resolveStarReexports(
  scope: DeclarationGraphScope,
  path: string,
  depth: number,
  reexports: readonly DeclarationReexport[],
  names: DeclarationExportSet,
): Promise<void> {
  const { rootPath } = scope;
  const { classes, classRegistry, explicit, explicitTypes, exports, typeExports, warnings } = names;
  const starKeys = new Map<string, string>();
  const starTypeKeys = new Map<string, string>();
  for (const reexport of reexports.filter((item) => item.names === null)) {
    const childPath = await resolveDeclarationReexport(rootPath, path, reexport.source);
    if (!childPath) {
      warnings.push(`Declaration re-export '${reexport.source}' is not a package-local .d.ts file and was ignored`);
      continue;
    }
    const child = await loadDeclarationFile(scope, childPath, depth + 1);
    for (const [identity, info] of child.classRegistry) classRegistry.set(identity, info);
    warnings.push(...child.warnings.map((warning) => `${relative(rootPath, childPath).replaceAll("\\", "/")}: ${warning}`));
    for (const [name, type] of child.exports) {
      if (name === "default" || explicit.has(name)) continue;
      const key = semanticTypeIdentity(type);
      const previous = starKeys.get(name);
      if (previous && previous !== key) {
        warnings.push(`Ambiguous declaration star export '${name}' was kept as unknown`);
        exports.set(name, unknownType);
        classes.delete(name);
        continue;
      }
      if (!previous) {
        starKeys.set(name, key);
        exports.set(name, type);
        const info = child.classes.get(name);
        if (info) classes.set(name, info);
      }
    }
    for (const [name, type] of child.typeExports) {
      if (name === "default" || explicitTypes.has(name)) continue;
      const key = semanticTypeIdentity(type);
      const previous = starTypeKeys.get(name);
      if (previous && previous !== key) {
        warnings.push(`Ambiguous declaration star type export '${name}' was kept as unknown`);
        typeExports.set(name, unknownType);
      } else if (!previous) {
        starTypeKeys.set(name, key);
        typeExports.set(name, type);
      }
    }
  }
}

function declarationReexports(source: string, ownModules: ReadonlySet<string>): readonly DeclarationReexport[] {
  const text = excludeAmbientBlocks(stripDeclarationComments(source), [], ownModules);
  const output: DeclarationReexport[] = [];
  const named = /export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']\s*;?/gu;
  for (const match of text.matchAll(named)) {
    const allTypeOnly = Boolean(match[1]);
    const names = splitTopLevel(match[2] ?? "", ",").flatMap((part) => {
      const specifier = /^(type\s+)?([A-Za-z_$][\w$]*|default)(?:\s+as\s+([A-Za-z_$][\w$]*|default))?$/u.exec(part.trim());
      if (!specifier) return [];
      return [{ imported: specifier[2]!, exported: specifier[3] ?? specifier[2]!, typeOnly: allTypeOnly || Boolean(specifier[1]) }];
    });
    output.push({ source: match[3]!, names });
  }
  const star = /export\s+\*\s+from\s*["']([^"']+)["']\s*;?/gu;
  for (const match of text.matchAll(star)) output.push({ source: match[1]!, names: null });
  return output;
}

function declarationImports(source: string, ownModules: ReadonlySet<string>): readonly DeclarationImport[] {
  const text = excludeAmbientBlocks(stripDeclarationComments(source), [], ownModules);
  const output: DeclarationImport[] = [];
  const pattern = /^[ \t]*import\s+(?:type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']\s*;?/gmu;
  for (const match of text.matchAll(pattern)) {
    const clause = (match[1] ?? "").trim();
    if (!clause || clause.startsWith("*")) {
      output.push({ source: match[2]!, names: [], unsupported: clause.startsWith("*") });
      continue;
    }
    const names: { imported: string; local: string }[] = [];
    const braceStart = clause.indexOf("{");
    const braceEnd = clause.lastIndexOf("}");
    const defaultName = (braceStart >= 0 ? clause.slice(0, braceStart).replace(/,$/u, "") : clause).trim();
    if (defaultName && /^[A-Za-z_$][\w$]*$/u.test(defaultName)) names.push({ imported: "default", local: defaultName });
    if (braceStart >= 0 && braceEnd > braceStart) {
      for (const part of splitTopLevel(clause.slice(braceStart + 1, braceEnd), ",")) {
        const specifier = /^(?:type\s+)?([A-Za-z_$][\w$]*|default)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(part.trim());
        if (specifier) names.push({ imported: specifier[1]!, local: specifier[2] ?? specifier[1]! });
      }
    }
    output.push({ source: match[2]!, names, unsupported: false });
  }
  return output;
}

async function resolveDeclarationReexport(root: string, importer: string, source: string): Promise<string | null> {
  if (!source.startsWith(".")) return null;
  const unresolved = resolve(dirname(importer), source);
  const candidates = declarationFileCandidates(unresolved);
  for (const candidate of candidates) {
    try {
      const path = await realpath(candidate);
      if (!insideRoot(root, path) || !isDeclarationFile(path) || !(await stat(path)).isFile()) continue;
      return path;
    } catch {
      // Try the next declaration-file convention.
    }
  }
  return null;
}

export function insideRoot(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

/**
 * The declaration files a resolved path may be spelled as. A specifier can name
 * the JavaScript file, the declaration file, or the directory that holds one.
 */
export function declarationFileCandidates(path: string): readonly string[] {
  if (isDeclarationFile(path)) return [path];
  if (path.endsWith(".mjs")) return [`${path.slice(0, -4)}.d.mts`, `${path.slice(0, -4)}.d.ts`];
  if (path.endsWith(".cjs")) return [`${path.slice(0, -4)}.d.cts`, `${path.slice(0, -4)}.d.ts`];
  if (path.endsWith(".js")) return [`${path.slice(0, -3)}.d.ts`];
  return [`${path}.d.ts`, `${path}.d.mts`, `${path}.d.cts`, join(path, "index.d.ts"), join(path, "index.d.mts"), join(path, "index.d.cts")];
}

export function isDeclarationFile(path: string): boolean {
  return path.endsWith(".d.ts") || path.endsWith(".d.mts") || path.endsWith(".d.cts");
}
