import { isBuiltin } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import {
  analysisTypeIdentity,
  advisory,
  classApplicationType,
  compile,
  diagnostic,
  genericApplicationIdentity,
  genericApplicationType,
  inspectModule,
  optionalOf,
  permanentNamespaceCoveringModule,
  readonlyViewOf,
  removedStandardFunctionGuidance,
  type AnalysisContext,
  type Advisory,
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
import { MAX_VELAR_PROJECT_MODULES, resolveVelarSourceSnapshot, type VelarSourceFileSnapshot } from "./source-limits.ts";
import { readBoundedText } from "./bounded-text.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import { byCodeUnit } from "./stable-order.ts";
import {
  loadVelarLibraryArtifactSet,
  packageStableModulePath,
  rebaseModuleInterfaceIdentities,
  type LoadedVelarLibraryArtifact,
} from "./library-artifact.ts";
import { assertVelarPackageEntrySubpath, assertVelarPackageSubpath, type VelarPackageSubpath } from "./package-entry.ts";
import { npmPackageNameFromSpecifier } from "./package-name.ts";
import type { JavaScriptPackageTarget } from "./package-imports.ts";
import { assertJavaScriptDataModuleTarget } from "./javascript-data-module.ts";
import { judgeJavaScriptSpecifier, type JavaScriptSpecifierDiagnostic } from "./javascript-dependency-target.ts";
import { findPackageSelfReferenceRoot } from "./package-scope.ts";
import {
  JavaScriptOnlyPackageError,
  assertVelarPackageCompatibility,
  assertVelarPackageTargetCapabilities,
  canonicalVelarPackageEntryPaths,
  parseVelarSourcePackageManifest,
  type ParsedVelarSourcePackageManifest,
  type VelarPackageEntry,
  type VelarPackageLanguageRange,
  type VelarPackageResource,
  type VelarPackageTarget,
} from "./source-package-manifest.ts";

export type {
  VelarLanguageBound,
  VelarLanguageGeneration,
  VelarPackageEntry,
  VelarPackageLanguageRange,
  VelarPackageResource,
  VelarPackageTarget,
} from "./source-package-manifest.ts";
export type { VelarPackageSubpath } from "./package-entry.ts";

const MAX_PROJECT_RESOURCES = 1024;
const MAX_JSON_RESOURCE_BYTES = 4 * 1024 * 1024;

export interface ProjectModule {
  readonly inputPath: string;
  readonly relativePath: string;
  /** SHA-256 of the exact UTF-8 bytes that produced this compile result. */
  readonly sourceSha256: string;
  readonly result: CompileResult;
  /**
   * The module's own compile output, before the project-level cycle check
   * overlaid its diagnostics and advisories. `result` is derived from this on
   * every compile, so a module whose cycle report disappears recovers its
   * emitted code even when incremental reuse hands the previous entry straight
   * back.
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
  readonly version: string;
  readonly root: string;
  readonly entryPath: string;
  /** Every declared source entry, including the root under `.`. */
  readonly entries: ReadonlyMap<VelarPackageSubpath, VelarPackageEntry>;
  readonly resources: readonly VelarPackageResource[];
  readonly targets: readonly VelarPackageTarget[];
  readonly requiredCapabilities: readonly string[];
  /**
   * D90 R13: the language generation range the package declares it needs, or
   * null when it declares none. Optional is the ruling's own boundary — a
   * package that says nothing is checked exactly as it was before.
   */
  readonly requiredLanguage: VelarPackageLanguageRange | null;
  /** Frozen ABI-1 entries selected by imports in this project, keyed by public subpath. */
  readonly artifacts: ReadonlyMap<VelarPackageSubpath, LoadedVelarLibraryArtifact>;
}

export interface ProjectResource {
  readonly importerPath: string;
  readonly source: string;
  readonly inputPath: string;
  readonly content: string;
  readonly kind: "json";
  readonly packageName: string | null;
  readonly packageRoot: string | null;
  readonly packageRelativePath: string | null;
  readonly packageSubpath: `./${string}` | null;
}

export interface ProjectResult {
  readonly entryPath: string;
  /** 本次编译中会生成 `@main` 正文的程序与 Worker 入口。 */
  readonly executionEntries: ReadonlySet<string>;
  readonly sourceRoot: string;
  readonly projectRoot: string;
  readonly publicRoot: string;
  readonly compilerExtensions: readonly CompilerExtension[];
  readonly extensionConfig: ReadonlyMap<string, unknown>;
  readonly framework: ResolvedFrameworkHost | null;
  readonly capabilities: ReadonlySet<string>;
  readonly modules: readonly ProjectModule[];
  /** Fully resolved interfaces, including explicit package barrels. */
  readonly moduleInterfaces: ReadonlyMap<string, ModuleInterface>;
  readonly failures: readonly ProjectFailure[];
  readonly notices: readonly ProjectNotice[];
  readonly velarPackages: readonly VelarSourcePackage[];
  readonly velarImports: ReadonlyMap<string, string>;
  /** Installed artifact interfaces keyed by importer and package specifier. */
  readonly velarArtifactInterfaces: ReadonlyMap<string, ModuleInterface>;
  /** Selected frozen artifacts keyed by importer and package specifier. */
  readonly velarArtifactImports: ReadonlyMap<string, LoadedVelarLibraryArtifact>;
  readonly resources: readonly ProjectResource[];
  readonly resourceImports: ReadonlyMap<string, ProjectResource>;
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
  /**
   * The exact package target owned by a caller. Config-backed entry points
   * derive it once from VelarProjectConfig so every command and extra root
   * enforces the same boundary; artifact builds may pin an explicit target.
   */
  readonly packageTarget?: VelarPackageTarget;
  readonly exportTestFunctions?: boolean;
  /**
   * 是否为已编译模块构建 Source Map。默认开启；`check` 和关闭映射的生产构建
   * 会传 false，使编译阶段本身也跳过映射计算，而不只是最后不写 `.map` 文件。
   */
  readonly emitSourceMaps?: boolean;
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
  readonly sourceSha256: string;
  readonly inspection: ModuleInspection;
  readonly package: VelarSourcePackage | null;
  readonly resourceContents: ReadonlyMap<string, string>;
}

interface PendingModule {
  readonly inputPath: string;
  readonly package: VelarSourcePackage | null;
}

function projectModuleResult(
  module: Pick<ProjectModule, "inputPath" | "relativePath" | "sourceSha256">,
  result: CompileResult,
): ProjectModule {
  return { inputPath: module.inputPath, relativePath: module.relativePath, sourceSha256: module.sourceSha256, result };
}

export function projectImportKey(importerPath: string, source: string): string {
  return `${resolve(importerPath)}\0${source}`;
}

function registerVelarPackage(
  packages: Map<string, VelarSourcePackage>,
  candidate: VelarSourcePackage,
): VelarSourcePackage {
  const existing = packages.get(candidate.name);
  if (existing && existing.root !== candidate.root) {
    throw new Error(`VelarScript package '${candidate.name}' resolves to multiple installed versions; use one package instance per application build`);
  }
  if (!existing) {
    packages.set(candidate.name, candidate);
    return candidate;
  }
  const artifacts = new Map(existing.artifacts);
  for (const [subpath, artifact] of candidate.artifacts) artifacts.set(subpath, artifact);
  const merged = artifacts.size === existing.artifacts.size ? existing : { ...existing, artifacts };
  packages.set(candidate.name, merged);
  return merged;
}

/**
 * MOD-I5: a module-resolution failure is a positional diagnostic on the
 * import statement that caused it — code, span, and owned wording — exactly
 * like every other compiler failure. The project driver records them here
 * during the dependency walk and overlays them onto the importer's compile
 * result next to the initialization-cycle diagnostics.
 */
type ModuleResolutionDiagnostic = JavaScriptSpecifierDiagnostic;

interface JavaScriptDependencyContext {
  readonly packageTarget: VelarPackageTarget;
  readonly resolutionTarget: JavaScriptPackageTarget;
  readonly resolveSpecifiers: boolean;
  readonly failures: ProjectFailure[];
  readonly verdicts: Map<string, ModuleResolutionDiagnostic | null>;
  readonly recordResolution: (importerPath: string, source: string, code: string, message: string) => void;
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
  const packageCapabilities = new Set(capabilities);
  if (options.packageTarget !== undefined && options.packageTarget !== "core") packageCapabilities.add(options.packageTarget);
  else if (options.packageTarget === undefined && packageCapabilities.size === 0 && framework === null) packageCapabilities.add("node");
  const packageTarget: VelarPackageTarget = options.packageTarget ?? (packageCapabilities.has("desktop")
    ? "desktop"
    : packageCapabilities.has("web")
      ? "web"
      : packageCapabilities.has("node")
        ? "node"
        : "core");
  const javascriptPackageTarget: JavaScriptPackageTarget = packageTarget === "web" || framework?.host.target === "browser"
    ? "browser"
    : "node";
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
  const velarPackages = new Map<string, VelarSourcePackage>(), velarPackageResolutionCache = createVelarPackageResolutionCache();
  const velarImports = new Map<string, string>();
  const velarArtifactInterfaces = new Map<string, ModuleInterface>();
  const velarArtifactImports = new Map<string, LoadedVelarLibraryArtifact>();
  const resources = new Map<string, ProjectResource>();
  const resourceImports = new Map<string, ProjectResource>();
  const unsafeCssOwners = new Map<string, string>();
  const javascriptSpecifierVerdicts = new Map<string, ModuleResolutionDiagnostic | null>();
  const resolutionDiagnostics = new Map<string, ModuleResolutionDiagnostic[]>();
  const recordResolution = (importerPath: string, source: string, code: string, message: string): void => {
    const list = resolutionDiagnostics.get(importerPath) ?? [];
    list.push({ code, message, source });
    resolutionDiagnostics.set(importerPath, list);
  };
  const javascriptDependencies: JavaScriptDependencyContext = {
    packageTarget,
    resolutionTarget: javascriptPackageTarget,
    resolveSpecifiers: options.resolveJavaScriptSpecifiers !== false,
    failures,
    verdicts: javascriptSpecifierVerdicts,
    recordResolution,
  };
  // The importing statement behind each scheduled module, so a failure that
  // only surfaces when the target is visited (a missing file, a
  // case-divergent duplicate) can still land on the import that caused it.
  const importOrigins = new Map<string, { readonly importer: string; readonly source: string }>();
  // MOD-D2: one canonical file must be one module. The canonical (real-cased,
  // symlink-resolved) path of every visited module detects a second spelling
  // of the same file before it double-instantiates.
  const canonicalModuleKeys = new Map<string, string>();
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

  // An index cursor, not `shift()`: the queue is bounded by
  // MAX_VELAR_PROJECT_MODULES, and shifting each of those entries off the
  // front costs O(n) apiece, making the dependency walk itself quadratic.
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const pendingModule = pending[cursor]!;
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
    let source: VelarSourceFileSnapshot;
    try {
      source = await resolveVelarSourceSnapshot(inputPath, overrides.get(inputPath));
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
    const { text, sha256: sourceSha256 } = source;
    const relativePath = normalizeModulePath(pendingModule.package
      ? join("__velar_packages__", pendingModule.package.name, pathWithinBoundary)
      : relative(sourceRoot, inputPath));
    const inspection = inspectModule(text, { path: inputPath, extensions: compilerExtensions });
    const resourceContents = new Map<string, string>();
    for (const resource of inspection.resources) {
      if (resource.kind === "json") {
        try {
          const resolved = await resolveJsonResource(resource.source, inputPath, pendingModule.package, sourceRoot, velarPackageResolutionCache);
          if (resolved.package_) {
            assertVelarPackageCompatibility(resolved.package_, packageTarget, packageCapabilities);
            registerVelarPackage(velarPackages, resolved.package_);
          }
          const content = overrides.get(resolved.resource.inputPath)
            ?? await readJsonResource(resolved.resource.inputPath, resource.source);
          if (Buffer.byteLength(content, "utf8") > MAX_JSON_RESOURCE_BYTES) {
            throw new RangeError(`json resource '${resource.source}' exceeds ${MAX_JSON_RESOURCE_BYTES} bytes`);
          }
          try {
            JSON.parse(content);
          } catch (error) {
            throw new Error(`JSON is invalid: ${hostErrorMessage(error)}`);
          }
          const projectResource: ProjectResource = {
            importerPath: inputPath,
            source: resource.source,
            inputPath: resolved.resource.inputPath,
            content,
            kind: "json",
            packageName: resolved.package_?.name ?? pendingModule.package?.name ?? null,
            packageRoot: resolved.package_?.root ?? pendingModule.package?.root ?? null,
            packageRelativePath: resolved.resource.relativePath,
            packageSubpath: resolved.resource.subpath,
          };
          const importKey = projectImportKey(inputPath, resource.source);
          resourceContents.set(resource.source, content);
          resourceImports.set(importKey, projectResource);
          const importMode = projectResource.source.startsWith(".") ? "relative" : "package";
          resources.set(`${projectResource.kind}\0${projectResource.inputPath}\0${projectResource.packageSubpath ?? ""}\0${importMode}`, projectResource);
          if (resources.size > MAX_PROJECT_RESOURCES) throw new RangeError(`A project cannot import more than ${MAX_PROJECT_RESOURCES} resources`);
        } catch (error) {
          failures.push({ path: inputPath, message: `Cannot load json resource '${resource.source}': ${hostErrorMessage(error)}` });
        }
        continue;
      }
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
    loaded.set(inputPath, { inputPath, relativePath, text, sourceSha256, inspection, package: pendingModule.package, resourceContents });

    for (const dependency of inspection.dependencies) {
      if (dependency.resource) continue;
      if (dependency.javascript) {
        await checkJavaScriptDependency(dependency.source, inputPath, javascriptDependencies);
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
          const resolvedPackage = await resolveVelarSourcePackage(dependency.source, inputPath, packageTarget, packageCapabilities, velarPackageResolutionCache);
          const package_ = registerVelarPackage(velarPackages, resolvedPackage.package_);
          const importKey = projectImportKey(inputPath, dependency.source);
          if (resolvedPackage.artifact) {
            velarArtifactInterfaces.set(importKey, resolvedPackage.artifact.moduleInterface);
            velarArtifactImports.set(importKey, resolvedPackage.artifact);
          } else {
            velarImports.set(importKey, resolvedPackage.entry.inputPath);
            importOrigins.set(resolvedPackage.entry.inputPath, { importer: inputPath, source: dependency.source });
            enqueue({ inputPath: resolvedPackage.entry.inputPath, package: package_ });
          }
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
  const previousModules = new Map(previous?.modules.map((module) => [module.inputPath, module]));
  const affected = previous
    ? affectedModules(loaded, velarImports, velarArtifactImports, resourceImports, previous, previousModules, changedPaths)
    : new Set(loaded.keys());
  if (previous) {
    const currentExecutionEntries = new Set(initialEntries);
    const previousExecutionEntries = previous.executionEntries ?? new Set([previous.entryPath]);
    for (const path of new Set([...currentExecutionEntries, ...previousExecutionEntries])) {
      if (currentExecutionEntries.has(path) !== previousExecutionEntries.has(path)) affected.add(path);
    }
  }
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
  const compilationGroups = dependencyFirstCompilationGroups(loaded, velarImports, compilerExtensions);
  for (const group of compilationGroups) {
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
      // Dependency-first compilation makes every interface outside this SCC
      // stable. Retain those resolved entries: clearing the whole cache made
      // each parent recursively rebuild the complete transitive chain, so a
      // legal 3000-module line still consumed 3000 host stack frames after
      // the graph algorithms themselves had become iterative. Members of the
      // current SCC are the only entries whose pass can change them.
      for (const module of group) interfaceCache.delete(module.inputPath);
      const nextResults = new Map<string, ProjectModule>();
      for (const module of group) {
        const analysis = await createAnalysisContext(
          module,
          loaded,
          velarImports,
          velarArtifactInterfaces,
          failures,
          notices,
          declarationCache,
          externalTypeDependencies,
          interfaceCache,
          compiledInterfaces,
          compilerExtensions,
        );
        const compiled = importedReactiveAssignmentDiagnostics(compile(module.text, {
          path: module.inputPath,
          analysis,
          extensions: compilerExtensions,
          resourceContents: module.resourceContents,
          sharedRuntimeModules: true,
          executeMain: initialEntries.includes(module.inputPath),
          emitSourceMap: options.emitSourceMaps !== false,
          ...(options.exportTestFunctions ? { exportFunctions: new Set(module.inspection.moduleInterface.tests.map((item) => item.name)) } : {}),
        }), analysis.reactiveImports ?? new Map());
        const result = module.package === null
          ? compiled
          : { ...compiled, moduleInterface: stableSourcePackageInterface(module, compiled.moduleInterface, loaded) };
        nextResults.set(module.inputPath, projectModuleResult(module, result));
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
  // D90 R3(a): module order decides the concatenated stylesheet's bytes, its
  // content hash, and `buildId`. `localeCompare` follows the collation the
  // process environment selects, so it made those outputs — and the cascade
  // winner between two equal-specificity rules — depend on the build
  // machine's `LC_ALL`. Order by code unit over the POSIX-normalized
  // relative path instead.
  modules.sort((left, right) => byCodeUnit(left.relativePath, right.relativePath));
  // Resolve every public barrel after the final SCC pass. A frozen library
  // serializes this map, so source mode and artifact mode expose the same
  // flattened contract even when the package entry only re-exports names.
  // Walk the same dependency-first groups used for compilation: clearing the
  // cache and starting at the entry would otherwise recurse through one host
  // frame per module while resolving a legal 3000-module line.
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
    executionEntries: new Set(initialEntries),
    sourceRoot,
    projectRoot,
    publicRoot,
    compilerExtensions,
    extensionConfig,
    framework,
    capabilities,
    modules,
    moduleInterfaces,
    failures: uniqueFailures(failures),
    notices: uniqueNotices(notices),
    velarPackages: [...velarPackages.values()],
    velarImports,
    velarArtifactInterfaces,
    velarArtifactImports,
    resources: [...resources.values()],
    resourceImports,
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
    const wanted = basename(targetPath);
    return nearestName(wanted, names);
  } catch {
    return null;
  }
}

async function checkJavaScriptDependency(
  source: string,
  importerPath: string,
  context: JavaScriptDependencyContext,
): Promise<void> {
  if (source.startsWith(".")) {
    context.failures.push({
      path: importerPath,
      message: `Relative JavaScript import target '${source}' cannot be emitted; move the JavaScript module into a package and import it by package name`,
    });
    return;
  }
  if (isBuiltin(source)) {
    if (context.packageTarget !== "node") {
      context.recordResolution(
        importerPath,
        source,
        "VEL6006",
        `JavaScript Node builtin import ${JSON.stringify(source)} is available only to the Node target; the current target is '${context.packageTarget}'`,
      );
    }
    return;
  }
  if (source.startsWith("data:")) {
    try {
      assertJavaScriptDataModuleTarget(source, context.packageTarget);
    } catch (error) {
      context.recordResolution(
        importerPath,
        source,
        "VEL6006",
        `Inline JavaScript data module is not valid for the '${context.packageTarget}' target: ${hostErrorMessage(error)}`,
      );
    }
    return;
  }
  if (!context.resolveSpecifiers) return;
  const key = projectImportKey(importerPath, source);
  let verdict = context.verdicts.get(key);
  if (verdict === undefined) {
    verdict = await judgeJavaScriptSpecifier(source, importerPath, context.resolutionTarget, context.packageTarget);
    context.verdicts.set(key, verdict);
  }
  if (verdict) context.recordResolution(importerPath, source, verdict.code, verdict.message);
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
    return "Standard module 'velar/javascript' is not part of VelarScript; JavaScript and TypeScript tooling belongs to the consuming project";
  }
  if (source === "velar/text-buffer") {
    return "Standard module 'velar/text-buffer' is not part of VelarScript; applications must own or install their text-buffer implementation";
  }
  // D114 S3: the module retired into List members. The compiler already names
  // the member each imported function became, one report per name, so this one
  // answers the specifier without calling a retired module unknown.
  if (source === "velar/collections") {
    return "Standard module 'velar/collections' retired; every collection operation is a checked List member — values.groupBy(key) — and 'range' is a Core prelude name that needs no import";
  }
  return null;
}

function extensionOwnsStandardModule(source: string, extensions: readonly CompilerExtension[]): boolean {
  return extensions.some((extension) => extension.id !== "@velarscript/node" && extension.modules?.interfaces.has(source));
}

/**
 * D71 rule 184 widened what `reactiveExports` means without widening its marker:
 * both an exported `state` and an exported `computed` are published as `"state"`
 * so that an imported bare read lowers through `.get()`. The marker therefore
 * says *reactive*, not which word the author wrote — printing it as a noun
 * called an exported `computed` a "state binding" and offered it a mutator it
 * can never have. The message names only what this map establishes, and points
 * at `action`, which is the vocabulary the language actually has; the derived
 * half gets its own sharper VEL5063 from the Web analyzer before it ever
 * reaches here.
 */
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
      message: `Cannot assign to imported reactive binding '${imported!.local}'; it is read-only here. Export an action from the owning module that changes it and call that instead`,
    };
  });
  return diagnostics.some((item, index) => item !== result.diagnostics[index])
    ? { ...result, diagnostics }
    : result;
}

function affectedModules(
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  velarArtifactImports: ReadonlyMap<string, LoadedVelarLibraryArtifact>,
  resourceImports: ReadonlyMap<string, ProjectResource>,
  previous: ProjectResult,
  previousModules: ReadonlyMap<string, ProjectModule>,
  changedPaths: ReadonlySet<string>,
): Set<string> {
  const affected = new Set([...changedPaths].map((path) => resolve(path)));
  const reverse = new Map<string, Set<string>>();
  const dependencies = (
    path: string,
    values: readonly { readonly source: string; readonly javascript: boolean }[],
    imports: ReadonlyMap<string, string>,
    artifacts: ReadonlyMap<string, LoadedVelarLibraryArtifact>,
  ): void => {
    for (const dependency of values) {
      if (dependency.javascript) continue;
      const target = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
        ? resolve(dirname(path), dependency.source)
        : imports.get(projectImportKey(path, dependency.source));
      const artifact = artifacts.get(projectImportKey(path, dependency.source));
      const targets = target === undefined
        ? artifactInputs(artifact)
        : [target, ...artifactInputs(artifact)];
      for (const dependencyPath of targets) {
        const dependents = reverse.get(dependencyPath) ?? new Set<string>();
        dependents.add(path);
        reverse.set(dependencyPath, dependents);
      }
    }
  };
  for (const module of loaded.values()) {
    dependencies(module.inputPath, module.inspection.dependencies, velarImports, velarArtifactImports);
  }
  const previousArtifactImports = previous.velarArtifactImports
    ?? new Map<string, LoadedVelarLibraryArtifact>();
  for (const module of previous.modules) {
    dependencies(module.inputPath, module.result.dependencies, previous.velarImports, previousArtifactImports);
  }
  const resources = (
    path: string,
    values: readonly { readonly source: string }[],
    imports: ReadonlyMap<string, ProjectResource>,
  ): void => {
    for (const resource of values) {
      const target = imports.get(projectImportKey(path, resource.source))?.inputPath
        ?? (resource.source.startsWith(".") ? resolve(dirname(path), resource.source) : null);
      if (!target) continue;
      const dependents = reverse.get(target) ?? new Set<string>();
      dependents.add(path);
      reverse.set(target, dependents);
    }
  };
  for (const module of loaded.values()) resources(module.inputPath, module.inspection.resources, resourceImports);
  for (const module of previous.modules) resources(module.inputPath, module.result.resources, previous.resourceImports);
  for (const [dependency, importers] of previous.externalTypeDependencies) {
    const dependents = reverse.get(dependency) ?? new Set<string>();
    for (const importer of importers) dependents.add(importer);
    reverse.set(dependency, dependents);
  }
  // An index cursor, not `shift()`: the array shift is O(n) per element, so
  // the closure walk was quadratic in the number of affected modules.
  const pending = [...affected];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    for (const dependent of reverse.get(pending[cursor]!) ?? []) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      pending.push(dependent);
    }
  }
  // A module the previous result never held is affected by definition. Asking
  // that of the previous module *list* was a linear scan per loaded module —
  // O(M²) string comparisons on every keystroke at the 4096-module cap — for
  // a question the caller's map already answers in constant time.
  for (const module of loaded.keys()) if (!previousModules.has(module)) affected.add(module);
  return affected;
}

function artifactInputs(artifact: LoadedVelarLibraryArtifact | undefined): readonly string[] {
  return artifact
    ? [
        artifact.receiptPath,
        artifact.entryPath,
        artifact.sourceMapPath,
        artifact.interfacePath,
        ...artifact.entrySnapshots.flatMap((snapshot) => [snapshot.path, snapshot.sourceMapPath]),
        ...artifact.interfacePaths,
        ...artifact.chunkPaths,
        ...artifact.chunkSnapshots.flatMap((snapshot) => [snapshot.path, snapshot.sourceMapPath]),
      ]
      .map((path) => resolve(path))
    : [];
}

function dependencyFirstCompilationGroups(
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  compilerExtensions: readonly CompilerExtension[],
): readonly (readonly LoadedModule[])[] {
  return stronglyConnectedPaths(
    loaded.keys(),
    (path) => moduleDependencies(loaded.get(path)!, loaded, velarImports, compilerExtensions),
  ).map((group) => group
    .map((path) => loaded.get(path)!)
    .sort((left, right) => byCodeUnit(left.inputPath, right.inputPath)));
}

/** Iterative Tarjan: the public 4096-module bound must not depend on host stack depth. */
function stronglyConnectedPaths(
  paths: Iterable<string>,
  dependencies: (path: string) => readonly string[],
): readonly (readonly string[])[] {
  interface Frame {
    readonly path: string;
    readonly parent: string | null;
    readonly dependencies: readonly string[];
    next: number;
  }
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const componentStack: string[] = [];
  const active = new Set<string>();
  const groups: string[][] = [];
  const frames: Frame[] = [];
  const begin = (path: string, parent: string | null): void => {
    const index = nextIndex++;
    indexes.set(path, index);
    lowLinks.set(path, index);
    componentStack.push(path);
    active.add(path);
    frames.push({ path, parent, dependencies: dependencies(path), next: 0 });
  };

  for (const root of paths) {
    if (indexes.has(root)) continue;
    begin(root, null);
    while (frames.length > 0) {
      const frame = frames.at(-1)!;
      const dependency = frame.dependencies[frame.next];
      if (dependency !== undefined) {
        frame.next += 1;
        if (!indexes.has(dependency)) {
          begin(dependency, frame.path);
        } else if (active.has(dependency)) {
          lowLinks.set(frame.path, Math.min(lowLinks.get(frame.path)!, indexes.get(dependency)!));
        }
        continue;
      }

      frames.pop();
      if (frame.parent !== null) {
        lowLinks.set(frame.parent, Math.min(lowLinks.get(frame.parent)!, lowLinks.get(frame.path)!));
      }
      if (lowLinks.get(frame.path) !== indexes.get(frame.path)) continue;
      const group: string[] = [];
      while (componentStack.length > 0) {
        const member = componentStack.pop()!;
        active.delete(member);
        group.push(member);
        if (member === frame.path) break;
      }
      groups.push(group);
    }
  }
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
const CIRCULAR_IMPORT_ADVISORY = "VEL6010";
/** MOD-I5: the module-resolution diagnostic family (VEL6xxx). */
const MODULE_RESOLUTION_DIAGNOSTIC_PREFIX = "VEL6";

// D31 item 23: module initialization cycles are rejected at compile time.
// The modules of a static import cycle evaluate in the emitted ESM
// post-order, so a module-initialization-position read of a binding whose
// source module evaluates later observes an uninitialized live binding and
// crashes with a bare ReferenceError. The module graph is fully known here,
// so the defect is diagnosed on the reading line instead. Reads inside
// function bodies stay legal — pure function cycles remain executable and
// receive the non-blocking project-graph advisory below — and
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
  const carriesCycleAdvisory = (module: ProjectModule): boolean =>
    module.result.advisories.some((item) => item.code === CIRCULAR_IMPORT_ADVISORY);
  const carriesResolutionDiagnostic = (module: ProjectModule): boolean =>
    module.result.diagnostics.some((item) => item.code.startsWith(MODULE_RESOLUTION_DIAGNOSTIC_PREFIX));
  // Nothing to decide and nothing stale to clear: the common project pays only
  // this scan. Every other exit still recomputes from the module's own compile
  // output, so a diagnostic never outlives the cycle (or the resolution
  // failure) that produced it.
  const cycleRelevant = !modules.every((module) => module.result.initializationImportReads.length === 0 && !carriesCycleDiagnostic(module));
  const topologyRelevant = cycleRelevant
    || modules.some(carriesCycleAdvisory)
    || modules.some((module) => module.result.semanticIndex.moduleReferences.some((reference) =>
      !reference.dynamic && resolveDependency(module.inputPath, reference.source) !== null));
  const resolutionRelevant = resolutions.size > 0 || modules.some(carriesResolutionDiagnostic);
  if (!topologyRelevant && !resolutionRelevant) return;

  // Static evaluation edges in source order: import and re-export
  // declarations, excluding dynamic imports (they defer evaluation) and
  // JavaScript or standard modules (they are not .vel graph members).
  const staticDependencies = new Map<string, readonly string[]>();
  const dynamicRoots: string[] = [];
  if (topologyRelevant) {
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
  if (topologyRelevant) {
    stronglyConnectedPaths(loaded.keys(), (path) => staticDependencies.get(path) ?? [])
      .forEach((members, component) => {
        for (const member of members) componentOf.set(member, component);
      });
  }
  const componentSizes = new Map<number, number>();
  for (const component of componentOf.values()) componentSizes.set(component, (componentSizes.get(component) ?? 0) + 1);
  const cyclicComponents = new Set(
    [...componentSizes.entries()].filter(([, size]) => size > 1).map(([component]) => component),
  );
  for (const [path, dependencies] of staticDependencies) {
    if (dependencies.includes(path)) {
      const component = componentOf.get(path);
      if (component !== undefined) cyclicComponents.add(component);
    }
  }
  const cyclic = cyclicComponents.size > 0;
  const componentMembers = new Map<number, string[]>();
  for (const [path, component] of componentOf) {
    componentMembers.set(component, [...(componentMembers.get(component) ?? []), path]);
  }
  const relativePathByInput = new Map(modules.map((module) => [module.inputPath, module.relativePath]));

  // The ESM evaluation order: dependency-first post-order following
  // declaration order, with in-progress modules skipped exactly as the host
  // module loader skips cycle back-edges. Roots are visited entry first, then
  // dynamic-import targets, then anything else the graph holds, each in a
  // stable order so the same sources always produce the same order.
  const order = new Map<string, number>();
  if (cyclic) {
    const visiting = new Set<string>();
    const roots = [entryPath, ...[...new Set(dynamicRoots)].sort(), ...[...loaded.keys()].sort()];
    for (const root of roots) {
      if (!loaded.has(root) || order.has(root)) continue;
      const frames: { readonly path: string; readonly dependencies: readonly string[]; next: number }[] = [];
      const begin = (path: string): void => {
        visiting.add(path);
        frames.push({ path, dependencies: staticDependencies.get(path) ?? [], next: 0 });
      };
      begin(root);
      while (frames.length > 0) {
        const frame = frames.at(-1)!;
        const dependency = frame.dependencies[frame.next];
        if (dependency !== undefined) {
          frame.next += 1;
          if (!order.has(dependency) && !visiting.has(dependency)) begin(dependency);
          continue;
        }
        frames.pop();
        visiting.delete(frame.path);
        if (!order.has(frame.path)) order.set(frame.path, order.size);
      }
    }
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
    const advisoryAdditions: Advisory[] = [];
    const component = componentOf.get(path);
    if (cyclic && component !== undefined && cyclicComponents.has(component)) {
      const members = (componentMembers.get(component) ?? [])
        .map((member) => relativePathByInput.get(member) ?? basename(member))
        .sort(byCodeUnit);
      const message = `Circular module dependency includes ${members.join(", ")}; extract shared contracts into a lower-level module so dependencies flow in one direction`;
      const seen = new Set<string>();
      for (const reference of compiled.semanticIndex.moduleReferences) {
        if (reference.dynamic) continue;
        const target = resolveDependency(path, reference.source);
        if (target === null || componentOf.get(target) !== component) continue;
        const key = `${reference.source}\0${reference.span.start}\0${reference.span.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        advisoryAdditions.push(advisory(CIRCULAR_IMPORT_ADVISORY, message, reference.span));
      }
    }
    if (cyclic && (componentSizes.get(componentOf.get(path) ?? -1) ?? 0) > 1) {
      for (const read of compiled.initializationImportReads) {
        const imported = resolveDependency(path, read.source);
        const origin = originModule(imported, read.imported, loaded, resolveDependency);
        const target = origin.module;
        if (target === null || target === path) continue;
        if (componentOf.get(target) !== componentOf.get(path)) continue;
        // A `def` emits a hoisted function declaration that the host
        // initializes at link time, so a cycle member may call one before the
        // defining module evaluates. Every other export shape is in its
        // temporal dead zone until then.
        //
        // The exemption is a fact about the *origin* module's own export, so
        // it must be asked with the name that module declares. An aliasing
        // barrel (`export {value as helper}`) renames on the way through, and
        // asking with the import-site alias answered about an unrelated
        // export of the same name: it suppressed a real cycle read whenever
        // the origin happened to have a `def` under the alias, and reported a
        // correct program whenever the origin's `def` was renamed.
        if (origin.name !== null && loaded.get(target)?.inspection.moduleInterface.hoistedExports?.has(origin.name)) continue;
        const modulePosition = order.get(path);
        const targetPosition = order.get(target);
        if (modulePosition === undefined || targetPosition === undefined || targetPosition < modulePosition) continue;
        additions.push(diagnostic(
          INITIALIZATION_CYCLE_DIAGNOSTIC,
          `Move this read into a function, or extract the shared value into a third module; ${uninitializedModuleName(read.source, imported, target, loaded)} has not initialized when this line runs`,
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
    if (additions.length === 0 && advisoryAdditions.length === 0) {
      if (module.compiledResult === undefined) continue;
      modules[index] = projectModuleResult(module, compiled);
      continue;
    }
    const diagnostics = [...compiled.diagnostics, ...additions]
      .sort((left, right) => left.span.start - right.span.start || byCodeUnit(left.code, right.code));
    const advisories = [...compiled.advisories, ...advisoryAdditions]
      .sort((left, right) => left.span.start - right.span.start || byCodeUnit(left.code, right.code));
    modules[index] = {
      ...module,
      compiledResult: compiled,
      result: additions.length === 0
        ? { ...compiled, diagnostics, advisories }
        : {
            ...compiled,
            // The compile() contract keeps reports ordered by span. Advisories
            // stay visible without entering this zero-diagnostics emit gate.
            diagnostics,
            advisories,
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
 * "source"` barrels, together with the name that module declares it under.
 * Judging a cycle read by the module the import names would let a barrel hide
 * the defining module, whose binding is the one that is actually
 * uninitialized at run time; judging it by the import-site alias would ask
 * the defining module about a name it may not use for this export.
 */
function originModule(
  target: string | null,
  imported: string | null,
  loaded: ReadonlyMap<string, LoadedModule>,
  resolveDependency: (importerPath: string, source: string) => string | null,
): { readonly module: string | null; readonly name: string | null } {
  let current = target;
  let name = imported;
  const seen = new Set<string>();
  while (current !== null && name !== null && !seen.has(`${current}\0${name}`)) {
    seen.add(`${current}\0${name}`);
    const reExport = loaded.get(current)?.inspection.moduleInterface.reExports.get(name);
    if (reExport === undefined) return { module: current, name };
    const next = resolveDependency(current, reExport.source);
    if (next === null) return { module: current, name };
    current = next;
    name = reExport.imported;
  }
  return { module: current, name };
}

/**
 * The module the author must open. Through a re-export barrel the specifier
 * written at the import site names a module that has fully initialized, so
 * naming it alone states something false; name the origin and keep the
 * specifier as the route to it.
 */
function uninitializedModuleName(
  source: string,
  imported: string | null,
  origin: string,
  loaded: ReadonlyMap<string, LoadedModule>,
): string {
  if (imported === origin) return `'${source}'`;
  return `'${loaded.get(origin)?.relativePath ?? origin}' (re-exported by '${source}')`;
}

export function moduleInterfaceIdentity(
  interface_: ModuleInspection["moduleInterface"],
  extensions: readonly CompilerExtension[] = [],
): string {
  const node = (kind: string, parts: readonly string[] = []): string => (
    `${kind.length}:${kind}${parts.map((part) => `${part.length}:${part}`).join("")}`
  );
  const typeMap = (values: ReadonlyMap<string, ValueType>): string => node("type-map", [...values]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, type]) => node("type-entry", [name, analysisTypeIdentity(type)])));
  const names = (values: ReadonlySet<string>): string => node("names", [...values].sort());
  const types = (values: readonly ValueType[]): string => node("types", values.map(analysisTypeIdentity));
  const namedTypes = node("named-types", [...interface_.namedTypes]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, fields]) => node("named-type", [name, typeMap(fields)])));
  const namedTypeReadonlyFields = node("named-type-readonly-fields", [...(interface_.namedTypeReadonlyFields ?? new Map())]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, fields]) => node("named-type-readonly", [name, names(fields)])));
  const namedTypeIdentities = node("named-type-identities", [...interface_.namedTypeIdentities]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, identity]) => node("named-type-identity", [name, identity])));
  const namedTypeBases = node("named-type-bases", [...(interface_.namedTypeBases ?? new Map())]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, base]) => node("named-type-base", [name, analysisTypeIdentity(base)])));
  // D55 rule 120, and batch M's lesson one layer out: a dependent compiled
  // against the parameter list, the bounds, *and* the template's field types.
  // A change to any of the three has to invalidate that dependent's cache — a
  // bound that does not enter this hash is a constraint that silently
  // disappears from every module already built against it.
  const genericTypes = node("generic-types", [...(interface_.genericTypes ?? new Map())]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, info]) => node("generic-type", [
      name,
      info.identity,
      node("parameter-names", info.parameterNames),
      node("parameter-bounds", info.parameterBounds.map((bound: string | null) => bound ?? "")),
      typeMap(info.fields),
      names(info.readonlyFields ?? new Set()),
    ])));
  const enums = node("enums", [...interface_.enums]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, info]) => node("enum", [
      name,
      info.identity,
      names(info.members),
      // D102 ruling 1: a wire value is a string or a safe integer, and the two
      // kinds are different values. The hash carries the JSON spelling so a
      // member moving from `"2"` to `2` invalidates every dependent built
      // against the old one — the digest is what decides that, and a bare
      // `String(value)` would make the change invisible to it.
      node("wire-values", [...info.wireValues]
        .sort(([left], [right]) => byCodeUnit(left, right))
        .map(([member, value]) => node("wire-value", [member, JSON.stringify(value)]))),
    ])));
  const classes = node("classes", [...interface_.classes]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, info]) => node("class", [
      name,
      info.identity ?? "",
      info.base ?? "",
      info.abstract ? "abstract" : "",
      // A dependent's `using` analysis consumes both the presence of the
      // release contract and whether it must await. Neither is represented by
      // the ordinary class members below, so both states belong here.
      info.dispose ?? "",
      // D55 rule 120 layer two, and batch M's lesson one layer out again: a
      // dependent compiled against the parameter list, the bounds, and the
      // arguments this class applies to its base. A bound that does not enter
      // this hash is a constraint that silently disappears from every module
      // already built against it.
      node("type-parameter-names", info.typeParameterNames ?? []),
      node("type-parameter-bounds", (info.typeParameterBounds ?? []).map((bound) => bound ?? "")),
      node("base-application", info.baseApplication
        ? [info.baseApplication.declaration, info.baseApplication.name, types(info.baseApplication.arguments)]
        : []),
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
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([extensionId, values]) => {
      const identify = extensionOwners.get(extensionId)?.inspection?.interfaceExportIdentity;
      if (!identify) {
        throw new Error(`Compiler extension '${extensionId}' exports cross-module interface data without an interfaceExportIdentity contract`);
      }
      const entries = [...values]
        .sort(([left], [right]) => byCodeUnit(left, right))
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
    namedTypeBases,
    genericTypes,
    typeMap(interface_.typeAliases),
    enums,
    classes,
    node("reactive", [...interface_.reactiveExports]
      .sort(([left], [right]) => byCodeUnit(left, right))
      .map(([name, kind]) => node("reactive-entry", [name, kind]))),
    node("re-exports", [...interface_.reExports]
      .sort(([left], [right]) => byCodeUnit(left, right))
      .map(([name, target]) => node("re-export", [name, target.source, target.imported]))),
    node("tests", interface_.tests.map((item) => `${item.name}\u0000${item.title}`).sort()),
    extensionExports,
  ]);
}

async function createAnalysisContext(
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
): Promise<AnalysisContext> {
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

  for (const dependency of module.inspection.dependencies) {
    if (dependency.dynamic) {
      const artifact = artifactInterfaces.get(projectImportKey(module.inputPath, dependency.source));
      const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
        ? resolve(dirname(module.inputPath), dependency.source)
        : null;
      const target = targetPath ? loaded.get(targetPath) : null;
      const interface_ = artifact
        ?? (target ? resolvedModuleInterface(target, loaded, velarImports, artifactInterfaces, interfaceCache, compiledInterfaces, compilerExtensions) : null);
      if (!interface_) continue;
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
      continue;
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
      importInterface(module, dependency, standard, imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionImports, failures);
      importReachableStandardTypeMetadata(standard, compilerExtensions, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
      continue;
    }
    const artifact = artifactInterfaces.get(projectImportKey(module.inputPath, dependency.source));
    if (artifact) {
      importInterface(module, dependency, artifact, imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionImports, failures);
      importReachableStandardTypeMetadata(artifact, compilerExtensions, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
      continue;
    }
    const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
      ? resolve(dirname(module.inputPath), dependency.source)
      : velarImports.get(projectImportKey(module.inputPath, dependency.source));
    if (!targetPath) continue;
    const target = loaded.get(targetPath);
    if (!target) continue;
    const targetInterface = resolvedModuleInterface(target, loaded, velarImports, artifactInterfaces, interfaceCache, compiledInterfaces, compilerExtensions);
    importInterface(module, dependency, targetInterface, imports, reactiveImports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionImports, failures);
    // The same sink one step sideways: a project module can re-export a
    // signature returning a standard type it never declares either.
    importReachableStandardTypeMetadata(targetInterface, compilerExtensions, namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, enums, classes);
  }
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
    resources: module.resourceContents,
  };
}

function resolvedModuleInterface(
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
  const exports = new Map(own.exports);
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
  const resolved: ModuleInspection["moduleInterface"] = { ...own, exports, mutableExports, reactiveExports, namedTypes, namedTypeReadonlyFields, namedTypeIdentities, namedTypeBases, genericTypes, typeAliases, enums, classes, extensionExports };
  cache.set(module.inputPath, resolved);

  for (const dependency of module.inspection.dependencies) {
    if (dependency.javascript) continue;
    let dependencyInterface = artifactInterfaces.get(projectImportKey(module.inputPath, dependency.source))
      ?? standardModuleInterface(dependency.source, compilerExtensions);
    if (!dependencyInterface) {
      const targetPath = dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
        ? resolve(dirname(module.inputPath), dependency.source)
        : velarImports.get(projectImportKey(module.inputPath, dependency.source));
      const target = targetPath ? loaded.get(targetPath) : null;
      if (!target) continue;
      dependencyInterface = resolvedModuleInterface(target, loaded, velarImports, artifactInterfaces, cache, compiledInterfaces, compilerExtensions);
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
  return resolved;
}

/**
 * Source fallback and frozen artifacts must agree on nominal identities.
 * Absolute installation paths would make one record or class a different
 * type on every machine and would leak a publisher path into the artifact.
 */
function stableSourcePackageInterface(
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

/** A package manifest is one identity; each import selects one exact public entry. */
interface ResolvedVelarSourcePackage {
  readonly package_: VelarSourcePackage;
  readonly subpath: VelarPackageSubpath;
  readonly entry: VelarPackageEntry;
  readonly artifact: LoadedVelarLibraryArtifact | null;
}

interface CachedVelarSourcePackageManifest {
  readonly key: string;
  readonly manifest: ParsedVelarSourcePackageManifest;
  readonly package_: VelarSourcePackage;
}

interface VelarPackageResolutionCache {
  readonly manifests: Map<string, Promise<CachedVelarSourcePackageManifest>>;
  readonly artifacts: Map<string, Promise<ReadonlyMap<VelarPackageSubpath, LoadedVelarLibraryArtifact>>>;
  readonly selfRoots: Map<string, Promise<string | null>>;
}

function createVelarPackageResolutionCache(): VelarPackageResolutionCache {
  return { manifests: new Map(), artifacts: new Map(), selfRoots: new Map() };
}

async function resolveVelarSourcePackage(
  source: string,
  importerPath: string,
  target: VelarPackageTarget | undefined,
  capabilities: ReadonlySet<string> | undefined,
  cache: VelarPackageResolutionCache,
): Promise<ResolvedVelarSourcePackage> {
  const name = packageNameOf(source);
  const subpath = packageSubpath(source, name);
  const selfRoot = await packageSelfReferenceRoot(name, importerPath, cache);
  if (selfRoot !== null) {
    // A package checks its current sources, never an artifact left by an older
    // build. The regular manifest parser still owns the exact entry, target,
    // capability, language, and package-root boundaries.
    const resolved = await velarPackageAtRoot(name, selfRoot, subpath, undefined, undefined, cache);
    if (target !== undefined) assertVelarPackageCompatibility(resolved.package_, target, capabilities ?? new Set());
    return resolved;
  }
  let directory = dirname(importerPath);
  while (true) {
    const root = join(directory, "node_modules", ...name.split("/"));
    try {
      return await velarPackageAtRoot(name, root, subpath, target, capabilities, cache);
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`package '${name}' is not installed`);
    directory = parent;
  }
}

async function velarPackageAtRoot(
  name: string,
  root: string,
  subpath: VelarPackageSubpath = ".",
  target?: VelarPackageTarget,
  capabilities?: ReadonlySet<string>,
  cache?: VelarPackageResolutionCache,
): Promise<ResolvedVelarSourcePackage> {
  const resolvedCache = cache ?? createVelarPackageResolutionCache();
  const resolvedManifest = await velarPackageManifestAtRoot(name, root, resolvedCache);
  const { manifest, package_ } = resolvedManifest;
  const entry = manifest.entries.get(subpath);
  if (!entry) {
    throw new Error(`Package '${name}' does not declare VelarScript entry '${subpath}' in package.json#velar.entries`);
  }
  if (target === undefined) return { package_, subpath, entry, artifact: null };
  const directArtifactTarget = target === "core" || target === "node" ? target : null;
  const artifactTarget = directArtifactTarget !== null && manifest.artifactDescriptors.has(directArtifactTarget)
    ? directArtifactTarget
    : target !== "core" && manifest.artifactDescriptors.has("core") ? "core" : null;
  if (artifactTarget === null) {
    assertVelarPackageCompatibility(package_, target, capabilities ?? new Set());
    return { package_, subpath, entry, artifact: null };
  }
  assertVelarPackageTargetCapabilities(package_, target, capabilities ?? new Set());
  const artifactKey = `${resolvedManifest.key}\0${artifactTarget}`;
  let pendingArtifacts = resolvedCache.artifacts.get(artifactKey);
  if (!pendingArtifacts) {
    pendingArtifacts = loadVelarLibraryArtifactSet({
      packageRoot: root,
      packageName: name,
      packageVersion: manifest.version,
      packageEntries: manifest.entries,
      descriptor: manifest.artifactDescriptors.get(artifactTarget)!,
      target: artifactTarget,
      packageExports: manifest.exports,
      runtimeDependencies: manifest.runtimeDependencies,
    });
    resolvedCache.artifacts.set(artifactKey, pendingArtifacts);
  }
  const artifact = (await pendingArtifacts).get(subpath);
  if (!artifact) throw new Error(`Velar library artifact does not publish entry '${subpath}'`);
  return {
    package_: { ...package_, artifacts: new Map([[subpath, artifact]]) },
    subpath,
    entry,
    artifact,
  };
}

async function velarPackageManifestAtRoot(
  name: string,
  root: string,
  cache: VelarPackageResolutionCache,
): Promise<CachedVelarSourcePackageManifest> {
  const key = `${resolve(root)}\0${name}`;
  let pending = cache.manifests.get(key);
  if (!pending) {
    pending = (async () => {
      const value = JSON.parse(await readBoundedText(
        join(root, "package.json"),
        1024 * 1024,
        `Package manifest for '${name}'`,
      ));
      const manifest = parseVelarSourcePackageManifest(name, root, value);
      await canonicalVelarPackageEntryPaths(name, root, manifest.entries);
      return {
        key,
        manifest,
        package_: {
          name,
          version: manifest.version,
          root,
          entryPath: manifest.entries.get(".")!.inputPath,
          entries: manifest.entries,
          resources: manifest.resources,
          targets: manifest.targets,
          requiredCapabilities: manifest.requiredCapabilities,
          requiredLanguage: manifest.requiredLanguage,
          artifacts: new Map(),
        },
      };
    })();
    cache.manifests.set(key, pending);
  }
  return pending;
}

function packageSubpath(source: string, name: string): VelarPackageSubpath {
  if (source === name) return ".";
  const subpath = `.${source.slice(name.length)}`;
  assertVelarPackageEntrySubpath(subpath, `Package import '${source}'`);
  return subpath;
}

async function resolveJsonResource(
  source: string,
  importerPath: string,
  ownerPackage: VelarSourcePackage | null,
  sourceRoot: string,
  cache: VelarPackageResolutionCache,
): Promise<{ readonly resource: VelarPackageResource; readonly package_: VelarSourcePackage | null }> {
  if (source.startsWith(".")) {
    const inputPath = resolve(dirname(importerPath), source);
    const boundary = ownerPackage?.root ?? sourceRoot;
    await authorizeJsonResource(inputPath, boundary, source);
    const relativePath = normalizeModulePath(relative(boundary, inputPath));
    const declared = ownerPackage?.resources.find((resource) => resource.relativePath === relativePath) ?? null;
    if (ownerPackage && !declared) {
      throw new Error(`VelarScript package '${ownerPackage.name}' must declare '${relativePath}' in package.json#velar.resources`);
    }
    return {
      resource: declared ?? { subpath: null, relativePath, inputPath, kind: "json" },
      package_: null,
    };
  }
  if (isAbsolute(source)) throw new Error("JSON resource paths must be relative or an exact package resource subpath");
  const name = packageNameOf(source);
  if (source === name) throw new Error("A JSON resource import must name a declared package subpath");
  const subpath = `.${source.slice(name.length)}`;
  assertVelarPackageSubpath(subpath, `JSON resource import '${source}'`);
  const package_ = await resolveResourcePackage(name, source, importerPath, cache);
  const resource = package_.resources.find((candidate) => candidate.subpath === subpath);
  if (!resource) throw new Error(`Package '${name}' does not declare JSON resource '${subpath}' in package.json#velar.resources`);
  await authorizeJsonResource(resource.inputPath, package_.root, source);
  return { resource, package_ };
}

async function resolveResourcePackage(
  name: string,
  source: string,
  importerPath: string,
  cache: VelarPackageResolutionCache,
): Promise<VelarSourcePackage> {
  const selfRoot = await packageSelfReferenceRoot(name, importerPath, cache);
  if (selfRoot !== null) return (await velarPackageAtRoot(name, selfRoot, ".", undefined, undefined, cache)).package_;
  let directory = dirname(importerPath);
  while (true) {
    const root = join(directory, "node_modules", ...name.split("/"));
    try {
      return (await velarPackageAtRoot(name, root, ".", undefined, undefined, cache)).package_;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`package '${name}' is not installed for resource import '${source}'`);
    directory = parent;
  }
}

async function packageSelfReferenceRoot(
  name: string,
  importerPath: string,
  cache: VelarPackageResolutionCache,
): Promise<string | null> {
  const key = `${name}\0${dirname(importerPath)}`;
  let pending = cache.selfRoots.get(key);
  if (pending) return pending;
  pending = findPackageSelfReferenceRoot(name, importerPath);
  cache.selfRoots.set(key, pending);
  return pending;
}

async function authorizeJsonResource(inputPath: string, boundary: string, source: string): Promise<void> {
  if (extname(inputPath).toLowerCase() !== ".json") throw new Error(`JSON resource '${source}' must point to a .json file`);
  if (escapesRoot(relative(boundary, inputPath))) throw new Error(`JSON resource '${source}' cannot escape '${boundary}'`);
  const [canonicalRoot, canonicalInput, metadata] = await Promise.all([
    canonicalizePotentialPath(boundary),
    canonicalizePotentialPath(inputPath),
    lstat(inputPath),
  ]);
  if (escapesRoot(relative(canonicalRoot, canonicalInput))) throw new Error(`JSON resource '${source}' cannot escape '${boundary}' through a symbolic link`);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`JSON resource '${source}' must be an ordinary file, not a symbolic link`);
}

async function readJsonResource(inputPath: string, source: string): Promise<string> {
  const bytes = await readFile(inputPath);
  if (bytes.byteLength > MAX_JSON_RESOURCE_BYTES) {
    throw new RangeError(`json resource '${source}' exceeds ${MAX_JSON_RESOURCE_BYTES} bytes`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("JSON resource is not valid UTF-8");
  }
}

function packageNameOf(source: string): string {
  return npmPackageNameFromSpecifier(source, `Package import '${source}'`);
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

/** The type identities a value type mentions, at any depth. */
function collectTypeIdentities(type: ValueType, into: Set<string>): void {
  switch (type.kind) {
    case "named":
      if (type.identity) into.add(type.identity);
      if (type.application) {
        into.add(type.application.declaration);
        for (const argument of type.application.arguments) collectTypeIdentities(argument, into);
      }
      return;
    case "class":
    case "classConstructor":
    case "enum":
    case "enumMember":
    case "enumObject":
      if (type.identity) into.add(type.identity);
      return;
    case "typeObject":
      if (type.value) collectTypeIdentities(type.value, into);
      return;
    case "optional":
      collectTypeIdentities(type.inner, into);
      return;
    case "list":
    case "set":
      collectTypeIdentities(type.element, into);
      return;
    case "map":
      collectTypeIdentities(type.key, into);
      collectTypeIdentities(type.value, into);
      return;
    case "record":
    case "promise":
    case "runtimeType":
      collectTypeIdentities(type.value, into);
      return;
    case "object":
      for (const field of type.fields.values()) collectTypeIdentities(field, into);
      return;
    case "function":
    case "action":
    case "intrinsic":
      for (const parameter of type.parameters) collectTypeIdentities(parameter, into);
      if (type.rest) collectTypeIdentities(type.rest, into);
      collectTypeIdentities(type.result, into);
      return;
    case "extension":
      for (const property of type.properties.values()) collectTypeIdentities(property, into);
      for (const argument of type.arguments) collectTypeIdentities(argument, into);
      return;
    case "union":
      for (const member of type.members) collectTypeIdentities(member, into);
      return;
    default:
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
  // D55 rule 120 layer two: a generic base crosses as its parts. The key is
  // recomputed from the mapped declaration and arguments rather than mapped as
  // a string, because `Stack<number>` is not a name any table is keyed by — it
  // is a function of two things that each cross on their own.
  const baseApplication = info.baseApplication
    ? {
      ...info.baseApplication,
      declaration: mapBase(info.baseApplication.declaration),
      arguments: info.baseApplication.arguments.map(mapType),
    }
    : undefined;
  return {
    ...info,
    // D68 rule 177: the iteration contract is part of the class, so its answer
    // is transformed with every other type-bearing member.
    ...(info.iterate ? { iterate: mapType(info.iterate) } : {}),
    ...(baseApplication ? { baseApplication } : {}),
    parameters: info.parameters.map(mapType),
    ...(info.constructorRest ? { constructorRest: mapType(info.constructorRest) } : {}),
    base: baseApplication
      ? genericApplicationIdentity(baseApplication.declaration, baseApplication.arguments)
      : info.base ? mapBase(info.base) : null,
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
      // D55 rule 120 layer two: an instantiation renames through the class it
      // applies, never through its display text — `Stack<number>` is not a
      // name an import can alias, but `Stack` is.
      if (type.application) {
        return classApplicationType(
          type.application.declaration,
          aliases.get(type.application.name) ?? type.application.name,
          type.application.arguments.map((argument) => renameType(argument, aliases)),
        );
      }
      return { ...type, name: aliases.get(type.name) ?? type.name };
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
  genericTypes: ReadonlyMap<string, GenericTypeInfo> = new Map(),
): ValueType {
  const resolveNested = (nested: ValueType): ValueType => resolveKnownNominals(
    nested,
    classes,
    enums,
    namedTypeIdentities,
    genericTypes,
  );
  // D55 rule 121: the importing side of the same crossing `resolveNominals`
  // makes on the exporting side. Both call one constructor, so the identity
  // computed here and the identity published there are the same string.
  if (type.kind === "named" && type.application) {
    const arguments_ = type.application.arguments.map(resolveNested);
    const declaration = genericTypes.get(type.application.name)?.identity
      ?? namedTypeIdentities.get(type.application.name)
      ?? type.application.declaration;
    return genericApplicationType(declaration, type.application.name, arguments_, type.readonlyView === true);
  }
  // D55 rule 120 layer two: the same crossing for a class application — the
  // declaration becomes the identity the exporting module published, so both
  // sides compute one instantiation identity for `Stack<number>`.
  if (type.kind === "class" && type.application) {
    const arguments_ = type.application.arguments.map(resolveNested);
    const declaration = classes.get(type.application.name)?.identity ?? type.application.declaration;
    return classApplicationType(declaration, type.application.name, arguments_);
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
      return optionalOf(resolveNested(type.inner));
    case "list":
      return { ...type, element: resolveNested(type.element) };
    case "set":
      return { ...type, element: resolveNested(type.element) };
    case "map":
      return { ...type, key: resolveNested(type.key), value: resolveNested(type.value) };
    case "record":
      return { ...type, value: resolveNested(type.value) };
    case "promise":
      return { kind: "promise", value: resolveNested(type.value) };
    case "runtimeType":
      return { kind: "runtimeType", value: resolveNested(type.value) };
    case "typeObject":
      return type.value
        ? { ...type, value: resolveNested(type.value) }
        : type;
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolveNested(value)])) };
    case "function":
    case "action":
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map(resolveNested),
        ...(type.rest ? { rest: resolveNested(type.rest) } : {}),
        result: resolveNested(type.result),
      };
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, resolveNested(value)])),
        arguments: type.arguments.map(resolveNested),
      };
    case "union":
      return { kind: "union", members: type.members.map(resolveNested) };
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
