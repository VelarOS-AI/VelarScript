import type { CompilerExtension } from "@velarscript/compiler";
import type { ProjectResult } from "./project.ts";
import { standardModuleClosure, standardModuleSources } from "./standard-modules.ts";

interface CompilerRuntimeModuleEntry {
  readonly inputPath: string;
  readonly result: { readonly runtimeModules: readonly string[] };
}

export interface UnknownCompilerRuntimeModule {
  readonly inputPath: string;
  readonly source: string;
  readonly emitter: string;
}

/** Finds emitter-requested runtime roots absent from the active compiler-owned module graph. */
export function unknownCompilerRuntimeModules(
  modules: readonly CompilerRuntimeModuleEntry[],
  extensions: readonly CompilerExtension[],
): readonly UnknownCompilerRuntimeModule[] {
  const available = standardModuleSources(extensions);
  const emitter = extensions.find((extension) => extension.createEmitter)?.id ?? "VelarScript Core";
  return modules.flatMap((module) => module.result.runtimeModules
    .filter((source) => !available.has(source))
    .map((source) => ({ inputPath: module.inputPath, source, emitter })));
}

export function unknownCompilerRuntimeModuleMessage(violation: UnknownCompilerRuntimeModule): string {
  return `Compiler emitter '${violation.emitter}' requested unknown runtime module '${violation.source}' while emitting `
    + `'${violation.inputPath}'; runtimeModules must name a module published by the active compiler extensions`;
}

/**
 * The complete compiler-owned runtime graph selected by a checked project.
 *
 * Frozen artifacts carry the roots authenticated when their receipt was
 * loaded. Keeping those roots beside source imports and lowering helpers here
 * gives every execution and deployment target one closure decision.
 */
export function requiredCompilerRuntimeModules(project: ProjectResult): ReadonlySet<string> {
  const available = standardModuleSources(project.compilerExtensions);
  const unknown = unknownCompilerRuntimeModules(project.modules, project.compilerExtensions)[0];
  if (unknown) throw new Error(unknownCompilerRuntimeModuleMessage(unknown));
  const roots = new Set<string>();
  for (const module of project.modules) {
    for (const dependency of module.result.dependencies) {
      if (available.has(dependency.source)) roots.add(dependency.source);
    }
    for (const source of module.result.runtimeModules) roots.add(source);
  }
  for (const artifact of project.velarArtifactImports.values()) {
    for (const source of artifact.compilerRuntimeModules) roots.add(source);
  }
  return standardModuleClosure(roots, project.extensionConfig, project.compilerExtensions);
}
