import { dirname, extname, resolve } from "node:path";
import {
  invalidType,
  type AnalysisContext,
  type ClassInfo,
  type CompilerExtension,
  type EnumInfo,
  type GenericTypeInfo,
  type ModuleInspection,
  type ModuleInterface,
  type ValueType,
} from "@velarscript/compiler";
import { pushMissingExport } from "../../module-resolution-messages.ts";
import { standardModuleInterface, standardModuleInterfaces } from "../../standard-modules.ts";
import { loadTypeScriptDeclarations, type TypeScriptDeclarationBridge } from "../../typescript-declarations.ts";
import { projectImportKey, type LoadedModule } from "../options.ts";
import { renameClass, renameType, resolveKnownNominals } from "../types.ts";
import { dependencyModuleInterface, resolvedModuleInterface } from "./resolution.ts";
import { collectTypeIdentities, forwardedRuntimeTypeExport, ownRuntimeTypeExports, publishedRuntimeTypeExports, missingArtifactRuntimeTypes } from "./runtime-types.ts";
import type { ProjectFailure, ProjectNotice } from "../../project.ts";

/** The eleven inputs one module's analysis reads, named once so each phase takes one parameter. */
interface AnalysisSources {
  readonly module: LoadedModule;
  readonly loaded: ReadonlyMap<string, LoadedModule>;
  readonly velarImports: ReadonlyMap<string, string>;
  readonly artifactInterfaces: ReadonlyMap<string, ModuleInterface>;
  readonly failures: ProjectFailure[];
  readonly notices: ProjectNotice[];
  readonly declarationCache: Map<string, Promise<TypeScriptDeclarationBridge | null>>;
  readonly externalTypeDependencies: Map<string, Set<string>>;
  readonly interfaceCache: Map<string, ModuleInspection["moduleInterface"]>;
  readonly compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>;
  readonly compilerExtensions: readonly CompilerExtension[];
  /**
   * D114 F10-node, audit NO-I3: the specifiers of this module that the graph
   * walk already answered for, so what they imported is poisoned rather than
   * left to be discovered a second time at every use.
   */
  readonly unresolvedSpecifiers: ReadonlySet<string>;
}

/** The thirteen tables the dependency merge writes, opened empty for one module. */
function analysisTables() {
  const imports = new Map<string, ValueType>();
  const dynamicImports = new Map<string, ValueType>();
  const reactiveImports = new Map<string, "state">();
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  const namedTypeReadonlyFields = new Map<string, ReadonlySet<string>>();
  const namedTypeIdentities = new Map<string, string>();
  const namedTypeBases = new Map<string, ValueType>();
  const genericTypes = new Map<string, GenericTypeInfo>();
  const typeAliases = new Map<string, ValueType>();
  const enums = new Map<string, EnumInfo>();
  const classes = new Map<string, ClassInfo>();
  const extensionImports = new Map<string, Map<string, unknown>>();
  const extensionModules = new Map<string, unknown[]>();
  return {
    imports,
    dynamicImports,
    reactiveImports,
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    namedTypeBases,
    genericTypes,
    typeAliases,
    enums,
    classes,
    extensionImports,
    extensionModules,
  };
}

type AnalysisTables = ReturnType<typeof analysisTables>;

/** Extension module data travels project-wide, so it is collected before any dependency is read. */
function collectExtensionModules(
  extensionModules: Map<string, unknown[]>,
  loaded: ReadonlyMap<string, LoadedModule>,
  artifactInterfaces: ReadonlyMap<string, ModuleInterface>,
): void {
  for (const loadedModule of loaded.values()) {
    for (const [extensionId, data] of loadedModule.inspection.moduleInterface.extensionData) {
      const values = extensionModules.get(extensionId) ?? [];
      values.push(data);
      extensionModules.set(extensionId, values);
    }
  }
  for (const interface_ of new Set(artifactInterfaces.values())) {
    for (const [extensionId, data] of interface_.extensionData) {
      const values = extensionModules.get(extensionId) ?? [];
      values.push(data);
      extensionModules.set(extensionId, values);
    }
  }
}

/** A dynamic import contributes its exports as one object type plus its hidden type metadata. */
function importDynamicDependency(
  dependency: ModuleInspection["dependencies"][number],
  sources: AnalysisSources,
  tables: AnalysisTables,
): void {
  const { module, loaded, velarImports, artifactInterfaces, failures, interfaceCache, compiledInterfaces, compilerExtensions } = sources;
  const { dynamicImports, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes } = tables;
  const artifact = artifactInterfaces.get(projectImportKey(module.inputPath, dependency.source));
  const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
    ? resolve(dirname(module.inputPath), dependency.source)
    : velarImports.get(projectImportKey(module.inputPath, dependency.source));
  const target = targetPath ? loaded.get(targetPath) : null;
  const interface_ = artifact
    ?? (target ? resolvedModuleInterface(target, loaded, velarImports, artifactInterfaces, interfaceCache, compiledInterfaces, compilerExtensions) : null);
  if (!interface_) return;
  if (interface_.reactiveExports.size > 0) {
    failures.push({
      path: module.inputPath,
      message: `Dynamically imported module '${dependency.source}' exports reactive values; expose behavior through functions or components instead`,
    });
  }
  dynamicImports.set(dependency.source, {
    kind: "object",
    fields: new Map(interface_.exports),
    readonlyFields: new Set(interface_.exports.keys()),
  });
  importHiddenTypeMetadata(interface_, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
  importReachableStandardTypeMetadata(interface_, compilerExtensions, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
}

/** BRG: a JavaScript dependency's TypeScript declarations, renamed into this module's names. */
async function importJavaScriptDeclarations(
  dependency: ModuleInspection["dependencies"][number],
  sources: AnalysisSources,
  tables: AnalysisTables,
): Promise<void> {
  const { module, notices, declarationCache, externalTypeDependencies } = sources;
  const { imports, classes } = tables;
  // A manual extern module owns the source contract completely, so the
  // automatic TypeScript-declaration probe stays silent for that source.
  if (dependency.unsafe || dependency.externOwned) return;
  const key = projectImportKey(module.inputPath, dependency.source);
  let pending = declarationCache.get(key);
  if (!pending) {
    pending = loadTypeScriptDeclarations(dependency.source, module.inputPath);
    declarationCache.set(key, pending);
  }
  const declarations = await pending;
  if (!declarations) return;
  for (const path of declarations.dependencies) {
    const importers = externalTypeDependencies.get(path) ?? new Set<string>();
    importers.add(module.inputPath);
    externalTypeDependencies.set(path, importers);
  }
  for (const warning of declarations.warnings) {
    notices.push({ path: module.inputPath, message: `${dependency.source}: ${warning}` });
  }
  // BRG-U3: the broken-types notice is the whole story; per-name
  // "declaration has no export" noise would blame the import lines for
  // the package's defect.
  if (declarations.unreadableDeclaredTypes) return;
  const aliases = new Map(dependency.specifiers
    .filter((specifier) => !specifier.namespace)
    .map((specifier) => [specifier.imported, specifier.local]));
  for (const [identity, info] of declarations.classRegistry) classes.set(identity, info);
  for (const [name, info] of declarations.classes) {
    const renamed = renameClass(info, aliases);
    const localName = aliases.get(name) ?? name;
    classes.set(localName, renamed);
    if (info.identity) classes.set(info.identity, renamed);
  }
  for (const specifier of dependency.specifiers) {
    if (specifier.namespace) {
      const fields = new Map([...declarations.exports].map(([name, type]) => [name, renameType(type, aliases)]));
      imports.set(specifier.local, { kind: "object", fields, readonlyFields: new Set(fields.keys()) });
      continue;
    }
    const type = declarations.exports.get(specifier.imported);
    if (!type) notices.push({ path: module.inputPath, message: `${dependency.source}: declaration has no export '${specifier.imported}'` });
    imports.set(specifier.local, type ? renameType(type, aliases) : { kind: "unknown" });
  }
}

/**
 * D114 F10-node, audit NO-I3: a specifier that resolved to nothing binds the
 * error type, which poisons nothing downstream.
 *
 * The graph walk has already written the one report the mistake earns — an
 * unknown standard module, a package that does not resolve, a file that is not
 * there — and the names it was supposed to import were then left to be
 * discovered as untyped JavaScript values, so `velar create --template node`
 * with `@velarscript/server` swapped for `@velarscript/node` answered VEL6003
 * *and* advised an `extern module` contract for `application`, a name the
 * language itself owns. This is the same treatment a name a resolved module
 * does not publish already gets, one step earlier.
 */
function poisonUnresolvedImport(
  dependency: ModuleInspection["dependencies"][number],
  sources: AnalysisSources,
  imports: Map<string, ValueType>,
): void {
  if (!sources.unresolvedSpecifiers.has(dependency.source)) return;
  for (const specifier of dependency.specifiers) imports.set(specifier.local, invalidType);
}

/** One dependency's contribution to the importing module's analysis context. */
async function importAnalysisDependency(
  dependency: ModuleInspection["dependencies"][number],
  sources: AnalysisSources,
  tables: AnalysisTables,
): Promise<void> {
  const { module, loaded, velarImports, artifactInterfaces, failures, interfaceCache, compiledInterfaces, compilerExtensions } = sources;
  const { imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases } = tables;
  const { genericTypes, typeAliases, enums, classes, extensionImports } = tables;
  if (dependency.dynamic) {
    importDynamicDependency(dependency, sources, tables);
    return;
  }
  if (dependency.reExport) {
    const interface_ = artifactInterfaces.get(projectImportKey(module.inputPath, dependency.source))
      ?? standardModuleInterface(dependency.source, compilerExtensions) ?? (() => {
      const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
        ? resolve(dirname(module.inputPath), dependency.source)
        : velarImports.get(projectImportKey(module.inputPath, dependency.source));
      const target = targetPath ? loaded.get(targetPath) : null;
      return target ? resolvedModuleInterface(target, loaded, velarImports, artifactInterfaces, interfaceCache, compiledInterfaces, compilerExtensions) : null;
    })();
    if (interface_) {
      for (const specifier of dependency.specifiers) {
        if (!interface_.exports.has(specifier.imported)) {
          pushMissingExport(failures, module.inputPath, dependency, specifier, interface_.exports.keys());
        }
      }
    }
    return;
  }
  if (dependency.javascript) {
    await importJavaScriptDeclarations(dependency, sources, tables);
    return;
  }
  const standard = standardModuleInterface(dependency.source, compilerExtensions);
  if (standard) {
    importInterface(module, dependency, standard, imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionImports, failures);
    importReachableStandardTypeMetadata(standard, compilerExtensions, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
    return;
  }
  const artifact = artifactInterfaces.get(projectImportKey(module.inputPath, dependency.source));
  if (artifact) {
    importInterface(module, dependency, artifact, imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionImports, failures);
    importReachableStandardTypeMetadata(artifact, compilerExtensions, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
    return;
  }
  const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
    ? resolve(dirname(module.inputPath), dependency.source)
    : velarImports.get(projectImportKey(module.inputPath, dependency.source));
  if (!targetPath) return poisonUnresolvedImport(dependency, sources, imports);
  const target = loaded.get(targetPath);
  if (!target) return poisonUnresolvedImport(dependency, sources, imports);
  const targetInterface = resolvedModuleInterface(target, loaded, velarImports, artifactInterfaces, interfaceCache, compiledInterfaces, compilerExtensions);
  importInterface(module, dependency, targetInterface, imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionImports, failures);
  // The same sink one step sideways: a project module can re-export a
  // signature returning a standard type it never declares either.
  importReachableStandardTypeMetadata(targetInterface, compilerExtensions, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
}

export async function createAnalysisContext(
  module: LoadedModule,
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  artifactInterfaces: ReadonlyMap<string, ModuleInterface>,
  failures: ProjectFailure[],
  notices: ProjectNotice[],
  declarationCache: Map<string, Promise<TypeScriptDeclarationBridge | null>>,
  externalTypeDependencies: Map<string, Set<string>>,
  interfaceCache: Map<string, ModuleInspection["moduleInterface"]>,
  compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>,
  compilerExtensions: readonly CompilerExtension[],
  unresolvedSpecifiers: ReadonlySet<string> = new Set(),
): Promise<AnalysisContext> {
  const sources: AnalysisSources = {
    module, loaded, velarImports, artifactInterfaces, failures, notices,
    declarationCache, externalTypeDependencies, interfaceCache, compiledInterfaces, compilerExtensions,
    unresolvedSpecifiers,
  };
  const tables = analysisTables();
  collectExtensionModules(tables.extensionModules, loaded, artifactInterfaces);
  for (const dependency of module.inspection.dependencies) {
    await importAnalysisDependency(dependency, sources, tables);
  }
  return { ...tables, ...runtimeTypeRoutes(sources), resources: module.resourceContents };
}

const standardRuntimeOwners = new WeakMap<readonly CompilerExtension[], ReadonlyMap<string, { source: string; exported: string }>>();

function standardRuntimeTypeOwners(extensions: readonly CompilerExtension[]): ReadonlyMap<string, { source: string; exported: string }> {
  const cached = standardRuntimeOwners.get(extensions);
  if (cached) return cached;
  const owners = new Map<string, { source: string; exported: string }>();
  for (const [source, interface_] of standardModuleInterfaces(extensions)) {
    for (const [identity, exported] of publishedRuntimeTypeExports(interface_)) {
      if (!owners.has(identity)) owners.set(identity, { source, exported });
    }
  }
  standardRuntimeOwners.set(extensions, owners);
  return owners;
}

/** Runtime validators follow existing dependency edges and preserve deferred imports. */
function runtimeTypeRoutes(sources: AnalysisSources): Pick<AnalysisContext, "runtimeTypeImports" | "runtimeTypeExports" | "runtimeTypeReExports" | "moduleNamespaceExports"> {
  const { module, loaded, velarImports, artifactInterfaces, interfaceCache, compiledInterfaces, compilerExtensions } = sources;
  const interface_ = resolvedModuleInterface(module, loaded, velarImports, artifactInterfaces, interfaceCache, compiledInterfaces, compilerExtensions);
  type RuntimeOwner = { source: string; exported: string; accessor?: boolean; dynamic?: boolean };
  const runtimeTypeImports = new Map<string, RuntimeOwner & { dynamic?: boolean; alternatives?: readonly RuntimeOwner[] }>();
  const runtimeTypeExports = new Map<string, string>();
  const runtimeTypeReExports: { source: string; imported: string; exported: string; accessor?: boolean; dynamic?: boolean; alternatives?: readonly RuntimeOwner[] }[] = [];
  const moduleNamespaceExports = new Map<string, readonly string[]>();
  const forwarded = new Set<string>();
  const own = ownRuntimeTypeExports(module.inspection.moduleInterface);
  const ownSymbols = new Set(own.values());
  for (const exported of own.values()) {
    const name = exported.slice("__velarRuntimeType_".length);
    runtimeTypeExports.set(name, exported);
  }
  // Prefer an eagerly linked route over a deferred route to the same identity,
  // so validation never depends on an otherwise unused dynamic import.
  const dependencies = [...module.inspection.dependencies].sort((left, right) => Number(!!left.dynamic) - Number(!!right.dynamic));
  const targets = dependencies.flatMap((dependency) => {
    if (dependency.javascript) return [];
    const target = dependencyModuleInterface(dependency, module, loaded, velarImports, artifactInterfaces,
      interfaceCache, compiledInterfaces, compilerExtensions);
    return target ? [{ dependency, target }] : [];
  });
  const availableOwners = new Map<string, RuntimeOwner[]>();
  for (const { dependency, target } of targets) {
    for (const [identity, exported] of publishedRuntimeTypeExports(target)) {
      const owners = availableOwners.get(identity) ?? [];
      owners.push({ source: dependency.source, exported, accessor: target.runtimeTypeExports?.has(identity) ?? false, dynamic: !!dependency.dynamic });
      availableOwners.set(identity, owners);
    }
  }
  for (const { dependency, target } of targets) {
    if (artifactInterfaces.has(projectImportKey(module.inputPath, dependency.source))) {
      const missing = missingArtifactRuntimeTypes(target, new Set(standardRuntimeTypeOwners(compilerExtensions).keys()));
      if (missing.length > 0) {
        const message = `Compiled library '${dependency.source}' does not publish Runtime Type validators for its public contract (${missing.join(", ")}); rebuild the library with the current toolchain using 'velar build-library'`;
        if (!sources.failures.some((failure) => failure.path === module.inputPath && failure.message === message)) sources.failures.push({ path: module.inputPath, message });
      }
    }
    moduleNamespaceExports.set(dependency.source, [...target.exports.keys()]);
    for (const [identity, imported] of publishedRuntimeTypeExports(target)) {
      const alternatives = availableOwners.get(identity)?.filter((owner) => owner.source !== dependency.source || owner.exported !== imported) ?? [];
      const route = { source: dependency.source, accessor: target.runtimeTypeExports?.has(identity) ?? false, dynamic: !!dependency.dynamic, alternatives };
      if (!runtimeTypeImports.has(identity)) runtimeTypeImports.set(identity, { ...route, exported: imported });
      // Inspection cannot infer every exported helper result yet. Emit the
      // available route now, so the analyzed public signature can advertise
      // it without requiring a second full compilation of this module.
      const candidate = forwardedRuntimeTypeExport(dependency.source, imported);
      const exported = interface_.runtimeTypeExports?.get(identity) ?? candidate;
      if (!ownSymbols.has(exported) && exported === candidate && !forwarded.has(identity)) {
        runtimeTypeReExports.push({ ...route, imported, exported });
        forwarded.add(identity);
      }
    }
  }
  // A public standard Type may be returned by a different standard module.
  // Its official public specifier is a stable runtime owner, never a private package path.
  for (const [identity, owner] of standardRuntimeTypeOwners(compilerExtensions)) {
    if (!runtimeTypeImports.has(identity)) runtimeTypeImports.set(identity, owner);
  }
  return { runtimeTypeImports, runtimeTypeExports, runtimeTypeReExports, moduleNamespaceExports };
}

function importHiddenTypeMetadata(
  interface_: ModuleInspection["moduleInterface"],
  namedTypes: Map<string, ReadonlyMap<string, ValueType>>,
  namedTypeReadonlyFields: Map<string, ReadonlySet<string>>,
  namedTypeBases: Map<string, ValueType>,
  genericTypes: Map<string, GenericTypeInfo>,
  enums: Map<string, EnumInfo>,
  classes: Map<string, ClassInfo>,
): void {
  // D55 rule 120: a dynamically imported module's generic records are reachable
  // through its exported signatures, so their templates travel with the rest of
  // the hidden metadata — keyed by identity, which is how a type reached
  // without a local name is found.
  for (const info of interface_.genericTypes?.values() ?? []) {
    if (!genericTypes.has(info.identity)) genericTypes.set(info.identity, info);
  }
  const identities = new Set(interface_.namedTypeIdentities.values());
  for (const [name, fields] of interface_.namedTypes) {
    const identity = interface_.namedTypeIdentities.get(name) ?? (identities.has(name) ? name : null);
    if (identity && !namedTypes.has(identity)) namedTypes.set(identity, fields);
    const readonlyFields = interface_.namedTypeReadonlyFields?.get(name) ?? (identity ? interface_.namedTypeReadonlyFields?.get(identity) : undefined);
    if (identity && readonlyFields && !namedTypeReadonlyFields.has(identity)) namedTypeReadonlyFields.set(identity, readonlyFields);
  }
  for (const [name, base] of interface_.namedTypeBases ?? []) {
    const identity = interface_.namedTypeIdentities.get(name) ?? (identities.has(name) ? name : null);
    if (identity && !namedTypeBases.has(identity)) namedTypeBases.set(identity, base);
  }
  for (const info of interface_.enums.values()) if (!enums.has(info.identity)) enums.set(info.identity, info);
  for (const info of interface_.classes.values()) {
    if (info.identity && !classes.has(info.identity)) classes.set(info.identity, info);
  }
}

const standardTypeOwnerIndexes = new WeakMap<
  readonly CompilerExtension[],
  ReadonlyMap<string, ModuleInspection["moduleInterface"]>
>();

/** Which standard module declares each standard type identity. */
function standardTypeOwners(
  extensions: readonly CompilerExtension[],
): ReadonlyMap<string, ModuleInspection["moduleInterface"]> {
  const cached = standardTypeOwnerIndexes.get(extensions);
  if (cached) return cached;
  const owners = new Map<string, ModuleInspection["moduleInterface"]>();
  for (const interface_ of standardModuleInterfaces(extensions).values()) {
    for (const identity of interface_.namedTypeIdentities.values()) if (!owners.has(identity)) owners.set(identity, interface_);
    for (const info of interface_.genericTypes?.values() ?? []) if (!owners.has(info.identity)) owners.set(info.identity, interface_);
    for (const info of interface_.enums.values()) if (!owners.has(info.identity)) owners.set(info.identity, interface_);
    for (const info of interface_.classes.values()) if (info.identity && !owners.has(info.identity)) owners.set(info.identity, interface_);
  }
  standardTypeOwnerIndexes.set(extensions, owners);
  return owners;
}

/**
 * A standard module's signatures routinely hand back a type another standard
 * module declares — `velar/fs`'s `readBytes` returns a `Bytes` owned by
 * `velar/binary`, `velar/serve`'s `Request.cancellation` is a `Cancellation`
 * owned by `velar/task`. The field table for such a type travels with its
 * declaring module, so importing only the module the author wrote left the
 * analyzer holding a named type it knew no members of, and it reported the
 * false fact that the type has no such field; adding an otherwise unused
 * import of the declaring module was the only way to make correct code
 * compile. Import the hidden metadata of every standard module reachable
 * through the imported module's own declared signatures instead.
 *
 * Only identity-keyed metadata travels, so nothing is bound to a local name
 * the author did not write — `Bytes` gains its members, and stays unspellable
 * until `velar/binary` is imported for real.
 */
function importReachableStandardTypeMetadata(
  interface_: ModuleInspection["moduleInterface"],
  extensions: readonly CompilerExtension[],
  namedTypes: Map<string, ReadonlyMap<string, ValueType>>,
  namedTypeReadonlyFields: Map<string, ReadonlySet<string>>,
  namedTypeBases: Map<string, ValueType>,
  genericTypes: Map<string, GenericTypeInfo>,
  enums: Map<string, EnumInfo>,
  classes: Map<string, ClassInfo>,
): void {
  const owners = standardTypeOwners(extensions);
  if (owners.size === 0) return;
  const reached = new Set<string>();
  const seed = (source: ModuleInspection["moduleInterface"]): void => {
    for (const type of source.exports.values()) collectTypeIdentities(type, reached);
    for (const fields of source.namedTypes.values()) for (const type of fields.values()) collectTypeIdentities(type, reached);
    for (const base of source.namedTypeBases?.values() ?? []) collectTypeIdentities(base, reached);
    for (const info of source.genericTypes?.values() ?? []) for (const type of info.fields.values()) collectTypeIdentities(type, reached);
  };
  seed(interface_);
  const visited = new Set<ModuleInspection["moduleInterface"]>([interface_]);
  // Transitive: a reachable type's own fields may name a third module's type.
  // A Set iterator visits entries added while it runs, and each owner is
  // seeded at most once, so this terminates at the number of standard modules.
  for (const identity of reached) {
    const owner = owners.get(identity);
    if (!owner || visited.has(owner)) continue;
    visited.add(owner);
    importHiddenTypeMetadata(owner, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
    seed(owner);
  }
}

/**
 * CO-I4 / WB-I5: a name the module does not publish binds the error type, which
 * poisons nothing downstream. A plain `unknown` made the specifier's own report
 * arrive with a second one at every use, advising an `extern module` contract
 * for a name the language owns.
 */
function importInterface(
  module: LoadedModule,
  dependency: ModuleInspection["dependencies"][number],
  interface_: ModuleInspection["moduleInterface"],
  imports: Map<string, ValueType>,
  reactiveImports: Map<string, "state">,
  namedTypes: Map<string, ReadonlyMap<string, ValueType>>,
  namedTypeReadonlyFields: Map<string, ReadonlySet<string>>,
  namedTypeIdentities: Map<string, string>,
  namedTypeBases: Map<string, ValueType>,
  genericTypes: Map<string, GenericTypeInfo>,
  typeAliases: Map<string, ValueType>,
  enums: Map<string, EnumInfo>,
  classes: Map<string, ClassInfo>,
  extensionImports: Map<string, Map<string, unknown>>,
  failures: ProjectFailure[],
): void {
    const aliases = new Map(dependency.specifiers
      .filter((specifier) => !specifier.namespace && specifier.imported !== "default")
      .map((specifier) => [specifier.imported, specifier.local]));

    for (const [name, members] of interface_.enums) {
      enums.set(members.identity, members);
      const localName = aliases.get(name);
      if (localName && interface_.exports.get(name)?.kind === "enumObject") enums.set(localName, members);
    }
    for (const [name, info] of interface_.classes) {
      const renamed = renameClass(info, aliases);
      if (renamed.identity) classes.set(renamed.identity, renamed);
      const localName = aliases.get(name);
      if (localName && interface_.exports.get(name)?.kind === "classConstructor") classes.set(localName, renamed);
    }
    const importedNamedTypeIdentities = new Map([...interface_.namedTypeIdentities]
      .map(([name, identity]) => [aliases.get(name) ?? name, identity] as const));
    const resolveImportedType = (type: ValueType): ValueType => resolveKnownNominals(
      renameType(type, aliases),
      classes,
      enums,
      importedNamedTypeIdentities,
    );
    const interfaceTypeIdentities = new Set(interface_.namedTypeIdentities.values());
    for (const [name, fields] of interface_.namedTypes) {
      const identity = interface_.namedTypeIdentities.get(name) ?? (interfaceTypeIdentities.has(name) ? name : null);
      if (!identity) continue;
      const renamedFields = new Map([...fields].map(([field, type]) => [field, resolveImportedType(type)]));
      namedTypes.set(identity, renamedFields);
      const readonlyFields = interface_.namedTypeReadonlyFields?.get(name) ?? interface_.namedTypeReadonlyFields?.get(identity);
      if (readonlyFields) namedTypeReadonlyFields.set(identity, readonlyFields);
      const localName = aliases.get(name);
      if (localName && interface_.exports.get(name)?.kind === "typeObject") {
        namedTypes.set(localName, renamedFields);
        if (readonlyFields) namedTypeReadonlyFields.set(localName, readonlyFields);
        namedTypeIdentities.set(localName, identity);
      }
    }
    for (const [name, base] of interface_.namedTypeBases ?? []) {
      const identity = interface_.namedTypeIdentities.get(name) ?? (interfaceTypeIdentities.has(name) ? name : null);
      if (!identity) continue;
      const resolvedBase = resolveImportedType(base);
      namedTypeBases.set(identity, resolvedBase);
      const localName = aliases.get(name);
      if (localName && interface_.exports.get(name)?.kind === "typeObject") namedTypeBases.set(localName, resolvedBase);
    }
    // D55 rule 120: an imported generic record is bound under the name this
    // module writes, and its template's field types are renamed and nominally
    // resolved exactly like an imported record's — the arguments a dependent
    // supplies are its own, but everything the declaration already fixed has to
    // arrive meaning what it meant where it was written.
    for (const [name, info] of interface_.genericTypes ?? []) {
      const template: GenericTypeInfo = {
        ...info,
        fields: new Map([...info.fields].map(([field, type]) => [field, resolveImportedType(type)])),
      };
      if (!genericTypes.has(info.identity)) genericTypes.set(info.identity, template);
      const localName = aliases.get(name);
      if (localName && interface_.exports.get(name)?.kind === "typeObject") genericTypes.set(localName, template);
    }
    for (const [name, type] of interface_.typeAliases) {
      const localName = aliases.get(name);
      if (localName && interface_.exports.get(name)?.kind === "typeObject") {
        typeAliases.set(localName, resolveImportedType(type));
      }
    }
    for (const [extensionId, exportedValues] of interface_.extensionExports) {
      const importedValues = extensionImports.get(extensionId) ?? new Map<string, unknown>();
      for (const specifier of dependency.specifiers) {
        if (specifier.namespace) continue;
        const value = exportedValues.get(specifier.imported);
        if (value !== undefined) importedValues.set(specifier.local, value);
      }
      if (importedValues.size > 0) extensionImports.set(extensionId, importedValues);
    }

    for (const specifier of dependency.specifiers) {
      if (specifier.namespace) {
        if (interface_.reactiveExports.size > 0 || interface_.mutableExports.size > 0) {
          failures.push({
            path: module.inputPath,
            message: `Module '${dependency.source}' exports live values; import them by name instead of using a namespace import`,
          });
        }
        const fields = new Map([...interface_.exports].map(([name, type]) => [name, resolveImportedType(type)]));
        imports.set(specifier.local, {
          kind: "object",
          fields,
          readonlyFields: new Set(fields.keys()),
        });
        continue;
      }
      const exported = interface_.exports.get(specifier.imported);
      if (!exported) {
        pushMissingExport(failures, module.inputPath, dependency, specifier, interface_.exports.keys());
        imports.set(specifier.local, invalidType);
        continue;
      }
      imports.set(specifier.local, resolveImportedType(exported));
      const reactive = interface_.reactiveExports.get(specifier.imported);
      if (reactive) reactiveImports.set(specifier.local, reactive);
    }
}
