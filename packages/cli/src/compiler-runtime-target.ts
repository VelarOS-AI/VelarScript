import type { CompilerExtension } from "@velarscript/compiler";
import {
  isStandardModule as isCoreStandardModule,
  standardModuleSources as coreStandardModuleSources,
} from "@velarscript/core";
import {
  isNodeModule,
  isNodeOnlyModule,
  velarNodeCompilerExtension,
} from "@velarscript/node/compiler";
import type { VelarLibraryArtifactTarget } from "./library-artifact-receipt.ts";
import { standardModuleClosure, standardModuleSources } from "./standard-modules.ts";

const coreRuntimeSources = new Set(coreStandardModuleSources().keys());

export interface CompilerRuntimeTargetViolation {
  readonly root: string;
  readonly source: string;
  readonly owner: string;
}

/** Finds the first target-specific module reached by one compiler-runtime root. */
export function compilerRuntimeTargetViolation(
  root: string,
  target: VelarLibraryArtifactTarget,
  projectConfig: unknown,
  extensions: readonly CompilerExtension[],
): CompilerRuntimeTargetViolation | null {
  if (target === "node") return null;
  const activeExtensions = extensions.length === 0 ? [velarNodeCompilerExtension] : extensions;
  for (const source of standardModuleClosure([root], projectConfig, extensions)) {
    const owner = targetSpecificRuntimeOwner(source, activeExtensions);
    if (owner !== null) return { root, source, owner };
  }
  return null;
}

/** Refuses a Core artifact whose retained compiler-runtime graph needs a host target. */
export function assertCompilerRuntimeArtifactTarget(
  roots: Iterable<string>,
  target: VelarLibraryArtifactTarget,
  projectConfig: unknown,
  extensions: readonly CompilerExtension[],
  artifactName: string,
): void {
  if (target === "node") return;
  const available = standardModuleSources(extensions);
  for (const root of roots) {
    if (!available.has(root)) continue;
    const violation = compilerRuntimeTargetViolation(root, target, projectConfig, extensions);
    if (violation === null) continue;
    const transit = violation.root === violation.source
      ? ""
      : ` through '${violation.source}'`;
    throw new Error(
      `Core Velar library artifact '${artifactName}' imports compiler runtime '${violation.root}'${transit}, `
      + `which requires target extension '${violation.owner}'`,
    );
  }
}

function targetSpecificRuntimeOwner(
  source: string,
  extensions: readonly CompilerExtension[],
): string | null {
  if (coreRuntimeSources.has(source) || isCoreStandardModule(source)) return null;
  if (isNodeModule(source)) return isNodeOnlyModule(source) ? "@velarscript/node" : null;
  const owner = extensions.find((extension) => extension.modules?.sources.has(source));
  if (!owner) return "unknown compiler extension";
  return (owner.capabilities?.length ?? 0) > 0 ? owner.id : null;
}
