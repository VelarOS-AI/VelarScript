import { resolve } from "node:path";
import type { CompileResult, CompilerExtension, ModuleInterface, Span } from "@velarscript/compiler";
import type { ResolvedFrameworkHost } from "./config.ts";
import type { LoadedVelarLibraryArtifact } from "./library-artifact.ts";
import { appendCompilerRuntimeTargetDiagnostics } from "./project-runtime-target.ts";
import type { VelarSourcePackage } from "./project-package-resolution.ts";
import type { VelarPackageResource, VelarPackageTarget } from "./source-package-manifest.ts";
import { byCodeUnit } from "./stable-order.ts";
import { discoverProjectModules } from "./project/graph.ts";
import { compileProjectModules } from "./project/incremental.ts";
import { resolveProjectModuleInterfaces } from "./project/interfaces/resolution.ts";
import { createProjectCompilation } from "./project/options.ts";
import {
  appendFrameworkValidationDiagnostics,
  appendInitializationCycleDiagnostics,
  uniqueFailures,
  uniqueNotices,
} from "./project/diagnostics.ts";

export type {
  VelarLanguageBound,
  VelarLanguageGeneration,
  VelarPackageEntry,
  VelarPackageLanguageRange,
  VelarPackageResource,
  VelarPackageTarget,
} from "./source-package-manifest.ts";
export type { VelarPackageSubpath } from "./package-entry.ts";
export type { VelarSourcePackage } from "./project-package-resolution.ts";

/**
 * The names that were exported from this file before the phases moved into
 * `project/`. D115 §三 makes this file the façade: the public shapes, the two
 * entry points, and every name the thirty-odd importers under
 * `packages/cli/src` already reach for, so no import path changes.
 */
export { MAX_JSON_RESOURCE_BYTES, readProjectJsonResource } from "./project/entries.ts";
export type { ProjectJsonResourceReadOperations } from "./project/entries.ts";
export { moduleInterfaceIdentity } from "./project/interfaces/identity.ts";
export { projectImportKey } from "./project/options.ts";

export interface ProjectModule {
  readonly inputPath: string;
  readonly relativePath: string;
  /** SHA-256 of the exact UTF-8 bytes that produced this compile result. */
  readonly sourceSha256: string;
  /** Exact non-source resource bytes supplied to this module's checked compile. */
  readonly resourceContents?: ReadonlyMap<string, string>;
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
  /**
   * MD-I1: a resolution failure that knows the source text behind it reports
   * like every other compiler failure — `path:line:col error VELxxxx: message`
   * with the offending import under the caret. `code` and `span` travel
   * together; a failure that has neither is still printed as `path: message`.
   * `formatProjectFailure` in `project-failure.ts` is the one renderer, and the
   * language server publishes the same pair as a positioned diagnostic.
   */
  readonly code?: string;
  readonly span?: Span;
  /**
   * GA-D2: the exact bytes `span` indexes, for a failure whose site is not one
   * of the project's modules. `velar.json` is that site — a rule about how the
   * project is *arranged* is about a line of the manifest — and the renderer
   * has no other way to reach a file the module graph never loaded. A failure
   * sited in a module leaves this unset and is rendered from that module's own
   * source.
   */
  readonly sourceText?: string;
}

export interface ProjectNotice {
  readonly path: string;
  readonly message: string;
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

/** Package-owned relative JSON resources for the primary source graph. */
export interface ProjectOwnedResourcePackage {
  readonly name: string;
  readonly root: string;
  readonly resources: readonly VelarPackageResource[];
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

export interface CompileProjectOptions {
  /** Root used to derive stable emitted module paths. */
  readonly sourceRoot?: string;
  /**
   * Physical boundary for relative VelarScript imports. It is distinct from
   * sourceRoot: changing output-relative layout must not silently widen the
   * source graph a project is authorized to read.
   */
  readonly sourceBoundary?: string;
  /**
   * Wider boundary for project-owned auxiliary sources outside sourceBoundary.
   * Modules inside sourceBoundary always retain the narrower boundary, even
   * when an auxiliary root imports them.
   */
  readonly auxiliarySourceBoundary?: string;
  /** Physical boundary for project-owned resources; source modules keep sourceBoundary. */
  readonly resourceBoundary?: string;
  /** Wider resource boundary paired with project-owned auxiliary sources. */
  readonly auxiliaryResourceBoundary?: string;
  /** Declared resources owned by the source package currently being compiled. */
  readonly ownedResourcePackage?: ProjectOwnedResourcePackage | null;
  readonly projectRoot?: string;
  readonly publicRoot?: string;
  readonly extensions?: readonly CompilerExtension[];
  readonly extensionConfig?: ReadonlyMap<string, unknown>;
  readonly framework?: ResolvedFrameworkHost | null;
  /** Traversal roots may be wider in editor sessions; only these roots execute `@main`. */
  readonly executionEntries?: readonly string[];
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
  /**
   * GA-D2: the manifest that selected this project's entry, so a missing entry
   * file is reported where it was declared. The driver never parses it — it
   * only needs the bytes to point at the `entry` line — and a compile with no
   * manifest behind it (a bare `.vel` file) leaves it out.
   */
  readonly manifest?: { readonly path: string; readonly text: string } | null;
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
  const compilation = createProjectCompilation(entries, primaryEntry, overrides, options);
  await discoverProjectModules(compilation);
  const compiled = await compileProjectModules(compilation, previous, changedPaths);
  const { modules, affected, compiledModules, reusedModules } = compiled;
  const { startedAt, entryPath, executionEntries, sourceRoot, projectRoot, publicRoot } = compilation;
  const { compilerExtensions, extensionConfig, framework, capabilities, packageTarget } = compilation;
  const { loaded, failures, notices, velarPackages, velarImports, resolutionDiagnostics } = compilation;
  const { velarArtifactInterfaces, velarArtifactImports, resources, resourceImports } = compilation;
  const { externalTypeDependencies } = compilation;
  appendCompilerRuntimeTargetDiagnostics(modules, failures, packageTarget, extensionConfig, compilerExtensions);
  appendInitializationCycleDiagnostics(modules, loaded, velarImports, entryPath, resolutionDiagnostics);
  // D90 R3(a): module order decides the concatenated stylesheet's bytes, its
  // content hash, and `buildId`. `localeCompare` follows the collation the
  // process environment selects, so it made those outputs — and the cascade
  // winner between two equal-specificity rules — depend on the build
  // machine's `LC_ALL`. Order by code unit over the POSIX-normalized
  // relative path instead.
  modules.sort((left, right) => byCodeUnit(left.relativePath, right.relativePath));
  const moduleInterfaces = resolveProjectModuleInterfaces(compilation, compiled.compilationGroups, compiled.compiledInterfaces);
  appendFrameworkValidationDiagnostics(compilation, modules);
  return {
    entryPath,
    executionEntries,
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
