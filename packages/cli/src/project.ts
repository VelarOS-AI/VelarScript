import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  compile,
  inspectModule,
  optionalOf,
  semanticTypeIdentity,
  type AnalysisContext,
  type ClassInfo,
  type CompilerExtension,
  type CompileResult,
  type EnumInfo,
  type ModuleInspection,
  type ValueType,
} from "@velarscript/compiler";
import type { ResolvedFrameworkHost } from "./config.ts";
import { isStandardModule, standardModuleInterface } from "./standard-modules.ts";
import { loadTypeScriptDeclarations, type TypeScriptDeclarationBridge } from "./typescript-declarations.ts";
import { MAX_VELAR_PROJECT_MODULES, readVelarSourceFile, validateVelarSourceText } from "./source-limits.ts";
import { readBoundedText } from "./bounded-text.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";

export interface ProjectModule {
  readonly inputPath: string;
  readonly relativePath: string;
  readonly result: CompileResult;
}

export interface ProjectFailure {
  readonly path: string;
  readonly message: string;
}

export interface ProjectNotice {
  readonly path: string;
  readonly message: string;
}

export interface VelarSourcePackage {
  readonly name: string;
  readonly root: string;
  readonly entryPath: string;
}

export interface ProjectResult {
  readonly entryPath: string;
  readonly sourceRoot: string;
  readonly projectRoot: string;
  readonly publicRoot: string;
  readonly compilerExtensions: readonly CompilerExtension[];
  readonly extensionConfig: ReadonlyMap<string, unknown>;
  readonly framework: ResolvedFrameworkHost | null;
  readonly capabilities: ReadonlySet<string>;
  readonly modules: readonly ProjectModule[];
  readonly failures: readonly ProjectFailure[];
  readonly notices: readonly ProjectNotice[];
  readonly velarPackages: readonly VelarSourcePackage[];
  readonly velarImports: ReadonlyMap<string, string>;
  readonly stats: ProjectCompilationStats;
}

export interface ProjectCompilationStats {
  readonly moduleCount: number;
  readonly compiledModules: number;
  readonly reusedModules: number;
  readonly affectedModules: number;
  readonly durationMs: number;
}

export interface CompileProjectOptions {
  readonly sourceRoot?: string;
  readonly projectRoot?: string;
  readonly publicRoot?: string;
  readonly extensions?: readonly CompilerExtension[];
  readonly extensionConfig?: ReadonlyMap<string, unknown>;
  readonly framework?: ResolvedFrameworkHost | null;
  readonly exportTestFunctions?: boolean;
}

interface LoadedModule {
  readonly inputPath: string;
  readonly relativePath: string;
  readonly text: string;
  readonly inspection: ModuleInspection;
  readonly package: VelarSourcePackage | null;
  readonly resourceContents: ReadonlyMap<string, string>;
}

interface PendingModule {
  readonly inputPath: string;
  readonly package: VelarSourcePackage | null;
}

export function projectImportKey(importerPath: string, source: string): string {
  return `${resolve(importerPath)}\0${source}`;
}

export async function compileProject(
  entry: string,
  overrides: ReadonlyMap<string, string> = new Map(),
  options: CompileProjectOptions = {},
  previous: ProjectResult | null = null,
  changedPaths: ReadonlySet<string> = new Set(),
): Promise<ProjectResult> {
  const entryPath = resolve(entry);
  return compileProjectEntries([entryPath], entryPath, overrides, options, previous, changedPaths);
}

export async function compileProjectEntries(
  entries: readonly string[],
  primaryEntry: string,
  overrides: ReadonlyMap<string, string> = new Map(),
  options: CompileProjectOptions = {},
  previous: ProjectResult | null = null,
  changedPaths: ReadonlySet<string> = new Set(),
): Promise<ProjectResult> {
  const startedAt = performance.now();
  const entryPath = resolve(primaryEntry);
  const sourceRoot = resolve(options.sourceRoot ?? dirname(entryPath));
  const projectRoot = resolve(options.projectRoot ?? sourceRoot);
  const publicRoot = resolve(options.publicRoot ?? join(projectRoot, "public"));
  const compilerExtensions = options.extensions ?? [];
  const extensionConfig = options.extensionConfig ?? new Map<string, unknown>();
  const framework = options.framework ?? null;
  const capabilities = new Set(compilerExtensions.flatMap((extension) => extension.capabilities ?? []));
  const initialEntries = [...new Set(entries.map((entry) => resolve(entry)))];
  const pending: PendingModule[] = initialEntries.slice(0, MAX_VELAR_PROJECT_MODULES).map((inputPath) => ({ inputPath, package: null }));
  const scheduled = new Set(pending.map((module) => module.inputPath));
  const visited = new Set<string>();
  const loaded = new Map<string, LoadedModule>();
  const failures: ProjectFailure[] = [];
  const notices: ProjectNotice[] = [];
  const declarationCache = new Map<string, Promise<TypeScriptDeclarationBridge | null>>();
  const interfaceCache = new Map<string, ModuleInspection["moduleInterface"]>();
  const velarPackages = new Map<string, VelarSourcePackage>();
  const velarImports = new Map<string, string>();
  const unsafeCssOwners = new Map<string, string>();
  if (initialEntries.length > MAX_VELAR_PROJECT_MODULES) {
    failures.push({ path: entryPath, message: `A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules` });
  }
  const enqueue = (module: PendingModule): void => {
    if (scheduled.has(module.inputPath)) return;
    if (scheduled.size >= MAX_VELAR_PROJECT_MODULES) {
      failures.push({ path: entryPath, message: `A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules` });
      return;
    }
    scheduled.add(module.inputPath);
    pending.push(module);
  };

  while (pending.length > 0) {
    const pendingModule = pending.shift()!;
    const inputPath = pendingModule.inputPath;
    if (visited.has(inputPath)) continue;
    if (visited.size >= MAX_VELAR_PROJECT_MODULES) {
      failures.push({ path: entryPath, message: `A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules` });
      break;
    }
    visited.add(inputPath);

    let text: string;
    try {
      const overridden = overrides.get(inputPath);
      text = overridden === undefined
        ? await readVelarSourceFile(inputPath)
        : validateVelarSourceText(overridden, inputPath);
    } catch (error) {
      failures.push({ path: inputPath, message: hostErrorMessage(error) });
      continue;
    }

    const boundary = pendingModule.package?.root ?? sourceRoot;
    const pathWithinBoundary = relative(boundary, inputPath);
    if (escapesRoot(pathWithinBoundary)) {
      failures.push({ path: inputPath, message: pendingModule.package
        ? `VelarScript package '${pendingModule.package.name}' cannot load source outside its package root`
        : "Relative VelarScript imports cannot escape the entry source directory" });
      continue;
    }
    const relativePath = normalizeModulePath(pendingModule.package
      ? join("__velar_packages__", pendingModule.package.name, pathWithinBoundary)
      : relative(sourceRoot, inputPath));
    const inspection = inspectModule(text, { path: inputPath, extensions: compilerExtensions });
    const resourceContents = new Map<string, string>();
    for (const resource of inspection.resources) {
      if (!resource.source.startsWith(".")) {
        failures.push({ path: inputPath, message: `Compiler resource '${resource.source}' must use a relative path` });
        continue;
      }
      const target = resolve(dirname(inputPath), resource.source);
      if (escapesRoot(relative(boundary, target))) {
        failures.push({ path: inputPath, message: pendingModule.package
          ? `Resource '${resource.source}' cannot escape VelarScript package '${pendingModule.package.name}'`
          : `Resource '${resource.source}' cannot escape the entry source directory` });
        continue;
      }
      if (resource.kind === "unsafe CSS") {
        const owner = unsafeCssOwners.get(target);
        if (owner && owner !== inputPath) {
          failures.push({
            path: inputPath,
            message: `Unsafe CSS resource '${resource.source}' is already imported by '${relative(sourceRoot, owner)}'; each raw stylesheet must have one project owner`,
          });
          continue;
        }
        unsafeCssOwners.set(target, inputPath);
      }
      try {
        resourceContents.set(resource.source, overrides.get(target) ?? await readBoundedText(target, 4 * 1024 * 1024, `${resource.kind} resource '${resource.source}'`));
      } catch (error) {
        failures.push({ path: inputPath, message: `Cannot load ${resource.kind} resource '${resource.source}': ${hostErrorMessage(error)}` });
      }
    }
    loaded.set(inputPath, { inputPath, relativePath, text, inspection, package: pendingModule.package, resourceContents });

    for (const dependency of inspection.dependencies) {
      if (dependency.javascript) continue;
      if (!dependency.source.startsWith(".")) {
        if (isStandardModule(dependency.source, compilerExtensions)) continue;
        try {
          const package_ = await resolveVelarSourcePackage(dependency.source, inputPath);
          const existing = velarPackages.get(package_.name);
          if (existing && existing.root !== package_.root) {
            failures.push({ path: inputPath, message: `VelarScript package '${package_.name}' resolves to multiple installed versions; use one package instance per application build` });
            continue;
          }
          velarPackages.set(package_.name, package_);
          velarImports.set(projectImportKey(inputPath, dependency.source), package_.entryPath);
          enqueue({ inputPath: package_.entryPath, package: package_ });
        } catch (error) {
          failures.push({ path: inputPath, message: `Cannot resolve VelarScript package import '${dependency.source}': ${hostErrorMessage(error)}` });
        }
        continue;
      }
      if (extname(dependency.source) !== ".vel") {
        failures.push({ path: inputPath, message: `VelarScript import '${dependency.source}' must use the .vel extension` });
        continue;
      }
      const target = resolve(dirname(inputPath), dependency.source);
      if (escapesRoot(relative(boundary, target))) {
        failures.push({ path: inputPath, message: pendingModule.package
          ? `Relative import '${dependency.source}' cannot escape VelarScript package '${pendingModule.package.name}'`
          : `Relative import '${dependency.source}' cannot escape the entry source directory` });
        continue;
      }
      enqueue({ inputPath: target, package: pendingModule.package });
    }
  }

  const modules: ProjectModule[] = [];
  const affected = previous ? affectedModules(loaded, velarImports, previous, changedPaths) : new Set(loaded.keys());
  const previousModules = new Map(previous?.modules.map((module) => [module.inputPath, module]));
  const compiledInterfaces = new Map<string, ModuleInspection["moduleInterface"]>();
  for (const [path, module] of previousModules) {
    if (loaded.has(path) && !affected.has(path)) compiledInterfaces.set(path, module.result.moduleInterface);
  }
  let compiledModules = 0;
  let reusedModules = 0;
  for (const group of dependencyFirstCompilationGroups(loaded, velarImports, compilerExtensions)) {
    const reusable = group.every((module) => !affected.has(module.inputPath));
    if (reusable) {
      for (const module of group) {
        const previousModule = previousModules.get(module.inputPath)!;
        modules.push({ ...previousModule, relativePath: module.relativePath });
        reusedModules += 1;
      }
      continue;
    }

    compiledModules += group.length;
    const cyclic = group.length > 1 || group.some((module) => moduleDependencies(module, loaded, velarImports, compilerExtensions).includes(module.inputPath));
    const maximumPasses = cyclic ? group.length + 2 : 1;
    let previousIdentity = "";
    let passResults = new Map<string, ProjectModule>();
    for (let pass = 0; pass < maximumPasses; pass += 1) {
      interfaceCache.clear();
      const nextResults = new Map<string, ProjectModule>();
      for (const module of group) {
        const analysis = await createAnalysisContext(
          module,
          loaded,
          velarImports,
          failures,
          notices,
          declarationCache,
          interfaceCache,
          compiledInterfaces,
          compilerExtensions,
        );
        const result = compile(module.text, {
          path: module.inputPath,
          analysis,
          extensions: compilerExtensions,
          resourceContents: module.resourceContents,
          ...(options.exportTestFunctions ? { exportFunctions: new Set(module.inspection.moduleInterface.testFunctions) } : {}),
        });
        nextResults.set(module.inputPath, { inputPath: module.inputPath, relativePath: module.relativePath, result });
      }
      const identity = group.map((module) => moduleInterfaceIdentity(nextResults.get(module.inputPath)!.result.moduleInterface)).join("\0");
      passResults = nextResults;
      for (const [path, compiled] of nextResults) compiledInterfaces.set(path, compiled.result.moduleInterface);
      if (!cyclic || identity === previousIdentity) break;
      previousIdentity = identity;
      if (pass === maximumPasses - 1) {
        failures.push({ path: group[0]!.inputPath, message: "Cyclic module interfaces did not converge to a stable type contract" });
      }
    }
    modules.push(...group.map((module) => passResults.get(module.inputPath)!));
  }

  modules.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    entryPath,
    sourceRoot,
    projectRoot,
    publicRoot,
    compilerExtensions,
    extensionConfig,
    framework,
    capabilities,
    modules,
    failures: uniqueFailures(failures),
    notices: uniqueNotices(notices),
    velarPackages: [...velarPackages.values()],
    velarImports,
    stats: {
      moduleCount: modules.length,
      compiledModules,
      reusedModules,
      affectedModules: [...affected].filter((path) => loaded.has(path)).length,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    },
  };
}

function affectedModules(
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  previous: ProjectResult,
  changedPaths: ReadonlySet<string>,
): Set<string> {
  const affected = new Set([...changedPaths].map((path) => resolve(path)));
  const reverse = new Map<string, Set<string>>();
  const dependencies = (
    path: string,
    values: readonly { readonly source: string; readonly javascript: boolean }[],
    imports: ReadonlyMap<string, string>,
  ): void => {
    for (const dependency of values) {
      if (dependency.javascript) continue;
      const target = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
        ? resolve(dirname(path), dependency.source)
        : imports.get(projectImportKey(path, dependency.source));
      if (!target) continue;
      const dependents = reverse.get(target) ?? new Set<string>();
      dependents.add(path);
      reverse.set(target, dependents);
    }
  };
  for (const module of loaded.values()) dependencies(module.inputPath, module.inspection.dependencies, velarImports);
  for (const module of previous.modules) dependencies(module.inputPath, module.result.dependencies, previous.velarImports);
  const resources = (path: string, values: readonly { readonly source: string }[]): void => {
    for (const resource of values) {
      if (!resource.source.startsWith(".")) continue;
      const target = resolve(dirname(path), resource.source);
      const dependents = reverse.get(target) ?? new Set<string>();
      dependents.add(path);
      reverse.set(target, dependents);
    }
  };
  for (const module of loaded.values()) resources(module.inputPath, module.inspection.resources);
  for (const module of previous.modules) resources(module.inputPath, module.result.resources);
  const pending = [...affected];
  while (pending.length > 0) {
    const path = pending.shift()!;
    for (const dependent of reverse.get(path) ?? []) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      pending.push(dependent);
    }
  }
  for (const module of loaded.keys()) if (!previous.modules.some((item) => item.inputPath === module)) affected.add(module);
  return affected;
}

function dependencyFirstCompilationGroups(
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  compilerExtensions: readonly CompilerExtension[],
): readonly (readonly LoadedModule[])[] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const groups: LoadedModule[][] = [];

  const visit = (path: string): void => {
    const index = nextIndex++;
    indexes.set(path, index);
    lowLinks.set(path, index);
    stack.push(path);
    active.add(path);

    const module = loaded.get(path)!;
    for (const dependency of moduleDependencies(module, loaded, velarImports, compilerExtensions)) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(path, Math.min(lowLinks.get(path)!, lowLinks.get(dependency)!));
      } else if (active.has(dependency)) {
        lowLinks.set(path, Math.min(lowLinks.get(path)!, indexes.get(dependency)!));
      }
    }

    if (lowLinks.get(path) !== index) return;
    const group: LoadedModule[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      active.delete(member);
      group.push(loaded.get(member)!);
      if (member === path) break;
    }
    group.sort((left, right) => left.inputPath.localeCompare(right.inputPath));
    groups.push(group);
  };

  for (const path of loaded.keys()) if (!indexes.has(path)) visit(path);
  return groups;
}

function moduleDependencies(
  module: LoadedModule,
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  compilerExtensions: readonly CompilerExtension[],
): readonly string[] {
  const output = new Set<string>();
  for (const dependency of module.inspection.dependencies) {
    if (dependency.javascript || isStandardModule(dependency.source, compilerExtensions)) continue;
    const target = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
      ? resolve(dirname(module.inputPath), dependency.source)
      : velarImports.get(projectImportKey(module.inputPath, dependency.source));
    if (target && loaded.has(target)) output.add(target);
  }
  return [...output].sort();
}

function moduleInterfaceIdentity(interface_: ModuleInspection["moduleInterface"]): string {
  const typeMap = (values: ReadonlyMap<string, ValueType>): string => [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => `${name}:${semanticTypeIdentity(type)}`)
    .join("|");
  const namedTypes = [...interface_.namedTypes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, fields]) => `${name}{${typeMap(fields)}}`)
    .join("|");
  const enums = [...interface_.enums]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, info]) => `${name}:${info.identity}:${[...info.members].sort().join(",")}`)
    .join("|");
  const classes = [...interface_.classes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, info]) => `${name}:${info.identity ?? ""}:${info.base ?? ""}:${typeMap(new Map([
      ...[...info.fields].map(([field, value]) => [`field:${field}:${value.mutable ? "let" : "const"}`, value.type] as const),
      ...[...info.methods].map(([method, type]) => [`method:${method}`, type] as const),
      ...[...info.staticFields].map(([field, value]) => [`static-field:${field}:${value.mutable ? "let" : "const"}`, value.type] as const),
      ...[...info.staticMethods].map(([method, type]) => [`static-method:${method}`, type] as const),
    ]))}`)
    .join("|");
  return [
    `exports:${typeMap(interface_.exports)}`,
    `mutable:${[...interface_.mutableExports].sort().join(",")}`,
    `named:${namedTypes}`,
    `aliases:${typeMap(interface_.typeAliases)}`,
    `enums:${enums}`,
    `classes:${classes}`,
    `reactive:${[...interface_.reactiveExports].sort(([left], [right]) => left.localeCompare(right)).map(([name, kind]) => `${name}:${kind}`).join(",")}`,
  ].join("#");
}

async function createAnalysisContext(
  module: LoadedModule,
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  failures: ProjectFailure[],
  notices: ProjectNotice[],
  declarationCache: Map<string, Promise<TypeScriptDeclarationBridge | null>>,
  interfaceCache: Map<string, ModuleInspection["moduleInterface"]>,
  compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>,
  compilerExtensions: readonly CompilerExtension[],
): Promise<AnalysisContext> {
  const imports = new Map<string, ValueType>();
  const dynamicImports = new Map<string, ValueType>();
  const reactiveImports = new Map<string, "state" | "computed">();
  const effectfulImports = new Set<string>();
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  const namedTypeIdentities = new Map<string, string>();
  const typeAliases = new Map<string, ValueType>();
  const enums = new Map<string, EnumInfo>();
  const classes = new Map<string, ClassInfo>();
  const extensionImports = new Map<string, Map<string, unknown>>();
  const extensionModules = new Map<string, unknown[]>();
  for (const loadedModule of loaded.values()) {
    for (const [extensionId, data] of loadedModule.inspection.moduleInterface.extensionData) {
      const values = extensionModules.get(extensionId) ?? [];
      values.push(data);
      extensionModules.set(extensionId, values);
    }
  }

  for (const dependency of module.inspection.dependencies) {
    if (dependency.dynamic) {
      const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
        ? resolve(dirname(module.inputPath), dependency.source)
        : null;
      const target = targetPath ? loaded.get(targetPath) : null;
      if (!target) continue;
      const interface_ = resolvedModuleInterface(target, loaded, velarImports, interfaceCache, compiledInterfaces, compilerExtensions);
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
      importHiddenTypeMetadata(interface_, namedTypes, enums, classes);
      continue;
    }
    if (dependency.javascript) {
      if (dependency.unsafe) continue;
      const key = projectImportKey(module.inputPath, dependency.source);
      let pending = declarationCache.get(key);
      if (!pending) {
        pending = loadTypeScriptDeclarations(dependency.source, module.inputPath);
        declarationCache.set(key, pending);
      }
      const declarations = await pending;
      if (!declarations) continue;
      for (const warning of declarations.warnings) {
        notices.push({ path: module.inputPath, message: `${dependency.source}: ${warning}` });
      }
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
          imports.set(specifier.local, { kind: "object", fields, readonlyFields: new Set(fields.keys()), external: true });
          continue;
        }
        const type = declarations.exports.get(specifier.imported);
        if (!type) notices.push({ path: module.inputPath, message: `${dependency.source}: declaration has no export '${specifier.imported}'` });
        imports.set(specifier.local, type ? renameType(type, aliases) : { kind: "unknown" });
      }
      continue;
    }
    const standard = standardModuleInterface(dependency.source, compilerExtensions);
    if (standard) {
      importInterface(module, dependency, standard, imports, reactiveImports, effectfulImports, namedTypes, namedTypeIdentities, typeAliases, enums, classes, extensionImports, failures);
      continue;
    }
    const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
      ? resolve(dirname(module.inputPath), dependency.source)
      : velarImports.get(projectImportKey(module.inputPath, dependency.source));
    if (!targetPath) continue;
    const target = loaded.get(targetPath);
    if (!target) continue;
    importInterface(module, dependency, resolvedModuleInterface(target, loaded, velarImports, interfaceCache, compiledInterfaces, compilerExtensions), imports, reactiveImports, effectfulImports, namedTypes, namedTypeIdentities, typeAliases, enums, classes, extensionImports, failures);
  }
  return {
    imports,
    dynamicImports,
    reactiveImports,
    effectfulImports,
    namedTypes,
    namedTypeIdentities,
    typeAliases,
    enums,
    classes,
    extensionImports,
    extensionModules,
    resources: module.resourceContents,
  };
}

function resolvedModuleInterface(
  module: LoadedModule,
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  cache: Map<string, ModuleInspection["moduleInterface"]>,
  compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>,
  compilerExtensions: readonly CompilerExtension[],
): ModuleInspection["moduleInterface"] {
  const cached = cache.get(module.inputPath);
  if (cached) return cached;
  const own = compiledInterfaces.get(module.inputPath) ?? module.inspection.moduleInterface;
  const exports = new Map(own.exports);
  const namedTypes = new Map(own.namedTypes);
  const namedTypeIdentities = new Map(own.namedTypeIdentities);
  const typeAliases = new Map(own.typeAliases);
  const enums = new Map(own.enums);
  const classes = new Map(own.classes);
  for (const [name, identity] of own.namedTypeIdentities) {
    const fields = own.namedTypes.get(name);
    if (fields) namedTypes.set(identity, fields);
  }
  for (const info of own.enums.values()) enums.set(info.identity, info);
  for (const info of own.classes.values()) if (info.identity) classes.set(info.identity, info);
  const extensionExports = new Map([...own.extensionExports].map(([id, values]) => [id, new Map(values)] as const));
  const resolved: ModuleInspection["moduleInterface"] = { ...own, exports, namedTypes, namedTypeIdentities, typeAliases, enums, classes, extensionExports };
  cache.set(module.inputPath, resolved);

  for (const dependency of module.inspection.dependencies) {
    if (dependency.javascript) continue;
    let dependencyInterface = standardModuleInterface(dependency.source, compilerExtensions);
    if (!dependencyInterface) {
      const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
        ? resolve(dirname(module.inputPath), dependency.source)
        : velarImports.get(projectImportKey(module.inputPath, dependency.source));
      const target = targetPath ? loaded.get(targetPath) : null;
      if (!target) continue;
      dependencyInterface = resolvedModuleInterface(target, loaded, velarImports, cache, compiledInterfaces, compilerExtensions);
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
      const localName = aliases.get(name);
      if (localName && dependencyInterface.exports.has(name)) {
        namedTypes.set(localName, renamedFields);
        namedTypeIdentities.set(localName, identity);
      }
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
  }

  const enumNames = enums;
  const resolveType = (type: ValueType): ValueType => resolveKnownNominals(expandKnownAliases(type, typeAliases), classes, enumNames, namedTypeIdentities);
  for (const [name, type] of exports) exports.set(name, resolveType(type));
  for (const [name, fields] of namedTypes) {
    namedTypes.set(name, new Map([...fields].map(([field, type]) => [field, resolveType(type)])));
  }
  for (const [name, type] of typeAliases) typeAliases.set(name, resolveType(type));
  for (const [name, info] of classes) {
    classes.set(name, {
      ...info,
      base: info.base ? classes.get(info.base)?.identity ?? info.base : null,
      parameters: info.parameters.map(resolveType),
      fields: new Map([...info.fields].map(([field, value]) => [field, { ...value, type: resolveType(value.type) }])),
      methods: new Map([...info.methods].map(([method, type]) => [method, resolveType(type)])),
      staticFields: new Map([...info.staticFields].map(([field, value]) => [field, { ...value, type: resolveType(value.type) }])),
      staticMethods: new Map([...info.staticMethods].map(([method, type]) => [method, resolveType(type)])),
    });
  }
  return resolved;
}

async function resolveVelarSourcePackage(source: string, importerPath: string): Promise<VelarSourcePackage> {
  const name = packageNameOf(source);
  if (source !== name) throw new Error("package subpaths are not supported; import the package entry by name");
  let directory = dirname(importerPath);
  while (true) {
    const root = join(directory, "node_modules", ...name.split("/"));
    try {
      const manifest = JSON.parse(await readBoundedText(join(root, "package.json"), 1024 * 1024, `Package manifest for '${name}'`)) as {
        name?: unknown;
        velar?: { entry?: unknown };
      };
      if (manifest.name !== undefined && manifest.name !== name) throw new Error(`package name is '${String(manifest.name)}', expected '${name}'`);
      const entry = manifest.velar?.entry;
      if (typeof entry !== "string" || entry.length === 0) throw new Error("package.json must declare 'velar.entry'");
      if (isAbsolute(entry)) throw new Error("'velar.entry' must be relative to the package root");
      const entryPath = resolve(root, entry);
      if (escapesRoot(relative(root, entryPath))) throw new Error("'velar.entry' cannot escape the package root");
      if (extname(entryPath) !== ".vel") throw new Error("'velar.entry' must point to a .vel source file");
      return { name, root, entryPath };
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`package '${name}' is not installed`);
    directory = parent;
  }
}

function packageNameOf(source: string): string {
  const parts = source.split("/");
  if (source.startsWith("@")) {
    if (parts.length < 2 || !parts[0] || !parts[1]) throw new Error(`invalid package name '${source}'`);
    return parts.slice(0, 2).join("/");
  }
  if (!parts[0]) throw new Error(`invalid package name '${source}'`);
  return parts[0];
}

function escapesRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith("../") || relativePath.startsWith("..\\") || isAbsolute(relativePath);
}

function normalizeModulePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function importHiddenTypeMetadata(
  interface_: ModuleInspection["moduleInterface"],
  namedTypes: Map<string, ReadonlyMap<string, ValueType>>,
  enums: Map<string, EnumInfo>,
  classes: Map<string, ClassInfo>,
): void {
  const identities = new Set(interface_.namedTypeIdentities.values());
  for (const [name, fields] of interface_.namedTypes) {
    const identity = interface_.namedTypeIdentities.get(name) ?? (identities.has(name) ? name : null);
    if (identity && !namedTypes.has(identity)) namedTypes.set(identity, fields);
  }
  for (const info of interface_.enums.values()) if (!enums.has(info.identity)) enums.set(info.identity, info);
  for (const info of interface_.classes.values()) {
    if (info.identity && !classes.has(info.identity)) classes.set(info.identity, info);
  }
}

function importInterface(
  module: LoadedModule,
  dependency: ModuleInspection["dependencies"][number],
  interface_: ModuleInspection["moduleInterface"],
  imports: Map<string, ValueType>,
  reactiveImports: Map<string, "state" | "computed">,
  effectfulImports: Set<string>,
  namedTypes: Map<string, ReadonlyMap<string, ValueType>>,
  namedTypeIdentities: Map<string, string>,
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
      const localName = aliases.get(name);
      if (localName && interface_.exports.get(name)?.kind === "typeObject") {
        namedTypes.set(localName, renamedFields);
        namedTypeIdentities.set(localName, identity);
      }
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
        failures.push({ path: module.inputPath, message: `Module '${dependency.source}' has no export named '${specifier.imported}'` });
        imports.set(specifier.local, { kind: "unknown" });
        continue;
      }
      imports.set(specifier.local, resolveImportedType(exported));
      const reactive = interface_.reactiveExports.get(specifier.imported);
      if (reactive) reactiveImports.set(specifier.local, reactive);
      if (reactive || interface_.mutableExports.has(specifier.imported)) effectfulImports.add(specifier.local);
    }
}

function renameClass(info: ClassInfo, aliases: ReadonlyMap<string, string>): ClassInfo {
  return {
    ...(info.identity ? { identity: info.identity } : {}),
    parameters: info.parameters.map((type) => renameType(type, aliases)),
    ...(info.parameterNames ? { parameterNames: info.parameterNames } : {}),
    requiredParameters: info.requiredParameters,
    ...(info.constructorRest ? { constructorRest: renameType(info.constructorRest, aliases) } : {}),
    base: info.base ? aliases.get(info.base) ?? info.base : null,
    abstract: info.abstract,
    fields: new Map([...info.fields].map(([name, field]) => [name, { mutable: field.mutable, type: renameType(field.type, aliases) }])),
    getters: info.getters,
    abstractGetters: info.abstractGetters,
    methods: new Map([...info.methods].map(([name, type]) => [name, renameType(type, aliases)])),
    abstractMethods: info.abstractMethods,
    staticFields: new Map([...info.staticFields].map(([name, field]) => [name, { mutable: field.mutable, type: renameType(field.type, aliases) }])),
    staticGetters: info.staticGetters,
    staticMethods: new Map([...info.staticMethods].map(([name, type]) => [name, renameType(type, aliases)])),
  };
}

function renameType(type: ValueType, aliases: ReadonlyMap<string, string>): ValueType {
  switch (type.kind) {
    case "named":
    case "class":
    case "enum":
    case "typeObject":
    case "classConstructor":
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "enumObject":
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "optional":
      return optionalOf(renameType(type.inner, aliases));
    case "list":
      return { ...type, element: renameType(type.element, aliases) };
    case "set":
      return { kind: "set", element: renameType(type.element, aliases) };
    case "map":
      return { kind: "map", key: renameType(type.key, aliases), value: renameType(type.value, aliases) };
    case "promise":
      return { kind: "promise", value: renameType(type.value, aliases) };
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, renameType(value, aliases)])) };
    case "function":
    case "action":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => renameType(parameter, aliases)),
        ...(type.rest ? { rest: renameType(type.rest, aliases) } : {}),
        result: renameType(type.result, aliases),
      };
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => renameType(parameter, aliases)),
        ...(type.rest ? { rest: renameType(type.rest, aliases) } : {}),
        result: renameType(type.result, aliases),
      };
    case "componentConstructor":
      return {
        ...type,
        name: aliases.get(type.name) ?? type.name,
        props: new Map([...type.props].map(([name, value]) => [name, renameType(value, aliases)])),
      };
    case "union":
      return { kind: "union", members: type.members.map((member) => renameType(member, aliases)) };
    default:
      return type;
  }
}

function resolveKnownNominals(
  type: ValueType,
  classes: ReadonlyMap<string, ClassInfo>,
  enums: ReadonlyMap<string, EnumInfo>,
  namedTypeIdentities: ReadonlyMap<string, string>,
): ValueType {
  if (type.kind === "named" && classes.has(type.name)) {
    const identity = classes.get(type.name)?.identity;
    return { kind: "class", name: type.name, ...(identity ? { identity } : {}) };
  }
  if (type.kind === "named" && enums.has(type.name)) return { kind: "enum", name: type.name, identity: enums.get(type.name)!.identity };
  if (type.kind === "named" && !type.identity && namedTypeIdentities.has(type.name)) {
    return { ...type, identity: namedTypeIdentities.get(type.name)! };
  }
  switch (type.kind) {
    case "optional":
      return optionalOf(resolveKnownNominals(type.inner, classes, enums, namedTypeIdentities));
    case "list":
      return { ...type, element: resolveKnownNominals(type.element, classes, enums, namedTypeIdentities) };
    case "set":
      return { kind: "set", element: resolveKnownNominals(type.element, classes, enums, namedTypeIdentities) };
    case "map":
      return { kind: "map", key: resolveKnownNominals(type.key, classes, enums, namedTypeIdentities), value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities) };
    case "promise":
      return { kind: "promise", value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities) };
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolveKnownNominals(value, classes, enums, namedTypeIdentities)])) };
    case "function":
    case "action":
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => resolveKnownNominals(parameter, classes, enums, namedTypeIdentities)),
        ...(type.rest ? { rest: resolveKnownNominals(type.rest, classes, enums, namedTypeIdentities) } : {}),
        result: resolveKnownNominals(type.result, classes, enums, namedTypeIdentities),
      };
    case "componentConstructor":
      return {
        ...type,
        props: new Map([...type.props].map(([name, value]) => [name, resolveKnownNominals(value, classes, enums, namedTypeIdentities)])),
      };
    case "union":
      return { kind: "union", members: type.members.map((member) => resolveKnownNominals(member, classes, enums, namedTypeIdentities)) };
    default:
      return type;
  }
}

function expandKnownAliases(type: ValueType, aliases: ReadonlyMap<string, ValueType>, seen: ReadonlySet<string> = new Set()): ValueType {
  if (type.kind === "named" && aliases.has(type.name)) {
    if (seen.has(type.name)) return { kind: "unknown" };
    return expandKnownAliases(aliases.get(type.name)!, aliases, new Set([...seen, type.name]));
  }
  switch (type.kind) {
    case "optional":
      return optionalOf(expandKnownAliases(type.inner, aliases, seen));
    case "list":
      return { ...type, element: expandKnownAliases(type.element, aliases, seen) };
    case "set":
      return { kind: "set", element: expandKnownAliases(type.element, aliases, seen) };
    case "map":
      return { kind: "map", key: expandKnownAliases(type.key, aliases, seen), value: expandKnownAliases(type.value, aliases, seen) };
    case "promise":
      return { kind: "promise", value: expandKnownAliases(type.value, aliases, seen) };
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expandKnownAliases(value, aliases, seen)])) };
    case "function":
    case "action":
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => expandKnownAliases(parameter, aliases, seen)),
        ...(type.rest ? { rest: expandKnownAliases(type.rest, aliases, seen) } : {}),
        result: expandKnownAliases(type.result, aliases, seen),
      };
    case "componentConstructor":
      return { ...type, props: new Map([...type.props].map(([name, value]) => [name, expandKnownAliases(value, aliases, seen)])) };
    case "union":
      return { kind: "union", members: type.members.map((member) => expandKnownAliases(member, aliases, seen)) };
    default:
      return type;
  }
}

function uniqueFailures(failures: readonly ProjectFailure[]): readonly ProjectFailure[] {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.path}\0${failure.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueNotices(notices: readonly ProjectNotice[]): readonly ProjectNotice[] {
  const seen = new Set<string>();
  return notices.filter((notice) => {
    const key = `${notice.path}\0${notice.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
