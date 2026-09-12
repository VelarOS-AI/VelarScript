import { dirname, extname, relative, resolve } from "node:path";
import type { CompilerExtension, GenericTypeInfo, ModuleInspection, ModuleInterface, ValueType } from "@velarscript/compiler";
import { standardModuleInterface } from "../../standard-modules.ts";
import { packageStableModulePath, rebaseModuleInterfaceIdentities } from "../../library-artifact.ts";
import { projectImportKey, type LoadedModule, type ProjectCompilation } from "../options.ts";
import { forwardedRuntimeTypeExport, ownRuntimeTypeExports, publishedRuntimeTypeExports, reachableRuntimeTypeIdentities } from "./runtime-types.ts";
import { expandKnownAliases, mapClassInfo, renameClass, renameType, resolveKnownNominals } from "../types.ts";

/**
 * The module's own interface as the mutable tables the merge below writes into,
 * with every identity-keyed alias of a locally declared type already present.
 * The caller spreads them back over `own`, so the resolved interface keeps the
 * key order the inspection published.
 */
function ownInterfaceTables(own: ModuleInspection["moduleInterface"]) {
  const exports = new Map(own.exports);
  const runtimeTypeExports = ownRuntimeTypeExports(own);
  const mutableExports = new Set(own.mutableExports);
  const reactiveExports = new Map(own.reactiveExports);
  const namedTypes = new Map(own.namedTypes);
  const namedTypeReadonlyFields = new Map(own.namedTypeReadonlyFields ?? []);
  const namedTypeIdentities = new Map(own.namedTypeIdentities);
  const namedTypeBases = new Map(own.namedTypeBases ?? []);
  const genericTypes = new Map(own.genericTypes ?? []);
  const typeAliases = new Map(own.typeAliases);
  const enums = new Map(own.enums);
  const classes = new Map(own.classes);
  for (const info of own.genericTypes?.values() ?? []) genericTypes.set(info.identity, info);
  for (const [name, identity] of own.namedTypeIdentities) {
    const fields = own.namedTypes.get(name);
    if (fields) namedTypes.set(identity, fields);
    const readonlyFields = own.namedTypeReadonlyFields?.get(name);
    if (readonlyFields) namedTypeReadonlyFields.set(identity, readonlyFields);
    const base = own.namedTypeBases?.get(name);
    if (base) namedTypeBases.set(identity, base);
  }
  for (const info of own.enums.values()) enums.set(info.identity, info);
  for (const info of own.classes.values()) if (info.identity) classes.set(info.identity, info);
  const extensionExports = new Map([...own.extensionExports].map(([id, values]) => [id, new Map(values)] as const));
  return {
    exports,
    runtimeTypeExports,
    mutableExports,
    reactiveExports,
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    namedTypeBases,
    genericTypes,
    typeAliases,
    enums,
    classes,
    extensionExports,
  };
}

/** The tables one resolution pass accumulates, named once so each phase takes one parameter. */
type InterfaceTables = ReturnType<typeof ownInterfaceTables>;

/** The interface behind one dependency: an artifact, a standard module, or a resolved source module. */
export function dependencyModuleInterface(
  dependency: ModuleInspection["dependencies"][number],
  module: LoadedModule,
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  artifactInterfaces: ReadonlyMap<string, ModuleInterface>,
  cache: Map<string, ModuleInspection["moduleInterface"]>,
  compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>,
  compilerExtensions: readonly CompilerExtension[],
): ModuleInspection["moduleInterface"] | null {
  const declared = artifactInterfaces.get(projectImportKey(module.inputPath, dependency.source))
    ?? standardModuleInterface(dependency.source, compilerExtensions);
  if (declared) return declared;
  const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
    ? resolve(dirname(module.inputPath), dependency.source)
    : velarImports.get(projectImportKey(module.inputPath, dependency.source));
  const target = targetPath ? loaded.get(targetPath) : null;
  if (!target) return null;
  return resolvedModuleInterface(target, loaded, velarImports, artifactInterfaces, cache, compiledInterfaces, compilerExtensions);
}

/** One dependency's contribution to the importing module's resolved interface. */
function mergeDependencyInterface(
  dependency: ModuleInspection["dependencies"][number],
  dependencyInterface: ModuleInspection["moduleInterface"],
  tables: InterfaceTables,
): void {
  const { exports, mutableExports, reactiveExports, namedTypes, namedTypeReadonlyFields } = tables;
  const { namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionExports } = tables;
  for (const [identity, imported] of publishedRuntimeTypeExports(dependencyInterface)) {
    if (!tables.runtimeTypeExports.has(identity)) tables.runtimeTypeExports.set(identity, forwardedRuntimeTypeExport(dependency.source, imported));
  }
  const aliases = new Map(dependency.specifiers
    .filter((specifier) => !specifier.namespace && specifier.imported !== "default")
    .map((specifier) => [specifier.imported, specifier.local]));
  const dependencyTypeIdentities = new Set(dependencyInterface.namedTypeIdentities.values());
  for (const [name, fields] of dependencyInterface.namedTypes) {
    const identity = dependencyInterface.namedTypeIdentities.get(name) ?? (dependencyTypeIdentities.has(name) ? name : null);
    if (!identity) continue;
    const renamedFields = new Map([...fields].map(([field, type]) => [field, renameType(type, aliases)]));
    if (!namedTypes.has(identity)) namedTypes.set(identity, renamedFields);
    if (!namedTypeIdentities.has(identity)) namedTypeIdentities.set(identity, identity);
    const readonlyFields = dependencyInterface.namedTypeReadonlyFields?.get(name)
      ?? dependencyInterface.namedTypeReadonlyFields?.get(identity);
    if (readonlyFields && !namedTypeReadonlyFields.has(identity)) namedTypeReadonlyFields.set(identity, readonlyFields);
    const localName = aliases.get(name);
    if (localName && dependencyInterface.exports.has(name)) {
      namedTypes.set(localName, renamedFields);
      if (readonlyFields) namedTypeReadonlyFields.set(localName, readonlyFields);
      namedTypeIdentities.set(localName, identity);
    }
  }
  for (const [name, base] of dependencyInterface.namedTypeBases ?? []) {
    const identity = dependencyInterface.namedTypeIdentities.get(name) ?? (dependencyTypeIdentities.has(name) ? name : null);
    if (!identity) continue;
    const renamedBase = renameType(base, aliases);
    if (!namedTypeBases.has(identity)) namedTypeBases.set(identity, renamedBase);
    const localName = aliases.get(name);
    if (localName && dependencyInterface.exports.has(name)) namedTypeBases.set(localName, renamedBase);
  }
  // D55 rule 120: a re-exported generic record travels with the barrel that
  // re-exports it, under the name the barrel gives it.
  for (const [name, info] of dependencyInterface.genericTypes ?? []) {
    const template: GenericTypeInfo = { ...info, fields: new Map([...info.fields].map(([field, type]) => [field, renameType(type, aliases)])) };
    if (!genericTypes.has(info.identity)) genericTypes.set(info.identity, template);
    const localName = aliases.get(name);
    if (localName && dependencyInterface.exports.has(name)) genericTypes.set(localName, template);
  }
  for (const [name, type] of dependencyInterface.typeAliases) {
    const localName = aliases.get(name);
    if (localName && dependencyInterface.exports.has(name) && !typeAliases.has(localName)) {
      typeAliases.set(localName, renameType(type, aliases));
    }
  }
  for (const [name, members] of dependencyInterface.enums) {
    if (!enums.has(members.identity)) enums.set(members.identity, members);
    const localName = aliases.get(name);
    if (localName && dependencyInterface.exports.has(name)) enums.set(localName, members);
  }
  for (const [name, info] of dependencyInterface.classes) {
    const renamed = renameClass(info, aliases);
    if (renamed.identity && !classes.has(renamed.identity)) classes.set(renamed.identity, renamed);
    const localName = aliases.get(name);
    if (localName && dependencyInterface.exports.has(name)) classes.set(localName, renamed);
  }
  if (dependency.reExport) {
    // Re-exported names become part of this module's own interface under
    // their aliases; live-export mutability and reactivity flags propagate.
    for (const specifier of dependency.specifiers) {
      const type = dependencyInterface.exports.get(specifier.imported);
      if (type) exports.set(specifier.local, renameType(type, aliases));
      if (dependencyInterface.mutableExports.has(specifier.imported)) mutableExports.add(specifier.local);
      const reactive = dependencyInterface.reactiveExports.get(specifier.imported);
      if (reactive) reactiveExports.set(specifier.local, reactive);
    }
    for (const [extensionId, values] of dependencyInterface.extensionExports) {
      const target = extensionExports.get(extensionId) ?? new Map<string, unknown>();
      for (const specifier of dependency.specifiers) {
        const value = values.get(specifier.imported);
        if (value !== undefined) target.set(specifier.local, value);
      }
      if (target.size > 0) extensionExports.set(extensionId, target);
    }
  }
}

/**
 * The nominal tail: every table entry is rewritten through the aliases and
 * nominal identities this module now knows, so an exported signature means the
 * same type here as it did where it was declared.
 */
function resolveInterfaceNominals(tables: InterfaceTables): void {
  const { exports, namedTypes, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes } = tables;
  const enumNames = enums;
  const resolveType = (type: ValueType): ValueType => resolveKnownNominals(
    expandKnownAliases(type, typeAliases),
    classes,
    enumNames,
    namedTypeIdentities,
    genericTypes,
  );
  for (const [name, type] of exports) exports.set(name, resolveType(type));
  for (const [name, fields] of namedTypes) {
    namedTypes.set(name, new Map([...fields].map(([field, type]) => [field, resolveType(type)])));
  }
  for (const [name, base] of namedTypeBases) namedTypeBases.set(name, resolveType(base));
  for (const [name, type] of typeAliases) typeAliases.set(name, resolveType(type));
  for (const [name, info] of classes) {
    classes.set(name, mapClassInfo(
      info,
      resolveType,
      (base) => classes.get(base)?.identity ?? base,
    ));
  }
}

export function resolvedModuleInterface(
  module: LoadedModule,
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  artifactInterfaces: ReadonlyMap<string, ModuleInterface>,
  cache: Map<string, ModuleInspection["moduleInterface"]>,
  compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>,
  compilerExtensions: readonly CompilerExtension[],
): ModuleInspection["moduleInterface"] {
  const cached = cache.get(module.inputPath);
  if (cached) return cached;
  const rawOwn = compiledInterfaces.get(module.inputPath) ?? module.inspection.moduleInterface;
  const own = module.package === null ? rawOwn : stableSourcePackageInterface(module, rawOwn, loaded);
  const tables = ownInterfaceTables(own);
  const resolved: ModuleInspection["moduleInterface"] = { ...own, ...tables };
  cache.set(module.inputPath, resolved);

  const dependencies = [...module.inspection.dependencies].sort((left, right) => Number(!!left.dynamic) - Number(!!right.dynamic));
  for (const dependency of dependencies) {
    if (dependency.javascript) continue;
    const dependencyInterface = dependencyModuleInterface(
      dependency, module, loaded, velarImports, artifactInterfaces, cache, compiledInterfaces, compilerExtensions);
    if (!dependencyInterface) continue;
    mergeDependencyInterface(dependency, dependencyInterface, tables);
  }

  resolveInterfaceNominals(tables);
  const ownRuntimeTypes = ownRuntimeTypeExports(own);
  const reachable = reachableRuntimeTypeIdentities(resolved);
  for (const identity of tables.runtimeTypeExports.keys()) {
    if (!ownRuntimeTypes.has(identity) && !reachable.has(identity)) tables.runtimeTypeExports.delete(identity);
  }
  return resolved;
}

/**
 * Source fallback and frozen artifacts must agree on nominal identities.
 * Absolute installation paths would make one record or class a different
 * type on every machine and would leak a publisher path into the artifact.
 */
export function stableSourcePackageInterface(
  module: LoadedModule,
  interface_: ModuleInterface,
  loaded: ReadonlyMap<string, LoadedModule>,
): ModuleInterface {
  if (module.package === null) return interface_;
  return rebaseModuleInterfaceIdentities(interface_, [...loaded.values()].flatMap((candidate) => {
    const owner = candidate.package;
    if (owner === null) return [];
    return [{
      physical: candidate.inputPath,
      logical: packageStableModulePath(owner.name, owner.version, relative(owner.root, candidate.inputPath)),
    }];
  }));
}

/**
 * Phase four: every public barrel resolved after the final SCC pass. A frozen
 * library serializes this map, so source mode and artifact mode expose the same
 * flattened contract even when the package entry only re-exports names. The
 * dependency-first groups are walked again rather than recursed from the entry:
 * clearing the cache and starting there would consume one host frame per module
 * while resolving a legal 3000-module line.
 */
export function resolveProjectModuleInterfaces(
  compilation: ProjectCompilation,
  compilationGroups: readonly (readonly LoadedModule[])[],
  compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>,
): Map<string, ModuleInterface> {
  const { loaded, velarImports, velarArtifactInterfaces, interfaceCache, compilerExtensions } = compilation;
  interfaceCache.clear();
  const moduleInterfaces = new Map<string, ModuleInterface>();
  for (const group of compilationGroups) {
    for (const module of group) {
      moduleInterfaces.set(module.inputPath, resolvedModuleInterface(
        module,
        loaded,
        velarImports,
        velarArtifactInterfaces,
        interfaceCache,
        compiledInterfaces,
        compilerExtensions,
      ));
    }
  }
  return moduleInterfaces;
}
