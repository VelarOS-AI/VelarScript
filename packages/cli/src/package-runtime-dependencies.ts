import { join } from "node:path";
import type { VelarLibraryArtifactTarget } from "./library-artifact-receipt.ts";
import { assertExternalJavaScriptPackageTarget } from "./javascript-dependency-target.ts";
import { assertDeclaredRuntimeDependency } from "./package-runtime-dependency-manifest.ts";

/** Ensures every retained bare edge has an npm owner after a clean install. */
export function assertDeclaredArtifactRuntimeDependencies(
  specifiers: ReadonlySet<string>,
  dependencies: ReadonlySet<string>,
  packageName: string,
  compilerOwnedModules: ReadonlySet<string> = new Set(),
): void {
  for (const specifier of specifiers) {
    if (!compilerOwnedModules.has(specifier)) assertDeclaredRuntimeDependency(specifier, dependencies, packageName);
  }
}

/** Applies declaration ownership and the same target fence used by source check. */
export async function assertArtifactRuntimeDependencies(
  specifiers: ReadonlySet<string>,
  dependencies: ReadonlySet<string>,
  packageRoot: string,
  packageName: string,
  target: VelarLibraryArtifactTarget,
  compilerOwnedModules: ReadonlySet<string> = new Set(),
): Promise<void> {
  assertDeclaredArtifactRuntimeDependencies(specifiers, dependencies, packageName, compilerOwnedModules);
  await assertArtifactRuntimeDependencyTargets(externalPackageSpecifiers(specifiers, compilerOwnedModules), packageRoot, target);
}

/** Preserves format 1's shipped ownership contract while format 2 repeats the target proof. */
export async function assertConsumedArtifactRuntimeDependencies(
  formatVersion: 1 | 2,
  specifiers: ReadonlySet<string>,
  dependencies: ReadonlySet<string>,
  packageRoot: string,
  packageName: string,
  target: VelarLibraryArtifactTarget,
  compilerOwnedModules: ReadonlySet<string> = new Set(),
): Promise<void> {
  assertDeclaredArtifactRuntimeDependencies(specifiers, dependencies, packageName, compilerOwnedModules);
  if (formatVersion === 1) return;
  await assertArtifactRuntimeDependencyTargets(externalPackageSpecifiers(specifiers, compilerOwnedModules), packageRoot, target);
}

function externalPackageSpecifiers(
  specifiers: ReadonlySet<string>,
  compilerOwnedModules: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...specifiers].filter((specifier) => !compilerOwnedModules.has(specifier)));
}

async function assertArtifactRuntimeDependencyTargets(
  specifiers: ReadonlySet<string>,
  packageRoot: string,
  target: VelarLibraryArtifactTarget,
): Promise<void> {
  const importer = join(packageRoot, "__velar_artifact_runtime__.mjs");
  for (const specifier of specifiers) {
    await assertExternalJavaScriptPackageTarget(specifier, importer, "node", target);
  }
}
