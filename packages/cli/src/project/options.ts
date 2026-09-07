import { dirname, join, resolve } from "node:path";
import type { CompileResult, CompilerExtension, ModuleInspection, ModuleInterface } from "@velarscript/compiler";
import type { ResolvedFrameworkHost } from "../config.ts";
import type { LoadedVelarLibraryArtifact } from "../library-artifact.ts";
import type { JavaScriptSpecifierDiagnostic } from "../javascript-dependency-target.ts";
import type { JavaScriptPackageTarget } from "../package-imports.ts";
import {
  createVelarPackageResolutionCache,
  type VelarPackageResolutionCache,
  type VelarSourcePackage,
} from "../project-package-resolution.ts";
import { selectProjectTargets } from "../project-target-selection.ts";
import type { VelarPackageTarget } from "../source-package-manifest.ts";
import type { TypeScriptDeclarationBridge } from "../typescript-declarations.ts";
import type {
  CompileProjectOptions,
  ProjectFailure,
  ProjectModule,
  ProjectNotice,
  ProjectOwnedResourcePackage,
  ProjectResource,
} from "../project.ts";

export interface LoadedModule {
  readonly inputPath: string;
  readonly relativePath: string;
  readonly text: string;
  readonly sourceSha256: string;
  readonly inspection: ModuleInspection;
  readonly package: VelarSourcePackage | null;
  readonly resourceContents: ReadonlyMap<string, string>;
}

export interface PendingModule {
  readonly inputPath: string;
  readonly package: VelarSourcePackage | null;
}

export function projectModuleResult(
  module: Pick<ProjectModule, "inputPath" | "relativePath" | "sourceSha256" | "resourceContents">,
  result: CompileResult,
): ProjectModule {
  return {
    inputPath: module.inputPath,
    relativePath: module.relativePath,
    sourceSha256: module.sourceSha256,
    ...(module.resourceContents ? { resourceContents: module.resourceContents } : {}),
    result,
  };
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
export type ModuleResolutionDiagnostic = JavaScriptSpecifierDiagnostic;

export interface JavaScriptDependencyContext {
  readonly packageTarget: VelarPackageTarget;
  readonly resolutionTarget: JavaScriptPackageTarget;
  readonly resolveSpecifiers: boolean;
  readonly failures: ProjectFailure[];
  readonly verdicts: Map<string, ModuleResolutionDiagnostic | null>;
  readonly recordResolution: (importerPath: string, source: string, code: string, message: string) => void;
}

export function resolutionRecorder(
  diagnostics: Map<string, ModuleResolutionDiagnostic[]>,
): JavaScriptDependencyContext["recordResolution"] {
  return (importerPath, source, code, message): void => {
    const list = diagnostics.get(importerPath) ?? [];
    list.push({ code, message, source });
    diagnostics.set(importerPath, list);
  };
}

/**
 * Everything one `compileProjectEntries` call normalizes once and every phase
 * afterwards reads or writes: the resolved option surface, the target
 * selection, and the accumulators the module walk, the compilation pass and the
 * result share. The phases take this one record rather than thirty parameters,
 * and the driver in `project.ts` is then the sequence of phase calls it reads
 * as.
 */
export interface ProjectCompilation {
  readonly startedAt: number;
  readonly overrides: ReadonlyMap<string, string>;
  readonly options: CompileProjectOptions;
  readonly entryPath: string;
  readonly sourceRoot: string;
  readonly sourceBoundary: string;
  readonly resourceBoundary: string;
  readonly ownedResourcePackage: ProjectOwnedResourcePackage | null;
  readonly projectRoot: string;
  readonly publicRoot: string;
  readonly compilerExtensions: readonly CompilerExtension[];
  readonly extensionConfig: ReadonlyMap<string, unknown>;
  readonly framework: ResolvedFrameworkHost | null;
  readonly capabilities: ReadonlySet<string>;
  readonly packageCapabilities: ReadonlySet<string>;
  readonly packageTarget: VelarPackageTarget;
  readonly javascriptPackageTarget: JavaScriptPackageTarget;
  readonly initialEntries: readonly string[];
  readonly executionEntries: ReadonlySet<string>;
  readonly loaded: Map<string, LoadedModule>;
  readonly failures: ProjectFailure[];
  readonly notices: ProjectNotice[];
  readonly declarationCache: Map<string, Promise<TypeScriptDeclarationBridge | null>>;
  readonly externalTypeDependencies: Map<string, Set<string>>;
  readonly interfaceCache: Map<string, ModuleInspection["moduleInterface"]>;
  readonly velarPackages: Map<string, VelarSourcePackage>;
  readonly velarPackageResolutionCache: VelarPackageResolutionCache;
  readonly velarImports: Map<string, string>;
  readonly velarArtifactInterfaces: Map<string, ModuleInterface>;
  readonly velarArtifactImports: Map<string, LoadedVelarLibraryArtifact>;
  readonly resources: Map<string, ProjectResource>;
  readonly resourceImports: Map<string, ProjectResource>;
  readonly resolutionDiagnostics: Map<string, ModuleResolutionDiagnostic[]>;
  readonly recordResolution: JavaScriptDependencyContext["recordResolution"];
  readonly javascriptDependencies: JavaScriptDependencyContext;
}

/** Phase one: the option surface resolved, and every accumulator opened empty. */
export function createProjectCompilation(
  entries: readonly string[],
  primaryEntry: string,
  overrides: ReadonlyMap<string, string>,
  options: CompileProjectOptions,
): ProjectCompilation {
  const startedAt = performance.now();
  const entryPath = resolve(primaryEntry);
  const sourceRoot = resolve(options.sourceRoot ?? dirname(entryPath));
  const sourceBoundary = resolve(options.sourceBoundary ?? sourceRoot);
  const resourceBoundary = resolve(options.resourceBoundary ?? sourceBoundary);
  const ownedResourcePackage = options.ownedResourcePackage ?? null;
  const projectRoot = resolve(options.projectRoot ?? sourceRoot);
  const publicRoot = resolve(options.publicRoot ?? join(projectRoot, "public"));
  const compilerExtensions = options.extensions ?? [];
  const extensionConfig = options.extensionConfig ?? new Map<string, unknown>();
  const framework = options.framework ?? null;
  const { capabilities, packageCapabilities, packageTarget, javascriptPackageTarget } = selectProjectTargets(
    options.packageTarget,
    compilerExtensions,
    framework,
  );
  const initialEntries = [...new Set(entries.map((entry) => resolve(entry)))];
  const executionEntries = new Set((options.executionEntries ?? initialEntries).map((entry) => resolve(entry)));
  const loaded = new Map<string, LoadedModule>();
  const failures: ProjectFailure[] = [];
  const notices: ProjectNotice[] = [];
  const declarationCache = new Map<string, Promise<TypeScriptDeclarationBridge | null>>();
  const externalTypeDependencies = new Map<string, Set<string>>();
  const interfaceCache = new Map<string, ModuleInspection["moduleInterface"]>();
  const velarPackages = new Map<string, VelarSourcePackage>();
  const velarPackageResolutionCache = createVelarPackageResolutionCache(overrides, compilerExtensions, extensionConfig);
  const velarImports = new Map<string, string>();
  const velarArtifactInterfaces = new Map<string, ModuleInterface>();
  const velarArtifactImports = new Map<string, LoadedVelarLibraryArtifact>();
  const resources = new Map<string, ProjectResource>();
  const resourceImports = new Map<string, ProjectResource>();
  const javascriptSpecifierVerdicts = new Map<string, ModuleResolutionDiagnostic | null>();
  const resolutionDiagnostics = new Map<string, ModuleResolutionDiagnostic[]>();
  const recordResolution = resolutionRecorder(resolutionDiagnostics);
  const javascriptDependencies: JavaScriptDependencyContext = {
    packageTarget,
    resolutionTarget: javascriptPackageTarget,
    resolveSpecifiers: options.resolveJavaScriptSpecifiers !== false,
    failures,
    verdicts: javascriptSpecifierVerdicts,
    recordResolution,
  };
  return {
    startedAt,
    overrides,
    options,
    entryPath,
    sourceRoot,
    sourceBoundary,
    resourceBoundary,
    ownedResourcePackage,
    projectRoot,
    publicRoot,
    compilerExtensions,
    extensionConfig,
    framework,
    capabilities,
    packageCapabilities,
    packageTarget,
    javascriptPackageTarget,
    initialEntries,
    executionEntries,
    loaded,
    failures,
    notices,
    declarationCache,
    externalTypeDependencies,
    interfaceCache,
    velarPackages,
    velarPackageResolutionCache,
    velarImports,
    velarArtifactInterfaces,
    velarArtifactImports,
    resources,
    resourceImports,
    resolutionDiagnostics,
    recordResolution,
    javascriptDependencies,
  };
}
