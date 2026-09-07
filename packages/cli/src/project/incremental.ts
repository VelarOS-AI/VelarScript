import { dirname, extname, resolve } from "node:path";
import { compile, type CompilerExtension, type ModuleInspection } from "@velarscript/compiler";
import { hostErrorMessage } from "../host-error.ts";
import type { LoadedVelarLibraryArtifact } from "../library-artifact.ts";
import { isStandardModule } from "../standard-modules.ts";
import { byCodeUnit } from "../stable-order.ts";
import { importedReactiveAssignmentDiagnostics } from "./diagnostics.ts";
import { createAnalysisContext } from "./interfaces/analysis-context.ts";
import { moduleInterfaceIdentity } from "./interfaces/identity.ts";
import { stableSourcePackageInterface } from "./interfaces/resolution.ts";
import {
  projectImportKey,
  projectModuleResult,
  type LoadedModule,
  type ProjectCompilation,
} from "./options.ts";
import type { ProjectModule, ProjectResource, ProjectResult } from "../project.ts";

/** What the compilation phase hands the driver: the modules, and how they were reached. */
export interface CompiledProjectModules {
  readonly modules: ProjectModule[];
  readonly compilationGroups: readonly (readonly LoadedModule[])[];
  readonly compiledInterfaces: ReadonlyMap<string, ModuleInspection["moduleInterface"]>;
  readonly affected: ReadonlySet<string>;
  readonly compiledModules: number;
  readonly reusedModules: number;
}

/**
 * One strongly connected group compiled to a fixed point. A cycle's members see
 * each other's interfaces, so the group is compiled repeatedly until the joined
 * interface identity stops changing, or until the pass budget says it never
 * will.
 */
async function compileModuleGroup(
  compilation: ProjectCompilation,
  group: readonly LoadedModule[],
  compiledInterfaces: Map<string, ModuleInspection["moduleInterface"]>,
): Promise<Map<string, ProjectModule>> {
  const { loaded, velarImports, velarArtifactInterfaces, compilerExtensions, interfaceCache } = compilation;
  const { failures, notices, declarationCache, externalTypeDependencies } = compilation;
  const { extensionConfig, executionEntries, options } = compilation;
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
        path: module.inputPath, analysis,
        extensions: compilerExtensions,
        extensionConfig,
        resourceContents: module.resourceContents,
        sharedRuntimeModules: true,
        executeMain: executionEntries.has(module.inputPath),
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
  return passResults;
}

/**
 * The incremental-reuse phase: what the previous result still answers, and what
 * this one has to compile. Dependency-first groups make every interface outside
 * the group being compiled already stable.
 */
export async function compileProjectModules(
  compilation: ProjectCompilation,
  previous: ProjectResult | null,
  changedPaths: ReadonlySet<string>,
): Promise<CompiledProjectModules> {
  const { loaded, velarImports, velarArtifactImports, resourceImports } = compilation;
  const { externalTypeDependencies, executionEntries, compilerExtensions } = compilation;
  const modules: ProjectModule[] = [];
  const previousModules = new Map(previous?.modules.map((module) => [module.inputPath, module]));
  const affected = previous
    ? affectedModules(loaded, velarImports, velarArtifactImports, resourceImports, previous, previousModules, changedPaths)
    : new Set(loaded.keys());
  if (previous) {
    const currentExecutionEntries = executionEntries;
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
    const passResults = await compileModuleGroup(compilation, group, compiledInterfaces);
    modules.push(...group.map((module) => passResults.get(module.inputPath)!));
  }
  return { modules, compilationGroups, compiledInterfaces, affected, compiledModules, reusedModules };
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
export function stronglyConnectedPaths(
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
