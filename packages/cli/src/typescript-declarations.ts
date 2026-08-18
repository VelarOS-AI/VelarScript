import { access, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describeType, optionalOf, readonlyViewOf, semanticTypeIdentity, unionOf, type ClassInfo, type ValueType } from "@velarscript/compiler";
import { resolveInstalledPackageRoot } from "./installed-package.ts";

export interface TypeScriptDeclarationBridge {
  readonly path: string;
  readonly dependencies: readonly string[];
  readonly exports: ReadonlyMap<string, ValueType>;
  readonly typeExports: ReadonlyMap<string, ValueType>;
  readonly classes: ReadonlyMap<string, ClassInfo>;
  readonly classRegistry: ReadonlyMap<string, ClassInfo>;
  readonly warnings: readonly string[];
  /**
   * BRG-U3: the package declares a `types` entry that cannot be read. The
   * import degrades to unknown, but with a notice — a broken declared path
   * is a package defect worth reporting, unlike a package that never
   * declared types at all.
   */
  readonly unreadableDeclaredTypes?: true;
}

type DeclarationDirection = "to-js" | "from-js" | "invariant";

function oppositeDirection(direction: DeclarationDirection): DeclarationDirection {
  return direction === "to-js" ? "from-js" : direction === "from-js" ? "to-js" : "invariant";
}

const unknownType: ValueType = { kind: "unknown" };
const unsupportedType: ValueType = { kind: "unknown", restricted: true };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_TYPESCRIPT_DECLARATION_BYTES = 2 * 1024 * 1024;
const MAX_TYPESCRIPT_DECLARATION_FILES = 64;
const MAX_TYPESCRIPT_DECLARATION_DEPTH = 16;

export async function loadTypeScriptDeclarations(source: string, importerPath: string): Promise<TypeScriptDeclarationBridge | null> {
  if (source.startsWith(".") || source.startsWith("/") || source.startsWith("#")) return null;
  const packageName = packageNameOf(source);
  const subpath = source === packageName ? "." : `.${source.slice(packageName.length)}`;
  const require = createRequire(pathToFileURL(join(dirname(importerPath), "__velar_types__.js")));
  let root: string;
  try {
    root = await resolveInstalledPackageRoot(packageName, source, require);
  } catch {
    return null;
  }
  let runtimeEntry: string | null = null;
  try {
    runtimeEntry = require.resolve(source);
  } catch {
    // An ESM-only package can still publish a complete `types` condition.
  }
  const manifestPath = join(root, "package.json");
  let manifest: {
    readonly name?: unknown;
    readonly types?: unknown;
    readonly typings?: unknown;
    readonly exports?: unknown;
  };
  try {
    manifest = JSON.parse(await readLimitedText(manifestPath, MAX_PACKAGE_MANIFEST_BYTES, "package manifest")) as typeof manifest;
  } catch {
    return null;
  }
  if (manifest.name !== undefined && manifest.name !== packageName) return null;
  const declared = exportedTypes(manifest.exports, subpath)
    ?? (subpath === "." ? stringValue(manifest.types) ?? stringValue(manifest.typings) : null);
  const path = await firstDeclarationEntry(root, declared, runtimeEntry, subpath === ".");
  if (!path) {
    // BRG-U3: a declared types path that cannot be read fires the polite
    // degradation notice instead of degrading in silence.
    if (declared !== null) {
      return {
        ...emptyDeclarationBridge(manifestPath, `package '${packageName}' declares types '${declared}', but that is not a readable declaration file inside the package; the import is typed as unknown`),
        unreadableDeclaredTypes: true,
      };
    }
    return null;
  }
  try {
    const bridge = await loadTypeScriptDeclarationGraph(root, path, packageName);
    return { ...bridge, dependencies: [...unique([manifestPath, ...bridge.dependencies])].sort() };
  } catch {
    return null;
  }
}

async function firstDeclarationEntry(root: string, declared: string | null, runtimeEntry: string | null, rootFallback: boolean): Promise<string | null> {
  const rootPath = await realpath(root);
  const candidates: string[] = [];
  if (declared && !isAbsolute(declared)) {
    const target = resolve(root, declared);
    if (insideRoot(root, target)) candidates.push(...declarationFileCandidates(target));
  }
  if (runtimeEntry) candidates.push(...declarationFileCandidates(runtimeEntry));
  if (rootFallback) candidates.push(join(root, "index.d.ts"), join(root, "index.d.mts"), join(root, "index.d.cts"));
  for (const candidate of unique(candidates)) {
    try {
      const path = await realpath(candidate);
      if (!insideRoot(rootPath, path) || !isDeclarationFile(path) || !(await stat(path)).isFile()) continue;
      return path;
    } catch {
      // Try the next declaration convention.
    }
  }
  return null;
}

function declarationFileCandidates(path: string): readonly string[] {
  if (isDeclarationFile(path)) return [path];
  if (path.endsWith(".mjs")) return [`${path.slice(0, -4)}.d.mts`, `${path.slice(0, -4)}.d.ts`];
  if (path.endsWith(".cjs")) return [`${path.slice(0, -4)}.d.cts`, `${path.slice(0, -4)}.d.ts`];
  if (path.endsWith(".js")) return [`${path.slice(0, -3)}.d.ts`];
  return [`${path}.d.ts`, `${path}.d.mts`, `${path}.d.cts`, join(path, "index.d.ts"), join(path, "index.d.mts"), join(path, "index.d.cts")];
}

function isDeclarationFile(path: string): boolean {
  return path.endsWith(".d.ts") || path.endsWith(".d.mts") || path.endsWith(".d.cts");
}

interface DeclarationReexport {
  readonly source: string;
  readonly names: readonly { readonly imported: string; readonly exported: string; readonly typeOnly: boolean }[] | null;
}

interface DeclarationImport {
  readonly source: string;
  readonly names: readonly { readonly imported: string; readonly local: string }[];
  readonly unsupported: boolean;
}

async function loadTypeScriptDeclarationGraph(root: string, entry: string, packageSource: string): Promise<TypeScriptDeclarationBridge> {
  const [rootPath, entryPath] = await Promise.all([realpath(root), realpath(entry)]);
  if (!insideRoot(rootPath, entryPath)) throw new Error("TypeScript declaration entry escapes its package root");
  const cache = new Map<string, TypeScriptDeclarationBridge>();
  const visiting = new Set<string>();
  const counted = new Set<string>();
  let totalBytes = 0;

  const load = async (path: string, depth: number): Promise<TypeScriptDeclarationBridge> => {
    const cached = cache.get(path);
    if (cached) return cached;
    if (depth > MAX_TYPESCRIPT_DECLARATION_DEPTH) {
      return emptyDeclarationBridge(path, `TypeScript declaration re-export depth exceeds ${MAX_TYPESCRIPT_DECLARATION_DEPTH}`);
    }
    if (visiting.has(path)) return emptyDeclarationBridge(path, "Cyclic TypeScript declaration re-export was kept as unknown");
    if (!counted.has(path)) {
      if (counted.size >= MAX_TYPESCRIPT_DECLARATION_FILES) {
        return emptyDeclarationBridge(path, `TypeScript declaration graph exceeds ${MAX_TYPESCRIPT_DECLARATION_FILES} files`);
      }
      const metadata = await stat(path);
      if (!metadata.isFile()) return emptyDeclarationBridge(path, "TypeScript declaration re-export is not a regular file");
      if (metadata.size > MAX_TYPESCRIPT_DECLARATION_BYTES || totalBytes + metadata.size > MAX_TYPESCRIPT_DECLARATION_BYTES) {
        return emptyDeclarationBridge(path, "TypeScript declaration graph exceeds the 2 MiB aggregate limit");
      }
      counted.add(path);
      totalBytes += metadata.size;
    }
    visiting.add(path);
    try {
      const source = await readLimitedText(path, MAX_TYPESCRIPT_DECLARATION_BYTES, "TypeScript declaration");
      const origin = `${packageSource}/${relative(rootPath, path).replaceAll("\\", "/")}`;
      const importedTypes = new Map<string, ValueType>();
      const importedRegistry = new Map<string, ClassInfo>();
      const importWarnings: string[] = [];
      for (const declarationImport of declarationImports(source)) {
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
        const imported = await load(importedPath, depth + 1);
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
      const local = parseTypeScriptDeclarations(source, path, origin, true, importedTypes, importedRegistry);
      const exports = new Map(local.exports);
      const typeExports = new Map(local.typeExports);
      const classes = new Map(local.classes);
      const classRegistry = new Map([...importedRegistry, ...local.classRegistry]);
      const warnings = [...importWarnings, ...local.warnings];
      const explicit = new Set(exports.keys());
      const explicitTypes = new Set(typeExports.keys());
      const reexports = declarationReexports(source);

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
        const child = await load(childPath, depth + 1);
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

      const starKeys = new Map<string, string>();
      const starTypeKeys = new Map<string, string>();
      for (const reexport of reexports.filter((item) => item.names === null)) {
        const childPath = await resolveDeclarationReexport(rootPath, path, reexport.source);
        if (!childPath) {
          warnings.push(`Declaration re-export '${reexport.source}' is not a package-local .d.ts file and was ignored`);
          continue;
        }
        const child = await load(childPath, depth + 1);
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
      const bridge = { path, dependencies: [path], exports, typeExports, classes, classRegistry, warnings: unique(warnings) } satisfies TypeScriptDeclarationBridge;
      cache.set(path, bridge);
      return bridge;
    } finally {
      visiting.delete(path);
    }
  };

  const bridge = await load(entryPath, 0);
  return { ...bridge, dependencies: [...counted].sort() };
}

function emptyDeclarationBridge(path: string, warning: string): TypeScriptDeclarationBridge {
  return { path, dependencies: [path], exports: new Map(), typeExports: new Map(), classes: new Map(), classRegistry: new Map(), warnings: [warning] };
}

function declarationReexports(source: string): readonly DeclarationReexport[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
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

function declarationImports(source: string): readonly DeclarationImport[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
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

interface LocalDeclarationExport {
  readonly local: string;
  readonly exported: string;
  readonly typeOnly: boolean;
}

function localDeclarationExports(source: string): readonly LocalDeclarationExport[] {
  const output: LocalDeclarationExport[] = [];
  const pattern = /export\s+(type\s+)?\{([\s\S]*?)\}\s*(?!from\b)(?:;|$)/gmu;
  for (const match of source.matchAll(pattern)) {
    const allTypeOnly = Boolean(match[1]);
    for (const part of splitTopLevel(match[2] ?? "", ",")) {
      const specifier = /^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*|default))?$/u.exec(part.trim());
      if (!specifier) continue;
      output.push({
        local: specifier[2]!,
        exported: specifier[3] ?? specifier[2]!,
        typeOnly: allTypeOnly || Boolean(specifier[1]),
      });
    }
  }
  const defaultPattern = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/gu;
  for (const match of source.matchAll(defaultPattern)) {
    output.push({ local: match[1]!, exported: "default", typeOnly: false });
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

function insideRoot(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function renameDeclarationExport(type: ValueType, name: string): ValueType {
  return type.kind === "classConstructor" ? { ...type, name } : type;
}

function renameDeclarationType(type: ValueType, name: string): ValueType {
  return type.kind === "class" ? { ...type, name } : type;
}

export function parseTypeScriptDeclarations(
  source: string,
  path = "<types>",
  moduleSource = path,
  reexportsHandled = false,
  importedTypes: ReadonlyMap<string, ValueType> = new Map(),
  importedClassRegistry: ReadonlyMap<string, ClassInfo> = new Map(),
): TypeScriptDeclarationBridge {
  if (Buffer.byteLength(source, "utf8") > MAX_TYPESCRIPT_DECLARATION_BYTES) {
    throw new RangeError(`${path} exceeds the 2 MiB TypeScript declaration bridge limit`);
  }
  const text = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
  const warnings: string[] = [];
  const aliases = new Map<string, string>();
  const interfaces = new Map<string, { readonly bases: readonly string[]; readonly body: string }>();
  const invalidInterfaces = new Set<string>();
  const directlyExportedTypes = new Set<string>();
  const interfacePattern = /(export\s+)?interface\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([^\{]+))?\s*\{([^{}]*)\}/gu;
  for (const match of text.matchAll(interfacePattern)) {
    const name = match[2]!;
    if (match[1]) directlyExportedTypes.add(name);
    if (interfaces.has(name)) {
      warnings.push(`Merged interface '${name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      invalidInterfaces.add(name);
    }
    interfaces.set(name, {
      bases: (match[3] ?? "").split(",").map((base) => base.trim()).filter(Boolean),
      body: match[4] ?? "",
    });
  }
  const aliasPattern = /(export\s+)?type\s+([A-Za-z_$][\w$]*)(?:\s*<[^=]+>)?\s*=\s*([^;]+);/gu;
  for (const match of text.matchAll(aliasPattern)) {
    const name = match[2]!;
    if (match[1]) directlyExportedTypes.add(name);
    if (aliases.has(name) || interfaces.has(name)) {
      warnings.push(`Merged declaration '${name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      aliases.set(name, "unknown");
      invalidInterfaces.add(name);
    } else aliases.set(name, match[3] ?? "unknown");
  }
  const resolvingInterfaces = new Set<string>();
  const resolveInterface = (name: string): string => {
    if (invalidInterfaces.has(name)) return "unknown";
    const cached = aliases.get(name);
    if (cached) return cached;
    const declaration = interfaces.get(name);
    if (!declaration) return "unknown";
    if (resolvingInterfaces.has(name)) {
      warnings.push(`Recursive interface '${name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      invalidInterfaces.add(name);
      return "unknown";
    }
    resolvingInterfaces.add(name);
    const bodies: string[] = [];
    for (const baseName of declaration.bases) {
      if (!/^[A-Za-z_$][\w$]*$/u.test(baseName)) {
        warnings.push(`Generic or complex interface base '${baseName}' is outside the VelarScript declaration bridge and '${name}' was kept as unknown`);
        invalidInterfaces.add(name);
        resolvingInterfaces.delete(name);
        return "unknown";
      }
      const base = interfaces.has(baseName) ? resolveInterface(baseName) : aliases.get(baseName);
      if (!base?.startsWith("{") || !base.endsWith("}")) {
        warnings.push(`Interface base '${baseName}' cannot be expanded and '${name}' was kept as unknown`);
        invalidInterfaces.add(name);
        resolvingInterfaces.delete(name);
        return "unknown";
      }
      bodies.push(base.slice(1, -1));
    }
    bodies.push(declaration.body);
    resolvingInterfaces.delete(name);
    const resolved = `{${bodies.filter(Boolean).join(";")}}`;
    aliases.set(name, resolved);
    return resolved;
  };
  for (const name of interfaces.keys()) resolveInterface(name);

  const exports = new Map<string, ValueType>();
  const typeExports = new Map<string, ValueType>();
  const classes = new Map<string, ClassInfo>();
  const classRegistry = new Map<string, ClassInfo>();
  const localValues = new Map<string, ValueType>();
  const localTypes = new Map<string, ValueType>();
  const localClasses = new Map<string, ClassInfo>();
  const directRuntimeExports: { readonly local: string; readonly exported: string }[] = [];
  const classDeclarations = readClassDeclarations(text, warnings);
  const knownTypes = new Map(importedTypes);
  for (const declaration of classDeclarations) {
    const identity = `js:${moduleSource}#${declaration.name}`;
    const type: ValueType = { kind: "class", name: declaration.name, identity };
    knownTypes.set(declaration.name, type);
  }
  const parse = (value: string, direction: DeclarationDirection = "from-js"): ValueType => parseTsType(value, aliases, warnings, new Set(), knownTypes, direction);
  const classCounts = new Map<string, number>();
  for (const declaration of classDeclarations) classCounts.set(declaration.name, (classCounts.get(declaration.name) ?? 0) + 1);
  for (const declaration of classDeclarations) {
    if (declaration.directExportName) directRuntimeExports.push({ local: declaration.name, exported: declaration.directExportName });
    if ((classCounts.get(declaration.name) ?? 0) > 1) {
      if (!localTypes.has(declaration.name)) warnings.push(`Duplicate class declaration '${declaration.name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      knownTypes.set(declaration.name, unknownType);
      continue;
    }
    if (interfaces.has(declaration.name) || aliases.has(declaration.name)) {
      warnings.push(`Merged class declaration '${declaration.name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      knownTypes.set(declaration.name, unknownType);
      continue;
    }
    const selfType = knownTypes.get(declaration.name);
    if (selfType) knownTypes.set("this", selfType);
    const parsed = parseClassDeclaration(declaration, parse, warnings, moduleSource, knownTypes);
    knownTypes.delete("this");
    if (!parsed) {
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      knownTypes.set(declaration.name, unknownType);
      continue;
    }
    localClasses.set(declaration.name, parsed);
  }
  let removedBase = true;
  while (removedBase) {
    removedBase = false;
    const accepted = new Set([
      ...[...localClasses.values()].map((info) => info.identity).filter((identity): identity is string => Boolean(identity)),
      ...importedClassRegistry.keys(),
    ]);
    for (const [name, info] of localClasses) {
      if (!info.base || info.base === "Error" || accepted.has(info.base)) continue;
      warnings.push(`Class declaration '${name}' has an unsupported base contract and was kept as unknown`);
      localClasses.delete(name);
      knownTypes.set(name, unknownType);
      removedBase = true;
    }
  }
  const byIdentity = new Map<string, { readonly name: string; readonly info: ClassInfo }>([
    ...[...importedClassRegistry].map(([identity, info]) => [identity, { name: identity, info }] as const),
    ...[...localClasses].flatMap(([name, info]) => info.identity ? [[info.identity, { name, info }] as const] : []),
  ]);
  for (const [name, info] of [...localClasses]) {
    const visited = new Set<string>();
    let current: ClassInfo | undefined = info;
    while (current?.identity) {
      if (visited.has(current.identity)) {
        warnings.push(`Class declaration '${name}' has cyclic inheritance and was kept as unknown`);
        localClasses.delete(name);
        knownTypes.set(name, unknownType);
        break;
      }
      visited.add(current.identity);
      current = current.base ? byIdentity.get(current.base)?.info : undefined;
    }
  }
  const acceptedByIdentity = new Map<string, { readonly name: string; readonly info: ClassInfo }>([
    ...[...importedClassRegistry].map(([identity, info]) => [identity, { name: identity, info }] as const),
    ...[...localClasses].flatMap(([name, info]) => info.identity ? [[info.identity, { name, info }] as const] : []),
  ]);
  const inheritedMember = (
    info: ClassInfo,
    name: string,
  ): { readonly kind: "field"; readonly mutable: boolean; readonly type: ValueType } | { readonly kind: "method"; readonly type: ValueType } | null => {
    const visited = new Set<string>();
    let base = info.base;
    while (base && !visited.has(base)) {
      visited.add(base);
      const parent = acceptedByIdentity.get(base)?.info;
      if (!parent) return null;
      const field = parent.fields.get(name);
      if (field) return { kind: "field", mutable: field.mutable, type: field.type };
      const method = parent.methods.get(name);
      if (method) return { kind: "method", type: method };
      base = parent.base;
    }
    return null;
  };
  for (const [name, info] of [...localClasses]) {
    let incompatible = false;
    for (const [memberName, field] of info.fields) {
      const inherited = inheritedMember(info, memberName);
      if (inherited && (inherited.kind !== "field" || inherited.mutable !== field.mutable || semanticTypeIdentity(inherited.type) !== semanticTypeIdentity(field.type))) incompatible = true;
    }
    for (const [memberName, method] of info.methods) {
      const inherited = inheritedMember(info, memberName);
      if (inherited && (inherited.kind !== "method" || semanticTypeIdentity(inherited.type) !== semanticTypeIdentity(method))) incompatible = true;
    }
    if (incompatible) {
      warnings.push(`Class declaration '${name}' has an incompatible inherited member contract and was kept as unknown`);
      localClasses.delete(name);
      knownTypes.set(name, unknownType);
    }
  }
  let pruned = true;
  while (pruned) {
    pruned = false;
    const accepted = new Set([
      ...[...localClasses.values()].map((info) => info.identity).filter((identity): identity is string => Boolean(identity)),
      ...importedClassRegistry.keys(),
    ]);
    for (const [name, info] of localClasses) {
      if (!info.base || info.base === "Error" || accepted.has(info.base)) continue;
      warnings.push(`Class declaration '${name}' has an unsupported base contract and was kept as unknown`);
      localClasses.delete(name);
      knownTypes.set(name, unknownType);
      pruned = true;
    }
  }

  for (const name of new Set([...interfaces.keys(), ...aliases.keys()])) localTypes.set(name, parse(name));
  for (const declaration of classDeclarations) {
    if ((classCounts.get(declaration.name) ?? 0) > 1 || interfaces.has(declaration.name) || aliases.has(declaration.name)) continue;
    const info = localClasses.get(declaration.name);
    if (!info?.identity) {
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      continue;
    }
    const instance: ValueType = { kind: "class", name: declaration.name, identity: info.identity };
    localTypes.set(declaration.name, instance);
    localValues.set(declaration.name, { kind: "classConstructor", name: declaration.name, identity: info.identity });
    classRegistry.set(info.identity, info);
  }

  const setLocalValue = (name: string, type: ValueType, label: string): void => {
    if (localValues.has(name)) {
      warnings.push(`Overloaded export '${name}' or merged local ${label} declaration is outside the VelarScript declaration bridge and was kept as unknown`);
      localValues.set(name, unknownType);
    } else localValues.set(name, type);
  };
  const functions = /(export\s+)?(?:declare\s+)?(default\s+)?function\s+([A-Za-z_$][\w$]*)/gu;
  for (const match of text.matchAll(functions)) {
    const local = match[3]!;
    const exported = match[2] ? "default" : local;
    if (match[1]) directRuntimeExports.push({ local, exported });
    const signature = readFunctionSignature(text, match.index + match[0].length);
    let type: ValueType = unknownType;
    if (!signature) warnings.push(`Function declaration '${local}' has an unsupported declaration and was kept as unknown`);
    else if (signature.generic) warnings.push(`Generic function '${local}' is outside the VelarScript declaration bridge and was kept as unknown`);
    else {
      const parameters = parseParameters(signature.parameters, (value) => parse(value, "to-js"), warnings);
      type = parameters.invalid ? unsupportedType : {
        kind: "function",
        parameters: parameters.types,
        requiredParameters: parameters.required,
        ...(parameters.rest ? { rest: parameters.rest } : {}),
        result: parse(signature.result, "from-js"),
      };
    }
    setLocalValue(local, type, "function");
  }

  for (const declaration of constantDeclarations(text)) {
    if (declaration.exported) directRuntimeExports.push({ local: declaration.name, exported: declaration.name });
    setLocalValue(declaration.name, parse(declaration.type), "const");
  }

  const setTypeExport = (exported: string, type: ValueType): void => {
    if (typeExports.has(exported)) {
      warnings.push(`Duplicate explicit declaration type export '${exported}' was kept as unknown`);
      typeExports.set(exported, unknownType);
    } else typeExports.set(exported, renameDeclarationType(type, exported));
  };
  const setRuntimeExport = (local: string, exported: string, type: ValueType): void => {
    if (exports.has(exported)) {
      warnings.push(`Duplicate explicit declaration export '${exported}' was kept as unknown`);
      exports.set(exported, unknownType);
      classes.delete(exported);
      return;
    }
    exports.set(exported, renameDeclarationExport(type, exported));
    const info = localClasses.get(local);
    if (type.kind === "classConstructor" && info) classes.set(exported, info);
  };

  for (const name of directlyExportedTypes) setTypeExport(name, localTypes.get(name) ?? unknownType);
  for (const item of directRuntimeExports) {
    const value = localValues.get(item.local) ?? unknownType;
    setRuntimeExport(item.local, item.exported, value);
    const type = localTypes.get(item.local);
    if (type) setTypeExport(item.exported, type);
  }
  for (const item of localDeclarationExports(text)) {
    const value = localValues.get(item.local);
    const type = localTypes.get(item.local);
    if (item.typeOnly) {
      if (type) setTypeExport(item.exported, type);
      else {
        warnings.push(`Local declaration type export '${item.local}' was not found and was kept as unknown`);
        setTypeExport(item.exported, unknownType);
      }
      continue;
    }
    if (value) setRuntimeExport(item.local, item.exported, value);
    if (type) setTypeExport(item.exported, type);
    if (!value && !type) {
      warnings.push(`Local declaration export '${item.local}' was not found and was kept as unknown`);
      setRuntimeExport(item.local, item.exported, unknownType);
      setTypeExport(item.exported, unknownType);
    }
  }
  if (/export\s*=/u.test(text)) warnings.push("TypeScript export assignment is outside the VelarScript declaration bridge");
  if (!reexportsHandled && (/export\s+\*/u.test(text) || /export\s+(?:type\s+)?\{[^}]+\}\s+from\s*["']/u.test(text))) {
    warnings.push("TypeScript re-export requires the package declaration graph loader");
  }
  return { path, dependencies: [path], exports, typeExports, classes, classRegistry, warnings: unique(warnings) };
}

interface ConstantDeclaration {
  readonly name: string;
  readonly type: string;
  readonly exported: boolean;
}

/**
 * Reads a declaration type to its real top-level terminator. A semicolon and
 * an ASI newline are equivalent here; nested object/function/generic syntax
 * may contain either without ending the `const` declaration.
 */
function constantDeclarations(source: string): readonly ConstantDeclaration[] {
  const output: ConstantDeclaration[] = [];
  const heads = /(?:^|[;\r\n])[\t ]*(export\s+)?(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)\s*:\s*/gmu;
  for (const match of source.matchAll(heads)) {
    const start = match.index + match[0].length;
    let round = 0;
    let square = 0;
    let brace = 0;
    let angle = 0;
    let quote = "";
    let end = start;
    for (; end < source.length; end += 1) {
      const character = source[end]!;
      if (quote) {
        if (character === "\\") end += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") quote = character;
      else if (character === "(") round += 1;
      else if (character === ")") round = Math.max(0, round - 1);
      else if (character === "[") square += 1;
      else if (character === "]") square = Math.max(0, square - 1);
      else if (character === "{") brace += 1;
      else if (character === "}") brace = Math.max(0, brace - 1);
      else if (character === "<") angle += 1;
      else if (character === ">") angle = Math.max(0, angle - 1);
      else if ((character === ";" || character === "\n" || character === "\r")
        && round === 0 && square === 0 && brace === 0 && angle === 0) break;
    }
    const type = source.slice(start, end).trim();
    if (type) output.push({ name: match[2]!, type, exported: Boolean(match[1]) });
  }
  return output;
}

interface TypeScriptClassDeclaration {
  readonly name: string;
  readonly directExportName: string | null;
  readonly baseName: string | null;
  readonly body: string;
  readonly unsupportedHeader: string | null;
}

function readClassDeclarations(source: string, warnings: string[]): readonly TypeScriptClassDeclaration[] {
  const declarations: TypeScriptClassDeclaration[] = [];
  const pattern = /(export\s+)?(?:declare\s+)?(?:(default)\s+)?(?:(abstract)\s+)?class\s+([A-Za-z_$][\w$]*)/gu;
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("{", match.index + match[0].length);
    if (open < 0) {
      warnings.push(`Class declaration '${match[4]}' has no readable body and was kept as unknown`);
      continue;
    }
    const close = matchingDelimiter(source, open, "{", "}");
    if (close < 0) {
      warnings.push(`Class declaration '${match[4]}' has an unclosed body and was kept as unknown`);
      continue;
    }
    const header = source.slice(match.index + match[0].length, open).trim();
    const base = /^extends\s+([A-Za-z_$][\w$]*)$/u.exec(header);
    declarations.push({
      name: match[4]!,
      directExportName: match[1] ? (match[2] ? "default" : match[4]!) : null,
      baseName: base?.[1] ?? null,
      body: source.slice(open + 1, close),
      unsupportedHeader: match[3] || (header && !base) ? [match[3] ? "abstract" : "", header].filter(Boolean).join(" ") : null,
    });
  }
  return declarations;
}

function parseClassDeclaration(
  declaration: TypeScriptClassDeclaration,
  parse: (value: string, direction?: DeclarationDirection) => ValueType,
  warnings: string[],
  moduleSource: string,
  classTypes: ReadonlyMap<string, ValueType>,
): ClassInfo | null {
  if (declaration.unsupportedHeader) {
    warnings.push(`Class declaration '${declaration.name}' uses unsupported '${declaration.unsupportedHeader}' syntax and was kept as unknown`);
    return null;
  }
  const warningCount = warnings.length;
  let constructor: ReturnType<typeof parseClassConstructorParameters> | null = null;
  const fields = new Map<string, { readonly mutable: boolean; readonly type: ValueType }>();
  const methods = new Map<string, ValueType>();
  const staticFields = new Map<string, { readonly mutable: boolean; readonly type: ValueType }>();
  const staticMethods = new Map<string, ValueType>();
  const getterNames = new Set<string>();
  const staticGetterNames = new Set<string>();
  const accessors = new Map<string, { getter?: ValueType; setter?: ValueType }>();
  const staticAccessors = new Map<string, { getter?: ValueType; setter?: ValueType }>();
  let invalid = false;

  const reject = (member: string): void => {
    warnings.push(`Unsupported public class member '${member}' in '${declaration.name}' caused the class to be kept as unknown`);
    invalid = true;
  };
  const duplicate = (name: string): void => {
    warnings.push(`Overloaded or duplicate class member '${name}' in '${declaration.name}' caused the class to be kept as unknown`);
    invalid = true;
  };
  const reserved = (name: string, member: string): boolean => {
    if (name !== "constructor" && name !== "prototype" && name !== "__proto__") return false;
    reject(member);
    return true;
  };

  for (const raw of splitFields(declaration.body)) {
    const member = raw.trim();
    if (!member) continue;
    if (/^(?:private|protected)\s+/u.test(member)) {
      if (/^(?:private|protected)\s+constructor\b/u.test(member)) reject(member);
      continue;
    }
    const constructorPrefix = /^constructor\s*/u.exec(member);
    if (constructorPrefix) {
      const open = constructorPrefix[0].length;
      if (member[open] !== "(") {
        reject(member);
        continue;
      }
      const close = matchingDelimiter(member, open, "(", ")");
      if (close < 0 || member.slice(close + 1).trim()) {
        reject(member);
        continue;
      }
      if (constructor) {
        duplicate("constructor");
        continue;
      }
      constructor = parseClassConstructorParameters(member.slice(open + 1, close), parse, warnings);
      for (const [name, field] of constructor.fields) {
        if (fields.has(name) || methods.has(name) || accessors.has(name)) duplicate(name);
        else fields.set(name, field);
      }
      continue;
    }

    const accessor = readAccessorSignature(member);
    if (accessor) {
      if (reserved(accessor.name, member)) continue;
      const modifiers = new Set(accessor.modifiers);
      const target = modifiers.has("static") ? staticAccessors : accessors;
      const fieldsTarget = modifiers.has("static") ? staticFields : fields;
      const methodsTarget = modifiers.has("static") ? staticMethods : methods;
      if (fieldsTarget.has(accessor.name) || methodsTarget.has(accessor.name)) {
        duplicate(accessor.name);
        continue;
      }
      const contract = target.get(accessor.name) ?? {};
      if ((accessor.kind === "get" && contract.getter) || (accessor.kind === "set" && contract.setter)) {
        duplicate(accessor.name);
        continue;
      }
      if (accessor.kind === "get") contract.getter = parse(accessor.type, "from-js");
      else contract.setter = parse(accessor.type, "to-js");
      target.set(accessor.name, contract);
      continue;
    }

    const property = /^((?:(?:public|static|readonly|declare)\s+)*)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/u.exec(member);
    if (property) {
      const modifiers = new Set((property[1] ?? "").trim().split(/\s+/u).filter(Boolean));
      const target = modifiers.has("static") ? staticFields : fields;
      const accessorsTarget = modifiers.has("static") ? staticAccessors : accessors;
      const name = property[2]!;
      if (reserved(name, member)) continue;
      if (target.has(name) || accessorsTarget.has(name) || (modifiers.has("static") ? staticMethods : methods).has(name)) {
        duplicate(name);
        continue;
      }
      if (property[3] && !modifiers.has("readonly")) {
        warnings.push(`Optional mutable class field '${name}' has no exact VelarScript field contract and caused '${declaration.name}' to be kept as unknown`);
        invalid = true;
        continue;
      }
      const type = parse(property[4] ?? "unknown", modifiers.has("readonly") ? "from-js" : "invariant");
      target.set(name, { mutable: !modifiers.has("readonly"), type: property[3] ? optionalOf(type) : type });
      continue;
    }

    const methodPrefix = /^((?:(?:public|static)\s+)*)?/u.exec(member);
    const modifiersText = methodPrefix?.[1] ?? "";
    const method = readMethodSignature(member.slice(methodPrefix?.[0].length ?? 0));
    if (method) {
      if (reserved(method.name, member)) continue;
      const modifiers = new Set(modifiersText.trim().split(/\s+/u).filter(Boolean));
      const target = modifiers.has("static") ? staticMethods : methods;
      const fieldsTarget = modifiers.has("static") ? staticFields : fields;
      const accessorsTarget = modifiers.has("static") ? staticAccessors : accessors;
      if (target.has(method.name) || fieldsTarget.has(method.name) || accessorsTarget.has(method.name)) {
        duplicate(method.name);
        continue;
      }
      const parameters = parseParameters(method.parameters, (value) => parse(value, "to-js"), warnings);
      const type: ValueType = parameters.invalid ? unsupportedType : {
        kind: "function",
        parameters: parameters.types,
        requiredParameters: parameters.required,
        ...(parameters.rest ? { rest: parameters.rest } : {}),
        result: parse(method.result, "from-js"),
      };
      target.set(method.name, method.optional ? optionalOf(type) : type);
      continue;
    }
    reject(member);
  }

  const materializeAccessors = (
    source: ReadonlyMap<string, { readonly getter?: ValueType; readonly setter?: ValueType }>,
    target: Map<string, { readonly mutable: boolean; readonly type: ValueType }>,
    readonlyGetters: Set<string>,
  ): void => {
    for (const [name, contract] of source) {
      if (!contract.getter) {
        warnings.push(`Setter-only class accessor '${name}' in '${declaration.name}' caused the class to be kept as unknown`);
        invalid = true;
        continue;
      }
      if (contract.setter && semanticTypeIdentity(contract.getter) !== semanticTypeIdentity(contract.setter)) {
        warnings.push(`Class accessor '${name}' in '${declaration.name}' has incompatible getter and setter types`);
        invalid = true;
        continue;
      }
      target.set(name, { mutable: Boolean(contract.setter), type: contract.getter });
      if (!contract.setter) readonlyGetters.add(name);
    }
  };
  materializeAccessors(accessors, fields, getterNames);
  materializeAccessors(staticAccessors, staticFields, staticGetterNames);

  if (warnings.length > warningCount) invalid = true;
  if (invalid) return null;
  const identity = `js:${moduleSource}#${declaration.name}`;
  const base = declaration.baseName ? classTypes.get(declaration.baseName) : null;
  if (declaration.baseName && base?.kind !== "class") {
    warnings.push(`Class base '${declaration.baseName}' cannot be expanded and '${declaration.name}' was kept as unknown`);
    return null;
  }
  return {
    identity,
    parameters: constructor?.types ?? [],
    requiredParameters: constructor?.required ?? 0,
    ...(constructor?.rest ? { constructorRest: constructor.rest } : {}),
    base: base?.kind === "class" ? base.identity ?? base.name : null,
    abstract: false,
    fields,
    getters: getterNames,
    abstractGetters: new Set(),
    methods,
    abstractMethods: new Set(),
    staticFields,
    staticGetters: staticGetterNames,
    staticMethods,
  };
}

async function readLimitedText(path: string, maximum: number, label: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file`);
  if (metadata.size > maximum) throw new RangeError(`${label} exceeds ${maximum} bytes`);
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source, "utf8") > maximum) throw new RangeError(`${label} exceeds ${maximum} bytes`);
  return source;
}

function parseRestElementType(source: string, parse: (value: string) => ValueType): ValueType | null {
  let value = source.trim();
  if (value.startsWith("readonly ")) value = value.slice("readonly ".length).trim();
  if (value.endsWith("[]")) return parse(value.slice(0, -2));
  const generic = /^(?:Array|ReadonlyArray)\s*<([\s\S]+)>$/u.exec(value);
  return generic && splitTopLevel(generic[1] ?? "", ",").length === 1 ? parse(generic[1] ?? "unknown") : null;
}

function parseParameters(
  source: string,
  parse: (value: string) => ValueType,
  warnings: string[],
): { readonly types: readonly ValueType[]; readonly required: number; readonly rest?: ValueType; readonly invalid?: true } {
  if (!source.trim()) return { types: [], required: 0 };
  const types: ValueType[] = [];
  let required = 0;
  let optionalSeen = false;
  let invalid = false;
  let rest: ValueType | undefined;
  const parts = splitTopLevel(source, ",");
  for (const [index, part] of parts.entries()) {
    const match = /^(\.\.\.)?[A-Za-z_$][\w$]*(\?)?\s*:\s*(.+)$/u.exec(part.trim());
    if (!match) {
      warnings.push(`Unsupported parameter declaration '${part.trim()}' was kept as unknown`);
      types.push(unsupportedType);
      optionalSeen = true;
      continue;
    }
    const optional = Boolean(match[2]);
    if (match[1]) {
      if (index !== parts.length - 1) warnings.push(`Rest parameter '${part.trim()}' is not final and was kept as unknown`);
      if (optional) warnings.push(`Optional rest parameter '${part.trim()}' was kept as unknown`);
      const element = parseRestElementType(match[3] ?? "unknown", parse);
      if (element && index === parts.length - 1 && !optional) rest = element;
      else {
        if (!element) warnings.push(`Rest parameter '${part.trim()}' must use an array type and was kept as unknown`);
        rest = unsupportedType;
      }
      continue;
    }
    const type = parse(match[3] ?? "unknown");
    types.push(type);
    if (!optional && optionalSeen) {
      warnings.push(`Required parameter '${part.trim()}' follows an optional parameter and the callable was kept as unknown`);
      invalid = true;
    }
    if (!optional && !optionalSeen) required += 1;
    if (optional) optionalSeen = true;
  }
  return { types, required, ...(rest ? { rest } : {}), ...(invalid ? { invalid: true } : {}) };
}

function parseClassConstructorParameters(
  source: string,
  parse: (value: string, direction?: DeclarationDirection) => ValueType,
  warnings: string[],
): {
  readonly types: readonly ValueType[];
  readonly required: number;
  readonly rest?: ValueType;
  readonly fields: ReadonlyMap<string, { readonly mutable: boolean; readonly type: ValueType }>;
} {
  if (!source.trim()) return { types: [], required: 0, fields: new Map() };
  const types: ValueType[] = [];
  const fields = new Map<string, { readonly mutable: boolean; readonly type: ValueType }>();
  let required = 0;
  let optionalSeen = false;
  let rest: ValueType | undefined;
  const parts = splitTopLevel(source, ",");
  for (const [index, part] of parts.entries()) {
    const match = /^((?:(?:public|private|protected|readonly)\s+)*)(\.\.\.)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/u.exec(part.trim());
    if (!match) {
      warnings.push(`Unsupported constructor parameter declaration '${part.trim()}' was kept as unknown`);
      types.push(unsupportedType);
      optionalSeen = true;
      continue;
    }
    const modifiers = new Set((match[1] ?? "").trim().split(/\s+/u).filter(Boolean));
    const optional = Boolean(match[4]);
    if (match[2]) {
      if (index !== parts.length - 1) warnings.push(`Rest parameter '${part.trim()}' is not final and was kept as unknown`);
      if (optional || modifiers.size > 0) warnings.push(`Rest parameter '${part.trim()}' cannot be optional or declare a parameter property`);
      const element = parseRestElementType(match[5] ?? "unknown", (value) => parse(value, "to-js"));
      if (element && index === parts.length - 1 && !optional && modifiers.size === 0) rest = element;
      else rest = unsupportedType;
      continue;
    }
    const sourceType = match[5] ?? "unknown";
    const parameterType = parse(sourceType, "to-js");
    types.push(parameterType);
    if (!optional && optionalSeen) {
      warnings.push(`Required constructor parameter '${part.trim()}' follows an optional parameter`);
    }
    if (!optional && !optionalSeen) required += 1;
    if (optional) optionalSeen = true;
    if (modifiers.has("readonly") || modifiers.has("public")) {
      const mutable = !modifiers.has("readonly");
      if (optional && mutable) warnings.push(`Optional mutable parameter property '${match[3]}' has no exact VelarScript field contract`);
      const fieldType = parse(sourceType, mutable ? "invariant" : "from-js");
      fields.set(match[3]!, { mutable, type: optional ? optionalOf(fieldType) : fieldType });
    }
  }
  return { types, required, ...(rest ? { rest } : {}), fields };
}

function parseTsType(
  source: string,
  aliases: ReadonlyMap<string, string>,
  warnings: string[],
  stack: ReadonlySet<string>,
  classTypes: ReadonlyMap<string, ValueType> = new Map(),
  direction: DeclarationDirection = "from-js",
): ValueType {
  let value = source.trim();
  while (value.startsWith("(") && value.endsWith(")") && balanced(value.slice(1, -1))) value = value.slice(1, -1).trim();
  if (/^readonly\s+/u.test(value)) {
    const inner = value.replace(/^readonly\s+/u, "");
    if (inner.endsWith("[]")) {
      return readonlyViewOf({
        kind: "list",
        element: parseTsType(inner.slice(0, -2), aliases, warnings, stack, classTypes, direction),
      });
    }
    warnings.push(`Readonly TypeScript type '${value}' is outside the VelarScript declaration bridge and was kept as unknown`);
    return unsupportedType;
  }
  const union = splitTopLevel(value, "|");
  if (union.length > 1) {
    const hasNull = union.includes("null");
    const hasUndefined = union.includes("undefined");
    const members = union.filter((part) => part !== "null" && part !== "undefined").map((part) => parseTsType(part, aliases, warnings, stack, classTypes, direction));
    if (direction === "invariant" && hasUndefined) {
      warnings.push(`Type '${value}' admits JavaScript undefined in a writable position and was kept as unknown`);
      return unsupportedType;
    }
    if (members.length === 0) {
      if (hasNull || (hasUndefined && direction === "from-js")) return nullType;
      warnings.push(`Type '${value}' cannot be supplied from VelarScript and was kept as unknown`);
      return unsupportedType;
    }
    const type = unionOf(members);
    return hasNull || (hasUndefined && direction === "from-js") ? optionalOf(type) : type;
  }
  if (value.endsWith("[]")) return {
    kind: "list",
    element: parseTsType(value.slice(0, -2), aliases, warnings, stack, classTypes, "invariant"),
  };
  const generic = /^([A-Za-z_$][\w$]*)\s*<([\s\S]+)>$/u.exec(value);
  if (generic) {
    const arguments_ = splitTopLevel(generic[2] ?? "", ",");
    if (generic[1] === "Array") return {
      kind: "list",
      element: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, "invariant"),
    };
    if (generic[1] === "Set") return { kind: "set", element: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, "invariant") };
    if (generic[1] === "Map") return {
      kind: "map",
      key: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, "invariant"),
      value: parseTsType(arguments_[1] ?? "unknown", aliases, warnings, stack, classTypes, "invariant"),
    };
    if (generic[1] === "ReadonlyArray" || generic[1] === "ReadonlySet") {
      const element = parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, direction);
      return readonlyViewOf(generic[1] === "ReadonlyArray" ? { kind: "list", element } : { kind: "set", element });
    }
    if (generic[1] === "ReadonlyMap") return readonlyViewOf({
      kind: "map",
      key: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, direction),
      value: parseTsType(arguments_[1] ?? "unknown", aliases, warnings, stack, classTypes, direction),
    });
    if (generic[1] === "Promise") return { kind: "promise", value: parseTsType(arguments_[0] ?? "unknown", aliases, warnings, stack, classTypes, direction) };
    if (generic[1] === "Record") {
      warnings.push("TypeScript Record is a plain JavaScript object, not a VelarScript Map, and was kept as unknown");
      return unsupportedType;
    }
    warnings.push(`Generic type '${generic[1]}' is outside the VelarScript declaration bridge and was kept as unknown`);
    return unsupportedType;
  }
  const arrow = /^\(([^()]*)\)\s*=>\s*(.+)$/u.exec(value);
  if (arrow) {
    const parameters = parseParameters(arrow[1] ?? "", (part) => parseTsType(part, aliases, warnings, stack, classTypes, oppositeDirection(direction)), warnings);
    if (parameters.invalid) return unsupportedType;
    const resultSource = arrow[2] ?? "unknown";
    return {
      kind: "function",
      parameters: parameters.types,
      requiredParameters: parameters.required,
      ...(parameters.rest ? { rest: parameters.rest } : {}),
      result: resultSource.trim() === "void" ? nullType : parseTsType(resultSource, aliases, warnings, stack, classTypes, direction),
    };
  }
  if (value.startsWith("{") && value.endsWith("}")) return objectType(value.slice(1, -1), aliases, warnings, stack, classTypes, direction);
  if (/^['"`]/u.test(value)) {
    if (direction === "from-js") return stringType;
    warnings.push(`String literal type '${value}' cannot be widened safely in an input position and was kept as unknown`);
    return unsupportedType;
  }
  if (/^-?\d/u.test(value)) {
    if (direction === "from-js") return numberType;
    warnings.push(`Numeric literal type '${value}' cannot be widened safely in an input position and was kept as unknown`);
    return unsupportedType;
  }
  if (value === "true" || value === "false") {
    if (direction === "from-js") return boolType;
    warnings.push(`Boolean literal type '${value}' cannot be widened safely in an input position and was kept as unknown`);
    return unsupportedType;
  }
  if (value === "string") return stringType;
  if (value === "number") return numberType;
  if (value === "boolean") return boolType;
  if (value === "void") {
    if (direction === "from-js") return nullType;
    warnings.push("TypeScript void cannot be supplied explicitly from VelarScript and was kept as unknown");
    return unsupportedType;
  }
  if (value === "null") return nullType;
  if (value === "undefined") {
    if (direction === "from-js") return nullType;
    warnings.push("TypeScript undefined cannot be supplied explicitly from VelarScript and was kept as unknown");
    return unsupportedType;
  }
  if (value === "unknown") return unknownType;
  if (value === "object") {
    if (direction === "from-js") return unknownType;
    warnings.push("TypeScript object cannot be represented precisely in a VelarScript input position and was kept as unknown");
    return unsupportedType;
  }
  if (value === "any") {
    warnings.push("TypeScript 'any' is kept as unknown at the safe JavaScript boundary");
    return unknownType;
  }
  const classType = classTypes.get(value);
  if (classType) return classType;
  const alias = aliases.get(value);
  if (alias && !stack.has(value)) return parseTsType(alias, aliases, warnings, new Set([...stack, value]), classTypes, direction);
  if (alias) warnings.push(`Recursive declaration '${value}' is outside the VelarScript declaration bridge and was kept as unknown`);
  else warnings.push(`TypeScript type '${value}' is outside the VelarScript declaration bridge and was kept as unknown`);
  return unsupportedType;
}

function objectType(source: string, aliases: ReadonlyMap<string, string>, warnings: string[], stack: ReadonlySet<string>, classTypes: ReadonlyMap<string, ValueType>, direction: DeclarationDirection): ValueType {
  const fields = new Map<string, ValueType>();
  const readonlyFields = new Set<string>();
  const optionalFields = new Set<string>();
  let invalidInputShape = false;
  for (const part of splitFields(source)) {
    const match = /^(readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/u.exec(part.trim());
    if (match) {
      const name = match[2]!;
      const type = parseTsType(match[4] ?? "unknown", aliases, warnings, stack, classTypes, match[1] ? direction : "invariant");
      setObjectField(fields, name, type, warnings);
      if (match[1]) readonlyFields.add(name);
      if (match[3]) optionalFields.add(name);
      continue;
    }
    const method = readMethodSignature(part.trim());
    if (method) {
      const parameters = parseParameters(method.parameters, (value) => parseTsType(value, aliases, warnings, stack, classTypes, oppositeDirection(direction)), warnings);
      const type: ValueType = parameters.invalid ? unsupportedType : {
        kind: "function",
        parameters: parameters.types,
        requiredParameters: parameters.required,
        ...(parameters.rest ? { rest: parameters.rest } : {}),
        result: method.result.trim() === "void" ? nullType : parseTsType(method.result, aliases, warnings, stack, classTypes, direction),
      };
      setObjectField(fields, method.name, type, warnings);
      if (method.optional) optionalFields.add(method.name);
      continue;
    }
    if (part.trim()) {
      warnings.push(`Unsupported object field '${part.trim()}' was ignored`);
      invalidInputShape ||= direction !== "from-js";
    }
  }
  if (invalidInputShape) return unsupportedType;
  return {
    kind: "object",
    fields,
    ...(readonlyFields.size > 0 ? { readonlyFields } : {}),
    ...(optionalFields.size > 0 ? { optionalFields } : {}),
  };
}

function setObjectField(fields: Map<string, ValueType>, name: string, type: ValueType, warnings: string[]): void {
  if (fields.has(name)) {
    warnings.push(`Overloaded or duplicate object member '${name}' was kept as unknown`);
    fields.set(name, unsupportedType);
  } else fields.set(name, type);
}

function readFunctionSignature(source: string, start: number): { readonly generic: boolean; readonly parameters: string; readonly result: string } | null {
  let cursor = skipWhitespace(source, start);
  let generic = false;
  if (source[cursor] === "<") {
    const end = matchingDelimiter(source, cursor, "<", ">");
    if (end < 0) return null;
    generic = true;
    cursor = skipWhitespace(source, end + 1);
  }
  if (source[cursor] !== "(") return null;
  const close = matchingDelimiter(source, cursor, "(", ")");
  if (close < 0) return null;
  const parameters = source.slice(cursor + 1, close);
  cursor = skipWhitespace(source, close + 1);
  if (source[cursor] !== ":") return null;
  const end = topLevelTerminator(source, cursor + 1, ";");
  if (end < 0) return null;
  const result = source.slice(cursor + 1, end).trim();
  return result ? { generic, parameters, result } : null;
}

function readMethodSignature(source: string): { readonly name: string; readonly optional: boolean; readonly parameters: string; readonly result: string } | null {
  const prefix = /^([A-Za-z_$][\w$]*)(\?)?\s*/u.exec(source);
  if (!prefix) return null;
  const open = prefix[0].length;
  if (source[open] !== "(") return null;
  const close = matchingDelimiter(source, open, "(", ")");
  if (close < 0) return null;
  const colon = skipWhitespace(source, close + 1);
  if (source[colon] !== ":") return null;
  const result = source.slice(colon + 1).trim();
  return result ? { name: prefix[1]!, optional: Boolean(prefix[2]), parameters: source.slice(open + 1, close), result } : null;
}

function readAccessorSignature(source: string): {
  readonly modifiers: readonly string[];
  readonly kind: "get" | "set";
  readonly name: string;
  readonly type: string;
} | null {
  const prefix = /^((?:(?:public|static|override)\s+)*)(get|set)\s+([A-Za-z_$][\w$]*)\s*/u.exec(source);
  if (!prefix) return null;
  const open = prefix[0].length;
  if (source[open] !== "(") return null;
  const close = matchingDelimiter(source, open, "(", ")");
  if (close < 0) return null;
  const parameters = source.slice(open + 1, close).trim();
  const tail = source.slice(close + 1).trim();
  if (prefix[2] === "get") {
    const result = /^:\s*(.+)$/u.exec(tail);
    if (parameters || !result) return null;
    return {
      modifiers: (prefix[1] ?? "").trim().split(/\s+/u).filter(Boolean),
      kind: "get",
      name: prefix[3]!,
      type: result[1]!,
    };
  }
  const parameter = /^[A-Za-z_$][\w$]*\s*:\s*(.+)$/u.exec(parameters);
  if (!parameter || tail) return null;
  return {
    modifiers: (prefix[1] ?? "").trim().split(/\s+/u).filter(Boolean),
    kind: "set",
    name: prefix[3]!,
    type: parameter[1]!,
  };
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function matchingDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  return -1;
}

function topLevelTerminator(source: string, start: number, terminator: string): number {
  let round = 0;
  let square = 0;
  let brace = 0;
  let angle = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") quote = character;
    else if (character === "(") round += 1;
    else if (character === ")") round = Math.max(0, round - 1);
    else if (character === "[") square += 1;
    else if (character === "]") square = Math.max(0, square - 1);
    else if (character === "{") brace += 1;
    else if (character === "}") brace = Math.max(0, brace - 1);
    else if (character === "<") angle += 1;
    else if (character === ">") angle = Math.max(0, angle - 1);
    else if (character === terminator && round === 0 && square === 0 && brace === 0 && angle === 0) return index;
  }
  return -1;
}

function splitFields(source: string): string[] {
  const semicolons = splitTopLevel(source, ";");
  return topLevelTerminator(source, 0, ";") >= 0 ? semicolons : source.split(/\n+/u);
}

function splitTopLevel(source: string, separator: string): string[] {
  const output: string[] = [];
  let start = 0;
  let angle = 0;
  let round = 0;
  let brace = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "<") angle += 1;
    else if (character === ">") angle = Math.max(0, angle - 1);
    else if (character === "(") round += 1;
    else if (character === ")") round = Math.max(0, round - 1);
    else if (character === "{") brace += 1;
    else if (character === "}") brace = Math.max(0, brace - 1);
    else if (character === separator && angle === 0 && round === 0 && brace === 0) {
      output.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(source.slice(start).trim());
  return output.filter(Boolean);
}

function balanced(value: string): boolean {
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function exportedTypes(value: unknown, subpath: string): string | null {
  const selected = selectPackageExport(value, subpath);
  return selected ? findTypesTarget(selected.value, selected.wildcard) : null;
}

function selectPackageExport(value: unknown, subpath: string): { readonly value: unknown; readonly wildcard: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return subpath === "." ? { value, wildcard: null } : null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.some(([key]) => key.startsWith("."))) return subpath === "." ? { value, wildcard: null } : null;
  const exact = entries.find(([key]) => key === subpath);
  if (exact) return { value: exact[1], wildcard: null };
  const patterns = entries.flatMap(([key, target]) => {
    const star = key.indexOf("*");
    if (star < 0 || star !== key.lastIndexOf("*")) return [];
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < prefix.length + suffix.length) return [];
    return [{ target, prefix, suffix, wildcard: subpath.slice(prefix.length, subpath.length - suffix.length) }];
  }).sort((left, right) => right.prefix.length - left.prefix.length || right.suffix.length - left.suffix.length);
  const match = patterns[0];
  return match ? { value: match.target, wildcard: match.wildcard } : null;
}

function findTypesTarget(value: unknown, wildcard: string | null): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTypesTarget(item, wildcard);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const conditions = value as Record<string, unknown>;
  if (Object.hasOwn(conditions, "types")) {
    const found = firstStringTarget(conditions.types, wildcard);
    if (found) return found;
  }
  const preferred = ["import", "browser", "node", "default", "require"];
  for (const key of [...preferred, ...Object.keys(conditions).filter((key) => key !== "types" && !preferred.includes(key))]) {
    if (!Object.hasOwn(conditions, key)) continue;
    const found = findTypesTarget(conditions[key], wildcard);
    if (found) return found;
  }
  return null;
}

function firstStringTarget(value: unknown, wildcard: string | null): string | null {
  if (typeof value === "string") return wildcard === null ? value : value.replaceAll("*", wildcard);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringTarget(item, wildcard);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const conditions = value as Record<string, unknown>;
  for (const key of ["import", "browser", "node", "default", "require", ...Object.keys(conditions)]) {
    if (!Object.hasOwn(conditions, key)) continue;
    const found = firstStringTarget(conditions[key], wildcard);
    if (found) return found;
  }
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function packageNameOf(source: string): string {
  const parts = source.split("/");
  return source.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? source;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
