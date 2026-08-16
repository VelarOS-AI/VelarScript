import { findPackageJSON, isBuiltin } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  analysisTypeIdentity,
  compile,
  diagnostic,
  genericApplicationType,
  inspectModule,
  optionalOf,
  permanentNamespaceCoveringModule,
  readonlyViewOf,
  removedStandardFunctionGuidance,
  type AnalysisContext,
  type ClassInfo,
  type CompilerExtension,
  type CompileResult,
  type Diagnostic,
  type EnumInfo,
  type GenericTypeInfo,
  type ModuleInspection,
  type ModuleInterface,
  type ValueType,
} from "@velarscript/compiler";
import type { ResolvedFrameworkHost } from "./config.ts";
import { isNodeOnlyModule, nodeModuleDiagnostic } from "@velarscript/node/compiler";
import { isStandardModule, standardModuleInterface, standardModuleInterfaces } from "./standard-modules.ts";
import { loadTypeScriptDeclarations, type TypeScriptDeclarationBridge } from "./typescript-declarations.ts";
import { MAX_VELAR_PROJECT_MODULES, readVelarSourceFile, validateVelarSourceText } from "./source-limits.ts";
import { readBoundedText } from "./bounded-text.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";

export interface ProjectModule {
  readonly inputPath: string;
  readonly relativePath: string;
  readonly result: CompileResult;
  /**
   * The module's own compile output, before the project-level cycle check
   * overlaid its diagnostics. `result` is derived from this on every compile,
   * so a module whose cycle diagnostic disappears recovers its emitted code
   * even when incremental reuse hands the previous entry straight back.
   */
  readonly compiledResult?: CompileResult;
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
  readonly externalTypeDependencies: ReadonlyMap<string, ReadonlySet<string>>;
  readonly stats: ProjectCompilationStats;
}

export interface ProjectCompilationStats {
  readonly moduleCount: number;
  readonly compiledModules: number;
  readonly reusedModules: number;
  readonly affectedModules: number;
  readonly durationMs: number;
}

function missingExportMessage(source: string, name: string): string {
  const guidance = removedStandardFunctionGuidance(source, name);
  if (guidance) return guidance;
  // MOD-U2: `import name from "..."` is the JavaScript default-import habit;
  // .vel modules have no default export, so the answer teaches the named form
  // instead of implying a default might exist.
  if (name === "default") {
    return `VelarScript modules have no default export; import the names you need — import {name} from ${JSON.stringify(source)}`;
  }
  return `Module '${source}' has no export named '${name}'`;
}

export interface CompileProjectOptions {
  readonly sourceRoot?: string;
  readonly projectRoot?: string;
  readonly publicRoot?: string;
  readonly extensions?: readonly CompilerExtension[];
  readonly extensionConfig?: ReadonlyMap<string, unknown>;
  readonly framework?: ResolvedFrameworkHost | null;
  readonly exportTestFunctions?: boolean;
  /**
   * BRG-U2: bare `import js` specifiers resolve at check time by default. A
   * caller whose sources are illustrations rather than a runnable project
   * (the documentation-example checker) opts out explicitly.
   */
  readonly resolveJavaScriptSpecifiers?: boolean;
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

/**
 * MOD-I5: a module-resolution failure is a positional diagnostic on the
 * import statement that caused it — code, span, and owned wording — exactly
 * like every other compiler failure. The project driver records them here
 * during the dependency walk and overlays them onto the importer's compile
 * result next to the initialization-cycle diagnostics.
 */
interface ModuleResolutionDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly source: string;
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
  const externalTypeDependencies = new Map<string, Set<string>>();
  const interfaceCache = new Map<string, ModuleInspection["moduleInterface"]>();
  const velarPackages = new Map<string, VelarSourcePackage>();
  const velarImports = new Map<string, string>();
  const unsafeCssOwners = new Map<string, string>();
  const resolutionDiagnostics = new Map<string, ModuleResolutionDiagnostic[]>();
  const recordResolution = (importerPath: string, source: string, code: string, message: string): void => {
    const list = resolutionDiagnostics.get(importerPath) ?? [];
    list.push({ code, message, source });
    resolutionDiagnostics.set(importerPath, list);
  };
  // The importing statement behind each scheduled module, so a failure that
  // only surfaces when the target is visited (a missing file, a
  // case-divergent duplicate) can still land on the import that caused it.
  const importOrigins = new Map<string, { readonly importer: string; readonly source: string }>();
  // MOD-D2: one canonical file must be one module. The canonical (real-cased,
  // symlink-resolved) path of every visited module detects a second spelling
  // of the same file before it double-instantiates.
  const canonicalModuleKeys = new Map<string, string>();
  const javascriptSpecifierVerdicts = new Map<string, ModuleResolutionDiagnostic | null>();
  const canonicalBoundaries = new Map<string, Promise<string>>();
  const canonicalBoundary = (boundary: string): Promise<string> => {
    let pending = canonicalBoundaries.get(boundary);
    if (!pending) {
      pending = canonicalizePotentialPath(boundary);
      canonicalBoundaries.set(boundary, pending);
    }
    return pending;
  };
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

    const boundary = pendingModule.package?.root ?? sourceRoot;
    const pathWithinBoundary = relative(boundary, inputPath);
    if (escapesRoot(pathWithinBoundary)) {
      failures.push({ path: inputPath, message: pendingModule.package
        ? `VelarScript package '${pendingModule.package.name}' cannot load source outside its package root`
        : "Relative VelarScript imports cannot escape the entry source directory" });
      continue;
    }
    let escapesCanonicalBoundary = false;
    let canonicalInput: string | null = null;
    try {
      canonicalInput = await canonicalizePotentialPath(inputPath);
      escapesCanonicalBoundary = escapesRoot(relative(await canonicalBoundary(boundary), canonicalInput));
    } catch (error) {
      failures.push({ path: inputPath, message: hostErrorMessage(error) });
      continue;
    }
    if (escapesCanonicalBoundary) {
      failures.push({ path: inputPath, message: pendingModule.package
        ? `VelarScript package '${pendingModule.package.name}' cannot load source outside its package root`
        : "Relative VelarScript imports cannot escape the entry source directory" });
      continue;
    }
    // MOD-D2: two spellings of one file (differently cased on a
    // case-insensitive filesystem, or reached through a link) would silently
    // instantiate the module twice and split its state. The first spelling
    // wins; the second is rejected on its import.
    {
      const existingSpelling = canonicalModuleKeys.get(canonicalInput);
      if (existingSpelling !== undefined && existingSpelling !== inputPath) {
        const origin = importOrigins.get(inputPath);
        const message = `Module path ${JSON.stringify(origin?.source ?? inputPath)} names the same file as '${existingSpelling}' under a different spelling; a module has one instance, so import it through one spelling (match the on-disk casing)`;
        if (origin) recordResolution(origin.importer, origin.source, "VEL6005", message);
        else failures.push({ path: inputPath, message });
        continue;
      }
      canonicalModuleKeys.set(canonicalInput, inputPath);
    }
    let text: string;
    try {
      const overridden = overrides.get(inputPath);
      text = overridden === undefined
        ? await readVelarSourceFile(inputPath)
        : validateVelarSourceText(overridden, inputPath);
    } catch (error) {
      // MOD-U5: a missing module lands on the import that asked for it, in
      // owned words, with the closest on-disk name when one is near.
      const origin = importOrigins.get(inputPath);
      if (origin && isHostErrorCode(error, "ENOENT")) {
        const near = await nearestModuleName(inputPath);
        const suggestion = near === null ? null : origin.source.slice(0, origin.source.lastIndexOf("/") + 1) + near;
        recordResolution(
          origin.importer,
          origin.source,
          "VEL6001",
          `Module ${JSON.stringify(origin.source)} does not exist${suggestion ? `; did you mean ${JSON.stringify(suggestion)}?` : ""}`,
        );
        continue;
      }
      failures.push({ path: inputPath, message: hostErrorMessage(error) });
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
      let resourceEscapesCanonicalBoundary = false;
      try {
        resourceEscapesCanonicalBoundary = escapesRoot(relative(await canonicalBoundary(boundary), await canonicalizePotentialPath(target)));
      } catch (error) {
        failures.push({ path: inputPath, message: `Cannot authorize ${resource.kind} resource '${resource.source}': ${hostErrorMessage(error)}` });
        continue;
      }
      if (resourceEscapesCanonicalBoundary) {
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
      if (dependency.javascript) {
        if (dependency.source.startsWith(".")) {
          failures.push({
            path: inputPath,
            message: `Relative JavaScript import target '${dependency.source}' cannot be emitted; move the JavaScript module into a package and import it by package name`,
          });
          continue;
        }
        // BRG-U2: a bare `import js` specifier resolves at check time. A
        // mistyped package name used to pass check and crash the run with a
        // raw ERR_MODULE_NOT_FOUND pointing at emitted artifacts, and a
        // VelarScript package imported through `import js` crashed the same
        // way while the mirror mistake had teaching.
        if (options.resolveJavaScriptSpecifiers !== false
          && !dependency.source.startsWith("node:") && !dependency.source.startsWith("data:") && !dependency.source.startsWith("#") && !isBuiltin(dependency.source)) {
          const key = projectImportKey(inputPath, dependency.source);
          let verdict = javascriptSpecifierVerdicts.get(key);
          if (verdict === undefined) {
            verdict = await judgeJavaScriptSpecifier(dependency.source, inputPath);
            javascriptSpecifierVerdicts.set(key, verdict);
          }
          if (verdict) recordResolution(inputPath, dependency.source, verdict.code, verdict.message);
        }
        continue;
      }
      if (isNodeOnlyModule(dependency.source) && (capabilities.has("web") || framework?.host.target === "browser")
        && !extensionOwnsStandardModule(dependency.source, compilerExtensions)) {
        failures.push({ path: inputPath, message: nodeModuleDiagnostic(dependency.source) });
        continue;
      }
      if (!dependency.source.startsWith(".")) {
        if (isStandardModule(dependency.source, compilerExtensions)) continue;
        // MOD-U6: `velar/` is the language's own prefix; an unknown name in
        // it lists the modules that exist instead of npm-subpath noise.
        if (dependency.source === "velar" || dependency.source.startsWith("velar/")) {
          const migratedStandard = migratedStandardPackageDiagnostic(dependency.source);
          if (migratedStandard) {
            failures.push({ path: inputPath, message: migratedStandard });
            continue;
          }
          const interfaces = standardModuleInterfaces(compilerExtensions);
          const available = [...interfaces.keys()].sort();
          const near = nearestName(dependency.source, available);
          recordResolution(
            inputPath,
            dependency.source,
            "VEL6003",
            `Unknown standard module ${JSON.stringify(dependency.source)}${near ? `; did you mean ${JSON.stringify(near)}?` : ""} The standard modules are: ${available.map((module) => standardModuleListing(module, interfaces)).join(", ")}`,
          );
          continue;
        }
        const migrated = migratedStandardPackageDiagnostic(dependency.source);
        if (migrated) {
          failures.push({ path: inputPath, message: migrated });
          continue;
        }
        // MOD-U5: the two malformed non-package shapes each teach the
        // relative spelling instead of falling into package resolution.
        if (isAbsolute(dependency.source)) {
          recordResolution(
            inputPath,
            dependency.source,
            "VEL6002",
            `Module paths are relative to the importing file; write './name.vel' — an absolute path is not a portable project input`,
          );
          continue;
        }
        if (dependency.source.endsWith(".vel")) {
          recordResolution(
            inputPath,
            dependency.source,
            "VEL6002",
            `Import ${JSON.stringify(`./${dependency.source}`)}; a module path without './' names an installed package, not a file`,
          );
          continue;
        }
        try {
          const package_ = await resolveVelarSourcePackage(dependency.source, inputPath);
          const existing = velarPackages.get(package_.name);
          if (existing && existing.root !== package_.root) {
            recordResolution(inputPath, dependency.source, "VEL6002", `VelarScript package '${package_.name}' resolves to multiple installed versions; use one package instance per application build`);
            continue;
          }
          velarPackages.set(package_.name, package_);
          velarImports.set(projectImportKey(inputPath, dependency.source), package_.entryPath);
          importOrigins.set(package_.entryPath, { importer: inputPath, source: dependency.source });
          enqueue({ inputPath: package_.entryPath, package: package_ });
        } catch (error) {
          if (error instanceof JavaScriptOnlyPackageError) {
            recordResolution(
              inputPath,
              dependency.source,
              "VEL6002",
              `'${dependency.source}' is a JavaScript package, not a VelarScript package; reach it across the bridge — import js {name} from ${JSON.stringify(dependency.source)}, and declare 'extern module ${JSON.stringify(dependency.source)}:' when you want the contract checked`,
            );
            continue;
          }
          recordResolution(inputPath, dependency.source, "VEL6002", `Cannot resolve VelarScript package import '${dependency.source}': ${hostErrorMessage(error)}`);
        }
        continue;
      }
      if (extname(dependency.source) !== ".vel") {
        recordResolution(inputPath, dependency.source, "VEL6001", `VelarScript import '${dependency.source}' must use the .vel extension`);
        continue;
      }
      const target = resolve(dirname(inputPath), dependency.source);
      // MOD-D3 / MOD-U8: a module cannot import (or re-export) from itself.
      // The self edge evades the initialization-cycle checker — evaluation
      // order cannot place a module after itself — so the binding crashed
      // with a raw ReferenceError at run time.
      if (target === inputPath) {
        recordResolution(
          inputPath,
          dependency.source,
          "VEL6004",
          dependency.reExport
            ? "A module cannot re-export from itself; declare the binding under the exported name instead"
            : "A module cannot import from itself; use the declaration directly (rename it if the import was an alias)",
        );
        continue;
      }
      if (escapesRoot(relative(boundary, target))) {
        failures.push({ path: inputPath, message: pendingModule.package
          ? `Relative import '${dependency.source}' cannot escape VelarScript package '${pendingModule.package.name}'`
          : `Relative import '${dependency.source}' cannot escape the entry source directory` });
        continue;
      }
      if (!importOrigins.has(target)) importOrigins.set(target, { importer: inputPath, source: dependency.source });
      enqueue({ inputPath: target, package: pendingModule.package });
    }
  }

  const modules: ProjectModule[] = [];
  const affected = previous ? affectedModules(loaded, velarImports, previous, changedPaths) : new Set(loaded.keys());
  const previousModules = new Map(previous?.modules.map((module) => [module.inputPath, module]));
  for (const [dependency, importers] of previous?.externalTypeDependencies ?? []) {
    for (const importer of importers) {
      if (!loaded.has(importer) || affected.has(importer)) continue;
      const preserved = externalTypeDependencies.get(dependency) ?? new Set<string>();
      preserved.add(importer);
      externalTypeDependencies.set(dependency, preserved);
    }
  }
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
          externalTypeDependencies,
          interfaceCache,
          compiledInterfaces,
          compilerExtensions,
        );
        const result = importedReactiveAssignmentDiagnostics(compile(module.text, {
          path: module.inputPath,
          analysis,
          extensions: compilerExtensions,
          resourceContents: module.resourceContents,
          sharedRuntimeModules: true,
          ...(options.exportTestFunctions ? { exportFunctions: new Set(module.inspection.moduleInterface.tests.map((item) => item.name)) } : {}),
        }), analysis.reactiveImports ?? new Map());
        nextResults.set(module.inputPath, { inputPath: module.inputPath, relativePath: module.relativePath, result });
      }
      passResults = nextResults;
      for (const [path, compiled] of nextResults) compiledInterfaces.set(path, compiled.result.moduleInterface);
      let identity: string;
      try {
        identity = group
          .map((module) => moduleInterfaceIdentity(nextResults.get(module.inputPath)!.result.moduleInterface, compilerExtensions))
          .join("\0");
      } catch (error) {
        failures.push({ path: group[0]!.inputPath, message: hostErrorMessage(error) });
        break;
      }
      if (!cyclic || identity === previousIdentity) break;
      previousIdentity = identity;
      if (pass === maximumPasses - 1) {
        failures.push({ path: group[0]!.inputPath, message: "Cyclic module interfaces did not converge to a stable type contract" });
      }
    }
    modules.push(...group.map((module) => passResults.get(module.inputPath)!));
  }

  appendInitializationCycleDiagnostics(modules, loaded, velarImports, entryPath, resolutionDiagnostics);
  modules.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (framework?.host.validateProject) {
    try {
      const messages = framework.host.validateProject({
        config: framework.config,
        modules: modules.map((module) => ({
          path: module.inputPath,
          imports: module.result.dependencies.filter((item) => !item.javascript).map((item) => item.source),
        })),
      });
      for (const message of messages) failures.push({ path: entryPath, message });
    } catch (error) {
      failures.push({ path: entryPath, message: `Application host validation failed: ${hostErrorMessage(error)}` });
    }
  }
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
    externalTypeDependencies,
    stats: {
      moduleCount: modules.length,
      compiledModules,
      reusedModules,
      affectedModules: [...affected].filter((path) => loaded.has(path)).length,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    },
  };
}

/** Levenshtein distance capped at 3 — enough to answer "is this a near miss". */
function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 3) return 4;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function nearestName(requested: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    if (candidate === requested) continue;
    const distance = editDistance(requested, candidate);
    if (distance < bestDistance || (distance === bestDistance && best === null)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** The nearest .vel file name next to a missing module target, if any. */
async function nearestModuleName(targetPath: string): Promise<string | null> {
  try {
    const entries = await readdir(dirname(targetPath), { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".vel")).map((entry) => entry.name);
    const wanted = targetPath.slice(targetPath.lastIndexOf("/") + 1);
    return nearestName(wanted, names);
  } catch {
    return null;
  }
}

// BRG-U2: judge a bare `import js` specifier at check time. The package must
// exist next to the importer, and a VelarScript package reached through
// `import js` gets the reverse-direction teaching.
async function judgeJavaScriptSpecifier(source: string, importerPath: string): Promise<ModuleResolutionDiagnostic | null> {
  let manifestPath: string | undefined;
  try {
    manifestPath = findPackageJSON(source, pathToFileURL(importerPath)) ?? undefined;
  } catch {
    manifestPath = undefined;
  }
  if (manifestPath === undefined) {
    return {
      code: "VEL6006",
      message: `JavaScript package import ${JSON.stringify(source)} does not resolve to an installed package; install it, or fix the specifier`,
      source,
    };
  }
  try {
    const manifest = JSON.parse(await readBoundedText(manifestPath, 1024 * 1024, `Package manifest for '${source}'`)) as { velar?: { entry?: unknown } };
    if (typeof manifest.velar?.entry === "string" && manifest.velar.entry.length > 0) {
      const packageName = packageNameOf(source);
      return {
        code: "VEL6006",
        message: `'${packageName}' is a VelarScript package; import it without 'js' — import {name} from ${JSON.stringify(packageName)}`,
        source,
      };
    }
  } catch {
    // An unreadable manifest is the package's own problem; the import stands.
  }
  return null;
}

/**
 * D57 rule 136: how one standard module appears in the VEL6003 listing. A
 * module whose every export retired into a permanent namespace is still real —
 * the capability is there, only the spelling changed — so it stays listed and
 * says where its members went. Listing it bare sends the author to an import
 * VEL3008 refuses on the next step, which is the worst kind of diagnostic.
 * The annotation is derived from the migration roster the compiler rejects
 * those imports with, so the listing cannot fall behind a future migration.
 */
function standardModuleListing(source: string, interfaces: ReadonlyMap<string, ModuleInterface>): string {
  const namespace = permanentNamespaceCoveringModule(source, interfaces.get(source)?.exports.keys() ?? []);
  return namespace ? `${source} (its members read as ${namespace}.name and need no import)` : source;
}

function migratedStandardPackageDiagnostic(source: string): string | null {
  if (source === "velar/javascript") {
    return "Standard module 'velar/javascript' moved to package '@velarscript/script-analysis'; install it, then import from '@velarscript/script-analysis'";
  }
  if (source === "velar/text-buffer") {
    return "Standard module 'velar/text-buffer' moved to package '@velarscript/text-buffer'; install it, then import from '@velarscript/text-buffer'";
  }
  return null;
}

function extensionOwnsStandardModule(source: string, extensions: readonly CompilerExtension[]): boolean {
  return extensions.some((extension) => extension.id !== "@velarscript/node" && extension.modules?.interfaces.has(source));
}

function importedReactiveAssignmentDiagnostics(
  result: CompileResult,
  reactiveImports: ReadonlyMap<string, "state">,
): CompileResult {
  if (reactiveImports.size === 0) return result;
  const diagnostics = result.diagnostics.map((item) => {
    if (item.code !== "VEL3002" || !item.message.startsWith("Cannot assign to imported binding '")) return item;
    const reference = result.semanticIndex.references.find((candidate) => candidate.write
      && candidate.span.start === item.span.start
      && candidate.span.end === item.span.end);
    const imported = reference?.symbolId
      ? result.semanticIndex.imports.find((candidate) => candidate.localSymbolId === reference.symbolId)
      : null;
    const kind = imported ? reactiveImports.get(imported.local) : null;
    if (!kind) return item;
    return {
      ...item,
      message: `Cannot assign to imported ${kind} binding '${imported!.local}'; it is read-only here. Export a mutator from the owning module and call it instead`,
    };
  });
  return diagnostics.some((item, index) => item !== result.diagnostics[index])
    ? { ...result, diagnostics }
    : result;
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
  for (const [dependency, importers] of previous.externalTypeDependencies) {
    const dependents = reverse.get(dependency) ?? new Set<string>();
    for (const importer of importers) dependents.add(importer);
    reverse.set(dependency, dependents);
  }
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

const INITIALIZATION_CYCLE_DIAGNOSTIC = "VEL3019";
/** MOD-I5: the module-resolution diagnostic family (VEL6xxx). */
const MODULE_RESOLUTION_DIAGNOSTIC_PREFIX = "VEL6";

// D31 item 23: module initialization cycles are rejected at compile time.
// The modules of a static import cycle evaluate in the emitted ESM
// post-order, so a module-initialization-position read of a binding whose
// source module evaluates later observes an uninitialized live binding and
// crashes with a bare ReferenceError. The module graph is fully known here,
// so the defect is diagnosed on the reading line instead. Reads inside
// function bodies stay legal — pure function cycles are a proper shape — and
// cross-module mutually recursive record types never read a binding at all.
//
// The verdict is a property of the sources alone: it is computed from one
// evaluation order over the whole loaded graph, seeded by the project's own
// entry and then by every remaining evaluation root, never from the caller's
// entry list. `velar check` (one entry) and the language server (every file is
// an entry) therefore agree on the same project, and modules a build reaches
// only through `await import(...)` — additional roots the host does evaluate —
// are ordered instead of skipped.
function appendInitializationCycleDiagnostics(
  modules: ProjectModule[],
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  entryPath: string,
  resolutions: ReadonlyMap<string, readonly ModuleResolutionDiagnostic[]> = new Map(),
): void {
  const resolveDependency = (importerPath: string, source: string): string | null => {
    const target = source.startsWith(".") && extname(source) === ".vel"
      ? resolve(dirname(importerPath), source)
      : velarImports.get(projectImportKey(importerPath, source)) ?? null;
    return target !== null && loaded.has(target) ? target : null;
  };

  const carriesCycleDiagnostic = (module: ProjectModule): boolean =>
    module.result.diagnostics.some((item) => item.code === INITIALIZATION_CYCLE_DIAGNOSTIC);
  const carriesResolutionDiagnostic = (module: ProjectModule): boolean =>
    module.result.diagnostics.some((item) => item.code.startsWith(MODULE_RESOLUTION_DIAGNOSTIC_PREFIX));
  // Nothing to decide and nothing stale to clear: the common project pays only
  // this scan. Every other exit still recomputes from the module's own compile
  // output, so a diagnostic never outlives the cycle (or the resolution
  // failure) that produced it.
  const cycleRelevant = !modules.every((module) => module.result.initializationImportReads.length === 0 && !carriesCycleDiagnostic(module));
  const resolutionRelevant = resolutions.size > 0 || modules.some(carriesResolutionDiagnostic);
  if (!cycleRelevant && !resolutionRelevant) return;

  // Static evaluation edges in source order: import and re-export
  // declarations, excluding dynamic imports (they defer evaluation) and
  // JavaScript or standard modules (they are not .vel graph members).
  const staticDependencies = new Map<string, readonly string[]>();
  const dynamicRoots: string[] = [];
  if (cycleRelevant) {
    for (const [path, module] of loaded) {
      const output: string[] = [];
      const seen = new Set<string>();
      for (const reference of module.inspection.semanticIndex.moduleReferences) {
        const target = resolveDependency(path, reference.source);
        if (target === null) continue;
        if (reference.dynamic) {
          dynamicRoots.push(target);
          continue;
        }
        if (seen.has(target)) continue;
        seen.add(target);
        output.push(target);
      }
      staticDependencies.set(path, output);
    }
  }

  // Tarjan over the static edges: only strongly connected members can read a
  // later-evaluating module, so everything else is skipped immediately.
  const componentOf = new Map<string, number>();
  if (cycleRelevant) {
    let nextIndex = 0;
    let componentCount = 0;
    const indexes = new Map<string, number>();
    const lowLinks = new Map<string, number>();
    const stack: string[] = [];
    const active = new Set<string>();
    const visit = (path: string): void => {
      const index = nextIndex++;
      indexes.set(path, index);
      lowLinks.set(path, index);
      stack.push(path);
      active.add(path);
      for (const dependency of staticDependencies.get(path) ?? []) {
        if (!indexes.has(dependency)) {
          visit(dependency);
          lowLinks.set(path, Math.min(lowLinks.get(path)!, lowLinks.get(dependency)!));
        } else if (active.has(dependency)) {
          lowLinks.set(path, Math.min(lowLinks.get(path)!, indexes.get(dependency)!));
        }
      }
      if (lowLinks.get(path) !== index) return;
      const component = componentCount++;
      while (stack.length > 0) {
        const member = stack.pop()!;
        active.delete(member);
        componentOf.set(member, component);
        if (member === path) break;
      }
    };
    for (const path of loaded.keys()) if (!indexes.has(path)) visit(path);
  }
  const componentSizes = new Map<number, number>();
  for (const component of componentOf.values()) componentSizes.set(component, (componentSizes.get(component) ?? 0) + 1);
  const cyclic = [...componentSizes.values()].some((size) => size > 1);

  // The ESM evaluation order: dependency-first post-order following
  // declaration order, with in-progress modules skipped exactly as the host
  // module loader skips cycle back-edges. Roots are visited entry first, then
  // dynamic-import targets, then anything else the graph holds, each in a
  // stable order so the same sources always produce the same order.
  const order = new Map<string, number>();
  if (cyclic) {
    const visiting = new Set<string>();
    const visit = (path: string): void => {
      if (order.has(path) || visiting.has(path)) return;
      visiting.add(path);
      for (const dependency of staticDependencies.get(path) ?? []) visit(dependency);
      visiting.delete(path);
      order.set(path, order.size);
    };
    const roots = [entryPath, ...[...new Set(dynamicRoots)].sort(), ...[...loaded.keys()].sort()];
    for (const root of roots) if (loaded.has(root)) visit(root);
  }

  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index]!;
    const path = module.inputPath;
    // The overlay is rebuilt from the module's own compile output every time,
    // so it is idempotent under incremental reuse in both directions: a
    // diagnostic is never duplicated, and a module that leaves a cycle gets its
    // emitted code back.
    const compiled = module.compiledResult ?? module.result;
    const additions: Diagnostic[] = [];
    if (cyclic && (componentSizes.get(componentOf.get(path) ?? -1) ?? 0) > 1) {
      for (const read of compiled.initializationImportReads) {
        const target = originModule(resolveDependency(path, read.source), read.imported, loaded, resolveDependency);
        if (target === null || target === path) continue;
        if (componentOf.get(target) !== componentOf.get(path)) continue;
        // A `def` emits a hoisted function declaration that the host
        // initializes at link time, so a cycle member may call one before the
        // defining module evaluates. Every other export shape is in its
        // temporal dead zone until then.
        if (read.imported !== null && loaded.get(target)?.inspection.moduleInterface.hoistedExports?.has(read.imported)) continue;
        const modulePosition = order.get(path);
        const targetPosition = order.get(target);
        if (modulePosition === undefined || targetPosition === undefined || targetPosition < modulePosition) continue;
        additions.push(diagnostic(
          INITIALIZATION_CYCLE_DIAGNOSTIC,
          `Move this read into a function, or extract the shared value into a third module; '${read.source}' has not initialized when this line runs`,
          read.span,
        ));
      }
    }
    // MOD-I5: resolution failures overlay the same way, on the import
    // statement that caused them, rebuilt from the clean compile output so
    // reuse can never duplicate or orphan them.
    {
      const pending = resolutions.get(path) ?? [];
      const seen = new Set<string>();
      for (const item of pending) {
        const reference = compiled.semanticIndex.moduleReferences.find((candidate) => candidate.source === item.source)
          ?? compiled.semanticIndex.moduleReferences[0];
        const span = reference?.span ?? { start: 0, end: Math.min(1, compiled.source.text.length) };
        const key = `${item.code}\0${item.message}\0${span.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push(diagnostic(item.code, item.message, span));
      }
    }
    if (additions.length === 0) {
      if (module.compiledResult === undefined) continue;
      modules[index] = { inputPath: module.inputPath, relativePath: module.relativePath, result: compiled };
      continue;
    }
    modules[index] = {
      ...module,
      compiledResult: compiled,
      result: {
        ...compiled,
        // The compile() contract keeps diagnostics ordered by span.
        diagnostics: [...compiled.diagnostics, ...additions]
          .sort((left, right) => left.span.start - right.span.start || left.code.localeCompare(right.code)),
        // The zero-diagnostics gate for code generation holds after the
        // project-level check as well.
        code: null,
        sourceMap: null,
        embeddedModules: [],
        css: null,
        styleSegments: null,
        runtimeModules: [],
      },
    };
  }
}

/**
 * The module that declares an imported name, following `export {name} from
 * "source"` barrels. Judging a cycle read by the module the import names would
 * let a barrel hide the defining module, whose binding is the one that is
 * actually uninitialized at run time.
 */
function originModule(
  target: string | null,
  imported: string | null,
  loaded: ReadonlyMap<string, LoadedModule>,
  resolveDependency: (importerPath: string, source: string) => string | null,
): string | null {
  let current = target;
  let name = imported;
  const seen = new Set<string>();
  while (current !== null && name !== null && !seen.has(`${current}\0${name}`)) {
    seen.add(`${current}\0${name}`);
    const reExport = loaded.get(current)?.inspection.moduleInterface.reExports.get(name);
    if (reExport === undefined) return current;
    const next = resolveDependency(current, reExport.source);
    if (next === null) return current;
    current = next;
    name = reExport.imported;
  }
  return current;
}

export function moduleInterfaceIdentity(
  interface_: ModuleInspection["moduleInterface"],
  extensions: readonly CompilerExtension[] = [],
): string {
  const node = (kind: string, parts: readonly string[] = []): string => (
    `${kind.length}:${kind}${parts.map((part) => `${part.length}:${part}`).join("")}`
  );
  const typeMap = (values: ReadonlyMap<string, ValueType>): string => node("type-map", [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => node("type-entry", [name, analysisTypeIdentity(type)])));
  const names = (values: ReadonlySet<string>): string => node("names", [...values].sort());
  const types = (values: readonly ValueType[]): string => node("types", values.map(analysisTypeIdentity));
  const namedTypes = node("named-types", [...interface_.namedTypes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, fields]) => node("named-type", [name, typeMap(fields)])));
  const namedTypeReadonlyFields = node("named-type-readonly-fields", [...(interface_.namedTypeReadonlyFields ?? new Map())]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, fields]) => node("named-type-readonly", [name, names(fields)])));
  const namedTypeIdentities = node("named-type-identities", [...interface_.namedTypeIdentities]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, identity]) => node("named-type-identity", [name, identity])));
  // D55 rule 120, and batch M's lesson one layer out: a dependent compiled
  // against the parameter list, the bounds, *and* the template's field types.
  // A change to any of the three has to invalidate that dependent's cache — a
  // bound that does not enter this hash is a constraint that silently
  // disappears from every module already built against it.
  const genericTypes = node("generic-types", [...(interface_.genericTypes ?? new Map())]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, info]) => node("generic-type", [
      name,
      info.identity,
      node("parameter-names", info.parameterNames),
      node("parameter-bounds", info.parameterBounds.map((bound: string | null) => bound ?? "")),
      typeMap(info.fields),
      names(info.readonlyFields ?? new Set()),
    ])));
  const enums = node("enums", [...interface_.enums]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, info]) => node("enum", [name, info.identity, names(info.members)])));
  const classes = node("classes", [...interface_.classes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, info]) => node("class", [
      name,
      info.identity ?? "",
      info.base ?? "",
      info.abstract ? "abstract" : "",
      // A dependent's `using` analysis consumes both the presence of the
      // release contract and whether it must await. Neither is represented by
      // the ordinary class members below, so both states belong here.
      info.dispose ?? "",
      node("parameter-names", info.parameterNames ?? []),
      String(info.requiredParameters),
      types(info.parameters),
      info.constructorRest ? analysisTypeIdentity(info.constructorRest) : "",
      // D68 rule 177: the iteration contract is part of what a dependent
      // compiled against, so changing it has to invalidate the dependent.
      info.iterate ? analysisTypeIdentity(info.iterate) : "",
      names(info.getters),
      names(info.abstractGetters),
      names(info.abstractMethods),
      names(info.staticGetters),
      typeMap(new Map([
        ...[...info.fields].map(([field, value]) => [`field:${field}:${value.mutable ? "let" : "const"}`, value.type] as const),
        ...[...info.methods].map(([method, type]) => [`method:${method}`, type] as const),
        ...[...info.staticFields].map(([field, value]) => [`static-field:${field}:${value.mutable ? "let" : "const"}`, value.type] as const),
        ...[...info.staticMethods].map(([method, type]) => [`static-method:${method}`, type] as const),
      ])),
    ])));
  const extensionOwners = new Map(extensions.map((extension) => [extension.id, extension]));
  let extensionIdentitySize = 0;
  const extensionSegment = (value: string): string => {
    extensionIdentitySize += value.length;
    if (extensionIdentitySize > 1024 * 1024) {
      throw new Error("Compiler extension interface identities cannot exceed 1 MiB per module");
    }
    return `${value.length}:${value}`;
  };
  const extensionExports = node("extension-exports", [...interface_.extensionExports]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([extensionId, values]) => {
      const identify = extensionOwners.get(extensionId)?.inspection?.interfaceExportIdentity;
      if (!identify) {
        throw new Error(`Compiler extension '${extensionId}' exports cross-module interface data without an interfaceExportIdentity contract`);
      }
      const entries = [...values]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => {
          const identity = identify(name, value);
          if (typeof identity !== "string" || identity.length > 1024 * 1024) {
            throw new Error(`Compiler extension '${extensionId}' returned an invalid interface identity for '${name}'`);
          }
          return node("extension-export", [extensionSegment(name), extensionSegment(identity)]);
      });
      return node("extension", [extensionSegment(extensionId), ...entries]);
    }));
  return node("module-interface", [
    typeMap(interface_.exports),
    names(interface_.mutableExports),
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    genericTypes,
    typeMap(interface_.typeAliases),
    enums,
    classes,
    node("reactive", [...interface_.reactiveExports]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, kind]) => node("reactive-entry", [name, kind]))),
    node("re-exports", [...interface_.reExports]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, target]) => node("re-export", [name, target.source, target.imported]))),
    node("tests", interface_.tests.map((item) => `${item.name}\u0000${item.title}`).sort()),
    extensionExports,
  ]);
}

async function createAnalysisContext(
  module: LoadedModule,
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  failures: ProjectFailure[],
  notices: ProjectNotice[],
  declarationCache: Map<string, Promise<TypeScriptDeclarationBridge | null>>,
  externalTypeDependencies: Map<string, Set<string>>,
  interfaceCache: Map<string, ModuleInspection["moduleInterface"]>,
  compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>,
  compilerExtensions: readonly CompilerExtension[],
): Promise<AnalysisContext> {
  const imports = new Map<string, ValueType>();
  const dynamicImports = new Map<string, ValueType>();
  const reactiveImports = new Map<string, "state">();
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  const namedTypeReadonlyFields = new Map<string, ReadonlySet<string>>();
  const namedTypeIdentities = new Map<string, string>();
  const genericTypes = new Map<string, GenericTypeInfo>();
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
      importHiddenTypeMetadata(interface_, namedTypes, namedTypeReadonlyFields, genericTypes, enums, classes);
      continue;
    }
    if (dependency.reExport) {
      const interface_ = standardModuleInterface(dependency.source, compilerExtensions) ?? (() => {
        const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
          ? resolve(dirname(module.inputPath), dependency.source)
          : velarImports.get(projectImportKey(module.inputPath, dependency.source));
        const target = targetPath ? loaded.get(targetPath) : null;
        return target ? resolvedModuleInterface(target, loaded, velarImports, interfaceCache, compiledInterfaces, compilerExtensions) : null;
      })();
      if (interface_) {
        for (const specifier of dependency.specifiers) {
          if (!interface_.exports.has(specifier.imported)) {
            failures.push({ path: module.inputPath, message: missingExportMessage(dependency.source, specifier.imported) });
          }
        }
      }
      continue;
    }
    if (dependency.javascript) {
      // A manual extern module owns the source contract completely, so the
      // automatic TypeScript-declaration probe stays silent for that source.
      if (dependency.unsafe || dependency.externOwned) continue;
      const key = projectImportKey(module.inputPath, dependency.source);
      let pending = declarationCache.get(key);
      if (!pending) {
        pending = loadTypeScriptDeclarations(dependency.source, module.inputPath);
        declarationCache.set(key, pending);
      }
      const declarations = await pending;
      if (!declarations) continue;
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
      if (declarations.unreadableDeclaredTypes) continue;
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
      continue;
    }
    const standard = standardModuleInterface(dependency.source, compilerExtensions);
    if (standard) {
      importInterface(module, dependency, standard, imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, genericTypes, typeAliases, enums, classes, extensionImports, failures);
      continue;
    }
    const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
      ? resolve(dirname(module.inputPath), dependency.source)
      : velarImports.get(projectImportKey(module.inputPath, dependency.source));
    if (!targetPath) continue;
    const target = loaded.get(targetPath);
    if (!target) continue;
    importInterface(module, dependency, resolvedModuleInterface(target, loaded, velarImports, interfaceCache, compiledInterfaces, compilerExtensions), imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, genericTypes, typeAliases, enums, classes, extensionImports, failures);
  }
  return {
    imports,
    dynamicImports,
    reactiveImports,
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    genericTypes,
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
  const mutableExports = new Set(own.mutableExports);
  const reactiveExports = new Map(own.reactiveExports);
  const namedTypes = new Map(own.namedTypes);
  const namedTypeReadonlyFields = new Map(own.namedTypeReadonlyFields ?? []);
  const namedTypeIdentities = new Map(own.namedTypeIdentities);
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
  }
  for (const info of own.enums.values()) enums.set(info.identity, info);
  for (const info of own.classes.values()) if (info.identity) classes.set(info.identity, info);
  const extensionExports = new Map([...own.extensionExports].map(([id, values]) => [id, new Map(values)] as const));
  const resolved: ModuleInspection["moduleInterface"] = { ...own, exports, mutableExports, reactiveExports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, genericTypes, typeAliases, enums, classes, extensionExports };
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

  const enumNames = enums;
  const resolveType = (type: ValueType): ValueType => resolveKnownNominals(expandKnownAliases(type, typeAliases), classes, enumNames, namedTypeIdentities);
  for (const [name, type] of exports) exports.set(name, resolveType(type));
  for (const [name, fields] of namedTypes) {
    namedTypes.set(name, new Map([...fields].map(([field, type]) => [field, resolveType(type)])));
  }
  for (const [name, type] of typeAliases) typeAliases.set(name, resolveType(type));
  for (const [name, info] of classes) {
    classes.set(name, mapClassInfo(
      info,
      resolveType,
      (base) => classes.get(base)?.identity ?? base,
    ));
  }
  return resolved;
}

/**
 * MOD-U7: the package is installed and its manifest reads fine — it is simply
 * a JavaScript package. That is the mirror image of BRG-U2 (a VelarScript
 * package reached through `import js`), and it earns the same
 * reverse-direction teaching instead of a manifest-field complaint that never
 * mentions the bridge the author actually needs.
 */
class JavaScriptOnlyPackageError extends Error {}

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
      if (typeof entry !== "string" || entry.length === 0) throw new JavaScriptOnlyPackageError("package.json must declare 'velar.entry'");
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
  namedTypeReadonlyFields: Map<string, ReadonlySet<string>>,
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
  reactiveImports: Map<string, "state">,
  namedTypes: Map<string, ReadonlyMap<string, ValueType>>,
  namedTypeReadonlyFields: Map<string, ReadonlySet<string>>,
  namedTypeIdentities: Map<string, string>,
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
        failures.push({ path: module.inputPath, message: missingExportMessage(dependency.source, specifier.imported) });
        imports.set(specifier.local, { kind: "unknown" });
        continue;
      }
      imports.set(specifier.local, resolveImportedType(exported));
      const reactive = interface_.reactiveExports.get(specifier.imported);
      if (reactive) reactiveImports.set(specifier.local, reactive);
    }
}

function renameClass(info: ClassInfo, aliases: ReadonlyMap<string, string>): ClassInfo {
  return mapClassInfo(
    info,
    (type) => renameType(type, aliases),
    (base) => aliases.get(base) ?? base,
  );
}

/**
 * Rebuilds the type-bearing parts of a class interface while preserving every
 * other contract field by construction. ClassInfo has gained independent
 * fields such as `dispose` and `iterate`; spelling the whole object at each
 * import/re-export seam made every addition an easy silent omission.
 */
function mapClassInfo(
  info: ClassInfo,
  mapType: (type: ValueType) => ValueType,
  mapBase: (base: string) => string,
): ClassInfo {
  return {
    ...info,
    // D68 rule 177: the iteration contract is part of the class, so its answer
    // is transformed with every other type-bearing member.
    ...(info.iterate ? { iterate: mapType(info.iterate) } : {}),
    parameters: info.parameters.map(mapType),
    ...(info.constructorRest ? { constructorRest: mapType(info.constructorRest) } : {}),
    base: info.base ? mapBase(info.base) : null,
    fields: new Map([...info.fields].map(([name, field]) => [name, { ...field, type: mapType(field.type) }])),
    methods: new Map([...info.methods].map(([name, type]) => [name, mapType(type)])),
    staticFields: new Map([...info.staticFields].map(([name, field]) => [name, { ...field, type: mapType(field.type) }])),
    staticMethods: new Map([...info.staticMethods].map(([name, type]) => [name, mapType(type)])),
  };
}

function renameType(type: ValueType, aliases: ReadonlyMap<string, string>): ValueType {
  switch (type.kind) {
    // D55 rule 121: an application renames through the declaration it applies,
    // not through its display text — `Box<string>` is not a name an import can
    // alias, but `Box` is, and its arguments rename like any other type.
    case "named":
      if (type.application) {
        const renamed = aliases.get(type.application.name) ?? type.application.name;
        return genericApplicationType(
          type.application.declaration,
          renamed,
          type.application.arguments.map((argument) => renameType(argument, aliases)),
          type.readonlyView === true,
        );
      }
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "class":
    case "enum":
    case "enumMember":
    case "classConstructor":
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "typeObject":
      return {
        ...type,
        name: aliases.get(type.name) ?? type.name,
        ...(type.value ? { value: renameType(type.value, aliases) } : {}),
      };
    case "enumObject":
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "optional":
      return optionalOf(renameType(type.inner, aliases));
    case "list":
      return { ...type, element: renameType(type.element, aliases) };
    case "set":
      return { ...type, element: renameType(type.element, aliases) };
    case "map":
      return { ...type, key: renameType(type.key, aliases), value: renameType(type.value, aliases) };
    case "record":
      return { ...type, value: renameType(type.value, aliases) };
    case "promise":
      return { kind: "promise", value: renameType(type.value, aliases) };
    case "runtimeType":
      return { kind: "runtimeType", value: renameType(type.value, aliases) };
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
    case "extension":
      return {
        ...type,
        ...(type.nominal ? { nominal: aliases.get(type.nominal) ?? type.nominal } : {}),
        properties: new Map([...type.properties].map(([name, value]) => [name, renameType(value, aliases)])),
        arguments: type.arguments.map((argument) => renameType(argument, aliases)),
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
  // D55 rule 121: the importing side of the same crossing `resolveNominals`
  // makes on the exporting side. Both call one constructor, so the identity
  // computed here and the identity published there are the same string.
  if (type.kind === "named" && type.application) {
    const arguments_ = type.application.arguments.map((argument) => resolveKnownNominals(argument, classes, enums, namedTypeIdentities));
    const declaration = namedTypeIdentities.get(type.application.name) ?? type.application.declaration;
    return genericApplicationType(declaration, type.application.name, arguments_, type.readonlyView === true);
  }
  if (type.kind === "named" && classes.has(type.name)) {
    const identity = classes.get(type.name)?.identity;
    return {
      kind: "class",
      name: type.name,
      ...(identity ? { identity } : {}),
    };
  }
  if (type.kind === "named" && enums.has(type.name)) return { kind: "enum", name: type.name, identity: enums.get(type.name)!.identity };
  if (type.kind === "enumMember" && enums.has(type.name)
    && type.identity === type.name) return { ...type, identity: enums.get(type.name)!.identity };
  if (type.kind === "named" && !type.identity && namedTypeIdentities.has(type.name)) {
    return { ...type, identity: namedTypeIdentities.get(type.name)! };
  }
  switch (type.kind) {
    case "optional":
      return optionalOf(resolveKnownNominals(type.inner, classes, enums, namedTypeIdentities));
    case "list":
      return { ...type, element: resolveKnownNominals(type.element, classes, enums, namedTypeIdentities) };
    case "set":
      return { ...type, element: resolveKnownNominals(type.element, classes, enums, namedTypeIdentities) };
    case "map":
      return { ...type, key: resolveKnownNominals(type.key, classes, enums, namedTypeIdentities), value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities) };
    case "record":
      return { ...type, value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities) };
    case "promise":
      return { kind: "promise", value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities) };
    case "runtimeType":
      return { kind: "runtimeType", value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities) };
    case "typeObject":
      return type.value
        ? { ...type, value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities) }
        : type;
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
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, resolveKnownNominals(value, classes, enums, namedTypeIdentities)])),
        arguments: type.arguments.map((argument) => resolveKnownNominals(argument, classes, enums, namedTypeIdentities)),
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
    const expanded = expandKnownAliases(aliases.get(type.name)!, aliases, new Set([...seen, type.name]));
    return type.readonlyView ? readonlyViewOf(expanded) : expanded;
  }
  switch (type.kind) {
    // D55 rule 121: aliases stay transparent inside a type argument, on this
    // side of the boundary as on the other.
    case "named":
      return type.application
        ? { ...type, application: { ...type.application, arguments: type.application.arguments.map((argument) => expandKnownAliases(argument, aliases, seen)) } }
        : type;
    case "optional":
      return optionalOf(expandKnownAliases(type.inner, aliases, seen));
    case "list":
      return { ...type, element: expandKnownAliases(type.element, aliases, seen) };
    case "set":
      return { ...type, element: expandKnownAliases(type.element, aliases, seen) };
    case "map":
      return { ...type, key: expandKnownAliases(type.key, aliases, seen), value: expandKnownAliases(type.value, aliases, seen) };
    case "record":
      return { ...type, value: expandKnownAliases(type.value, aliases, seen) };
    case "promise":
      return { kind: "promise", value: expandKnownAliases(type.value, aliases, seen) };
    case "runtimeType":
      return { kind: "runtimeType", value: expandKnownAliases(type.value, aliases, seen) };
    case "typeObject":
      return type.value ? { ...type, value: expandKnownAliases(type.value, aliases, seen) } : type;
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
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, expandKnownAliases(value, aliases, seen)])),
        arguments: type.arguments.map((argument) => expandKnownAliases(argument, aliases, seen)),
      };
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
